from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.models import Conversation, Message, Source
from app.schemas.chat import ChatRequest
from app.schemas.conversations import ConversationRead, MessageRead
from app.services.ai.base import AIProvider
from app.services.justapedia.types import ArticleChunk
from app.services.rag.prompting import build_direct_prompt, build_grounded_prompt
from app.services.rag.query_router import QueryRouter
from app.services.rag.retrieval import RetrievalService


class ChatService:
    def __init__(
        self,
        db: Session,
        retrieval_service: RetrievalService,
        query_router: QueryRouter,
        ai_provider: AIProvider,
    ) -> None:
        self.db = db
        self.retrieval_service = retrieval_service
        self.query_router = query_router
        self.ai_provider = ai_provider
        self.settings = get_settings()

    async def stream_chat(self, payload: ChatRequest) -> AsyncIterator[dict[str, Any]]:
        conversation = self._ensure_conversation(payload.conversation_id, payload.message)
        prior_history = self._get_conversation_history(conversation.id)
        user_message = self._create_message(
            conversation_id=conversation.id,
            role="user",
            content=payload.message,
            status="completed",
        )

        yield {
            "event": "conversation",
            "data": ConversationRead.model_validate(conversation).model_dump(mode="json"),
        }
        yield {
            "event": "user_message",
            "data": MessageRead.model_validate(user_message).model_dump(mode="json"),
        }

        effective_query = self._build_effective_query(payload, prior_history)
        answer_mode = payload.answer_mode
        response_language = payload.response_language
        retrieval_requested = self._should_retrieve(payload)
        chunks: list[ArticleChunk] = []

        if retrieval_requested:
            if payload.article_page_id:
                yield {"event": "status", "data": {"message": "Reading selected article..."}}
                chunks = await self.retrieval_service.retrieve_article(
                    page_id=payload.article_page_id,
                    query=effective_query,
                )
            else:
                yield {"event": "status", "data": {"message": "Searching Justapedia..."}}
                chunks = await self.retrieval_service.retrieve(payload.message)
                yield {"event": "status", "data": {"message": "Reading relevant sources..."}}

        if answer_mode == "grounded" and not chunks:
            assistant_message = self._create_message(
                conversation_id=conversation.id,
                role="assistant",
                content=self._build_no_results_message(payload.message),
                status="completed",
                model=self.settings.ai_model,
            )
            yield {
                "event": "assistant_message",
                "data": MessageRead.model_validate(assistant_message).model_dump(mode="json"),
            }
            yield {
                "event": "final",
                "data": {
                    "conversation": ConversationRead.model_validate(conversation).model_dump(mode="json"),
                    "message": MessageRead.model_validate(assistant_message).model_dump(mode="json"),
                    "related_articles": [],
                    "suggested_questions": [],
                },
            }
            return

        use_grounded_answer = bool(chunks) and answer_mode != "general"

        prompt = (
            build_grounded_prompt(
                effective_query,
                chunks,
                response_language=response_language,
                conversation_history=prior_history,
            )
            if use_grounded_answer
            else build_direct_prompt(
                payload.message,
                response_language=response_language,
                conversation_history=prior_history,
            )
        )

        assistant_message = self._create_message(
            conversation_id=conversation.id,
            role="assistant",
            content="",
            status="streaming",
            model=self.settings.ai_model,
        )
        yield {
            "event": "assistant_message",
            "data": MessageRead.model_validate(assistant_message).model_dump(mode="json"),
        }

        collected_chunks: list[str] = []

        try:
            yield {"event": "status", "data": {"message": "Generating answer..."}}
            async for chunk in self.ai_provider.stream_response(prompt):
                collected_chunks.append(chunk)
                yield {"event": "chunk", "data": {"text": chunk}}

            final_text = "".join(collected_chunks).strip()
            if not final_text:
                final_text = (
                    "I could not find enough reliable information from Justapedia to answer that confidently."
                    if use_grounded_answer
                    else "I could not generate a response."
                )

            assistant_message.content = final_text
            assistant_message.status = "completed"
            assistant_message.model = self.settings.ai_model

            if use_grounded_answer:
                for chunk in chunks:
                    self.db.add(
                        Source(
                            message_id=assistant_message.id,
                            title=chunk.title,
                            url=chunk.url,
                            page_id=chunk.page_id,
                            snippet=chunk.snippet,
                            section_title=chunk.section_title,
                            relevance_score=chunk.relevance_score,
                        )
                    )

            conversation.updated_at = datetime.now(timezone.utc)
            self.db.add(assistant_message)
            self.db.add(conversation)
            self.db.commit()
            self.db.refresh(assistant_message)
            self.db.refresh(conversation)

            yield {
                "event": "final",
                "data": {
                    "conversation": ConversationRead.model_validate(conversation).model_dump(mode="json"),
                    "message": MessageRead.model_validate(assistant_message).model_dump(mode="json"),
                    "related_articles": self._build_related_articles(chunks),
                    "suggested_questions": self._build_suggested_questions(payload.message, chunks),
                },
            }
        except asyncio.CancelledError:
            assistant_message.status = "cancelled"
            conversation.updated_at = datetime.now(timezone.utc)
            self.db.add(assistant_message)
            self.db.add(conversation)
            self.db.commit()
            raise
        except Exception:
            assistant_message.content = "I ran into an unexpected error while generating the answer."
            assistant_message.status = "failed"
            conversation.updated_at = datetime.now(timezone.utc)
            self.db.add(assistant_message)
            self.db.add(conversation)
            self.db.commit()
            yield {
                "event": "error",
                "data": {"message": "I ran into an unexpected error while generating the answer."},
            }

    def _ensure_conversation(self, conversation_id: str | None, first_message: str) -> Conversation:
        conversation: Conversation | None = None
        if conversation_id:
            conversation = self.db.get(Conversation, conversation_id)

        if conversation is None:
            conversation = Conversation(title=self._derive_title(first_message))
            self.db.add(conversation)
            self.db.commit()
            self.db.refresh(conversation)
            return conversation

        if conversation.title == "New chat":
            conversation.title = self._derive_title(first_message)
            conversation.updated_at = datetime.now(timezone.utc)
            self.db.add(conversation)
            self.db.commit()
            self.db.refresh(conversation)

        return conversation

    def _create_message(
        self,
        conversation_id: str,
        role: str,
        content: str,
        status: str,
        model: str | None = None,
    ) -> Message:
        message = Message(
            conversation_id=conversation_id,
            role=role,
            content=content,
            status=status,
            model=model,
        )
        self.db.add(message)
        conversation = self.db.get(Conversation, conversation_id)
        if conversation:
            conversation.updated_at = datetime.now(timezone.utc)
            self.db.add(conversation)
        self.db.commit()
        self.db.refresh(message)
        return message

    def _derive_title(self, text: str) -> str:
        cleaned = " ".join(text.strip().split())
        if not cleaned:
            return "New chat"
        return cleaned[:57].rstrip() + "..." if len(cleaned) > 60 else cleaned

    def _build_effective_query(self, payload: ChatRequest, prior_history: list[tuple[str, str]]) -> str:
        if payload.article_action and payload.article_page_id:
            return (
                f"Article action: {payload.article_action}\n"
                f"User request: {payload.message}\n"
                "Use the selected Justapedia article as the primary source."
            )

        if self._looks_like_follow_up(payload.message) and prior_history:
            context_lines = [f"{role}: {content}" for role, content in prior_history[-4:]]
            return (
                "Use the recent conversation to resolve references in the user's follow-up question.\n"
                + "\n".join(context_lines)
                + f"\nuser: {payload.message}"
            )
        return payload.message

    def _should_retrieve(self, payload: ChatRequest) -> bool:
        if payload.answer_mode == "general":
            return False
        if payload.article_page_id:
            return True
        if payload.answer_mode == "grounded":
            return True
        # "auto" mode: always attempt Justapedia retrieval first, then fall back to general AI
        # if retrieval produces no usable sources.
        return True

    def _build_no_results_message(self, user_message: str) -> str:
        normalized = " ".join(user_message.strip().split())
        if normalized:
            return (
                f"I could not find a relevant Justapedia article for “{normalized}”. "
                "I’m avoiding a guess because this assistant is designed to answer from retrieved Justapedia sources. "
                "Try a fuller article title, a different spelling, or a more specific name."
            )
        return (
            "I could not find a relevant Justapedia article for that query. "
            "Try a fuller article title, a different spelling, or a more specific name."
        )

    def _get_conversation_history(self, conversation_id: str) -> list[tuple[str, str]]:
        conversation = self.db.get(Conversation, conversation_id)
        if not conversation:
            return []

        history: list[tuple[str, str]] = []
        for message in conversation.messages[-6:]:
            if message.content.strip():
                history.append((message.role, message.content.strip()))
        return history

    def _looks_like_follow_up(self, message: str) -> bool:
        normalized = message.strip().lower()
        follow_up_starters = (
            "he ",
            "she ",
            "they ",
            "it ",
            "his ",
            "her ",
            "their ",
            "where was",
            "when did",
            "what about",
            "tell me more",
            "and ",
            "why ",
            "how ",
        )
        return len(normalized.split()) <= 10 or normalized.startswith(follow_up_starters)

    def _build_related_articles(self, chunks: list[ArticleChunk]) -> list[dict[str, Any]]:
        related: list[dict[str, Any]] = []
        seen: set[tuple[str, str]] = set()
        for chunk in chunks:
            key = (chunk.title, chunk.url)
            if key in seen:
                continue
            seen.add(key)
            related.append(
                {
                    "title": chunk.title,
                    "url": chunk.url,
                    "page_id": chunk.page_id,
                    "snippet": chunk.snippet,
                    "relevance_score": chunk.relevance_score,
                }
            )
            if len(related) >= 4:
                break
        return related

    def _build_suggested_questions(self, user_message: str, chunks: list[ArticleChunk]) -> list[str]:
        if not chunks:
            return []

        suggestions: list[str] = []
        primary_titles: list[str] = []
        seen_titles: set[str] = set()
        for chunk in chunks:
            if chunk.title not in seen_titles:
                seen_titles.add(chunk.title)
                primary_titles.append(chunk.title)

        for title in primary_titles[:2]:
            suggestions.extend(
                [
                    f"What are the key facts about {title}?",
                    f"Why is {title} important?",
                ]
            )

        if primary_titles:
            suggestions.append(f"Can you summarize {primary_titles[0]} simply?")

        unique_suggestions: list[str] = []
        seen_questions: set[str] = {user_message.strip().lower()}
        for suggestion in suggestions:
            normalized = suggestion.strip().lower()
            if normalized in seen_questions:
                continue
            seen_questions.add(normalized)
            unique_suggestions.append(suggestion)
            if len(unique_suggestions) >= 4:
                break
        return unique_suggestions
