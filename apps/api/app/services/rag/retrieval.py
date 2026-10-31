import asyncio
from app.core.config import get_settings
from app.services.justapedia.client import JustapediaClient
from app.services.justapedia.types import ArticleChunk, JustapediaArticle
from app.services.justapedia.utils import tokenize_for_scoring, truncate_text


class RetrievalService:
    def __init__(self, client: JustapediaClient) -> None:
        self.client = client
        self.settings = get_settings()

    async def retrieve(self, query: str) -> list[ArticleChunk]:
        search_results = await self.client.search(query, limit=self.settings.chat_max_search_results)
        if not search_results:
            return []

        # Concurrently fetch articles for maximal speed
        top_items = search_results[: self.settings.chat_max_articles]
        tasks = [
            self.client.get_article(page_id=item.page_id, title=item.title)
            for item in top_items
        ]
        articles = await asyncio.gather(*tasks, return_exceptions=True)

        chunks: list[ArticleChunk] = []
        for idx, article in enumerate(articles):
            if isinstance(article, JustapediaArticle) and article.text:
                article_score = top_items[idx].score
                article_chunks = self._build_chunks(article, article_score)
                chunks.extend(self._score_chunks(query, article_chunks))

        ranked = sorted(chunks, key=lambda item: item.relevance_score, reverse=True)
        return ranked[: self.settings.chat_max_context_chunks]

    async def retrieve_article(self, page_id: str | None = None, title: str | None = None, query: str = "") -> list[ArticleChunk]:
        article = await self.client.get_article(page_id=page_id, title=title)
        article_chunks = self._build_chunks(article, article_score=1.0)
        ranked = self._score_chunks(query or article.title, article_chunks)
        ranked = sorted(ranked, key=lambda item: item.relevance_score, reverse=True)
        return ranked[: self.settings.chat_max_context_chunks]

    def _build_chunks(self, article: JustapediaArticle, article_score: float) -> list[ArticleChunk]:
        paragraphs = [part.strip() for part in article.text.split("\n\n") if part.strip()]
        if not paragraphs and article.text:
            paragraphs = [article.text]

        merged_chunks: list[str] = []
        buffer = ""
        for paragraph in paragraphs:
            if len(buffer) + len(paragraph) < 700:
                buffer = f"{buffer}\n\n{paragraph}".strip()
            else:
                if buffer:
                    merged_chunks.append(buffer)
                buffer = paragraph
        if buffer:
            merged_chunks.append(buffer)

        return [
            ArticleChunk(
                title=article.title,
                url=article.url,
                page_id=article.page_id,
                snippet=truncate_text(chunk, 240),
                section_title=None,
                chunk_text=chunk,
                relevance_score=article_score,
            )
            for chunk in merged_chunks[:6]
        ]

    def _score_chunks(self, query: str, chunks: list[ArticleChunk]) -> list[ArticleChunk]:
        query_tokens = set(tokenize_for_scoring(query))
        if not query_tokens:
            return chunks

        scored: list[ArticleChunk] = []
        for chunk in chunks:
            chunk_tokens = set(tokenize_for_scoring(chunk.chunk_text))
            overlap = len(query_tokens.intersection(chunk_tokens))
            score = chunk.relevance_score + (overlap / max(len(query_tokens), 1))
            scored.append(
                ArticleChunk(
                    title=chunk.title,
                    url=chunk.url,
                    page_id=chunk.page_id,
                    snippet=chunk.snippet,
                    section_title=chunk.section_title,
                    chunk_text=chunk.chunk_text,
                    relevance_score=round(score, 4),
                )
            )
        return scored
