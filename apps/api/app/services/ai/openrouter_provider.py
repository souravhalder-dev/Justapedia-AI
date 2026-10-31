"""OpenRouter AI provider using LangChain's ChatOpenAI with streaming support.

Chat model  : nvidia/nemotron-3-ultra-550b-a55b:free
Embed model : nvidia/llama-nemotron-embed-vl-1b-v2:free
Fallbacks   : qwen/qwen3.8-27b:free, google/gemma-4-31b-it:free

Token efficiency strategy:
- max_tokens capped at settings.chat_max_tokens (default 1024)
- temperature at 0.4 (focused, less random sampling = fewer tokens wasted)
- Automatic model fallback on rate-limit or quota errors
"""
from __future__ import annotations

import logging
from collections.abc import AsyncIterator

from langchain_openai import ChatOpenAI, OpenAIEmbeddings

from app.core.config import get_settings

logger = logging.getLogger(__name__)

_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"

_RETRIABLE_ERRORS = (
    "rate limit",
    "quota",
    "overloaded",
    "unavailable",
    "503",
    "429",
)


def _is_retriable(exc: Exception) -> bool:
    msg = str(exc).lower()
    return any(kw in msg for kw in _RETRIABLE_ERRORS)


def _make_chat_llm(model: str, settings) -> ChatOpenAI:
    return ChatOpenAI(
        model=model,
        openai_api_key=settings.ai_api_key,
        openai_api_base=_OPENROUTER_BASE_URL,
        streaming=True,
        temperature=settings.chat_temperature,
        max_tokens=settings.chat_max_tokens,
        default_headers={
            "HTTP-Referer": "https://justapedia.org",
            "X-Title": "Justapedia AI",
        },
    )


def _make_embed_model(settings) -> OpenAIEmbeddings:
    return OpenAIEmbeddings(
        model=settings.embed_model,
        openai_api_key=settings.ai_api_key,
        openai_api_base=_OPENROUTER_BASE_URL,
    )


class OpenRouterProvider:
    """LangChain-backed provider that calls OpenRouter with automatic model fallback."""

    def __init__(self) -> None:
        self.settings = get_settings()

        # Build ordered list: primary model + fallbacks
        fallback_strs = [
            m.strip()
            for m in self.settings.openrouter_fallback_models.split(",")
            if m.strip()
        ]
        self._models = [self.settings.ai_model] + fallback_strs
        self._llms = [_make_chat_llm(m, self.settings) for m in self._models]
        self._embeddings = _make_embed_model(self.settings)

    # ------------------------------------------------------------------
    # Chat interface (required by AIProvider protocol)
    # ------------------------------------------------------------------

    async def generate_response(self, prompt: str) -> str:
        chunks: list[str] = []
        async for chunk in self.stream_response(prompt):
            chunks.append(chunk)
        return "".join(chunks).strip()

    async def stream_response(self, prompt: str) -> AsyncIterator[str]:
        last_exc: Exception | None = None
        for idx, llm in enumerate(self._llms):
            model_name = self._models[idx]
            try:
                async for event in llm.astream(prompt):
                    text = event.content
                    if text:
                        yield text
                return  # success — stop iterating models
            except Exception as exc:
                last_exc = exc
                if _is_retriable(exc) and idx < len(self._llms) - 1:
                    logger.warning(
                        "Model %s failed (%s), trying fallback %s",
                        model_name,
                        exc,
                        self._models[idx + 1],
                    )
                    continue
                raise

        if last_exc:
            raise last_exc

    # ------------------------------------------------------------------
    # Embedding interface (optional, used by RAG re-ranking if enabled)
    # ------------------------------------------------------------------

    async def embed_texts(self, texts: list[str]) -> list[list[float]]:
        return await self._embeddings.aembed_documents(texts)

    async def embed_query(self, query: str) -> list[float]:
        return await self._embeddings.aembed_query(query)
