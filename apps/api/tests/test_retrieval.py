import pytest

from app.services.justapedia.types import JustapediaArticle, JustapediaSearchItem
from app.services.rag.retrieval import RetrievalService


class FakeJustapediaClient:
    async def search(self, query: str, limit: int | None = None):
        return [
            JustapediaSearchItem(
                title="Bangladesh",
                url="https://justapedia.org/wiki/Bangladesh",
                page_id="10",
                snippet="Bangladesh is a country in South Asia.",
                score=1.0,
            )
        ]

    async def get_article(self, page_id: str | None = None, title: str | None = None):
        return JustapediaArticle(
            title="Bangladesh",
            url="https://justapedia.org/wiki/Bangladesh",
            page_id=page_id or "10",
            text=(
                "Bangladesh is a country in South Asia.\n\n"
                "Dhaka is the capital city of Bangladesh.\n\n"
                "The country became independent in 1971."
            ),
        )


@pytest.mark.asyncio
async def test_retrieve_returns_ranked_chunks():
    service = RetrievalService(FakeJustapediaClient())
    chunks = await service.retrieve("What is the capital of Bangladesh?")

    assert chunks
    assert chunks[0].title == "Bangladesh"
    assert "Dhaka" in chunks[0].chunk_text


@pytest.mark.asyncio
async def test_retrieve_article_uses_selected_article():
    service = RetrievalService(FakeJustapediaClient())
    chunks = await service.retrieve_article(page_id="10", query="Summarize this article")

    assert chunks
    assert all(chunk.page_id == "10" for chunk in chunks)
