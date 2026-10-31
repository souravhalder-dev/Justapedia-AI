import os

os.environ["DATABASE_URL"] = "sqlite+pysqlite:///:memory:"
os.environ["AI_PROVIDER"] = "mock"

from collections.abc import AsyncIterator

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.base import Base
from app.dependencies import get_ai_provider, get_db, get_query_router, get_retrieval_service
from app.main import app
from app.services.justapedia.types import ArticleChunk


engine = create_engine(
    "sqlite+pysqlite:///:memory:",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)
Base.metadata.create_all(bind=engine)


class FakeProvider:
    async def generate_response(self, prompt: str) -> str:
        return "Bangladesh is a country in South Asia."

    async def stream_response(self, prompt: str) -> AsyncIterator[str]:
        yield "Bangladesh is "
        yield "a country in South Asia."


class FakeRetrievalService:
    async def retrieve(self, query: str):
        return [
            ArticleChunk(
                title="Bangladesh",
                url="https://justapedia.org/wiki/Bangladesh",
                page_id="10",
                snippet="Bangladesh is a country in South Asia.",
                section_title=None,
                chunk_text="Bangladesh is a country in South Asia.",
                relevance_score=1.0,
            )
        ]

    async def retrieve_article(self, page_id: str | None = None, title: str | None = None, query: str = ""):
        return await self.retrieve(query)


class FakeQueryRouter:
    def needs_retrieval(self, query: str) -> bool:
        return True


def override_get_db():
    db: Session = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


app.dependency_overrides[get_db] = override_get_db
app.dependency_overrides[get_ai_provider] = lambda: FakeProvider()
app.dependency_overrides[get_retrieval_service] = lambda: FakeRetrievalService()
app.dependency_overrides[get_query_router] = lambda: FakeQueryRouter()

client = TestClient(app)


def test_health_endpoint():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_conversation_creation_and_streaming_chat():
    create_response = client.post("/api/v1/conversations", json={"title": "Test chat"})
    assert create_response.status_code == 201
    conversation_id = create_response.json()["id"]

    stream_response = client.post(
        "/api/v1/chat/stream",
        json={
            "conversation_id": conversation_id,
            "message": "Tell me about Bangladesh.",
        },
    )
    assert stream_response.status_code == 200
    assert "event: final" in stream_response.text

    messages_response = client.get(f"/api/v1/conversations/{conversation_id}/messages")
    assert messages_response.status_code == 200
    messages = messages_response.json()
    assert len(messages) == 2
    assert messages[0]["role"] == "user"
    assert messages[1]["role"] == "assistant"
    assert messages[1]["sources"][0]["title"] == "Bangladesh"


def test_general_mode_skips_grounded_sources():
    create_response = client.post("/api/v1/conversations", json={"title": "General chat"})
    assert create_response.status_code == 201
    conversation_id = create_response.json()["id"]

    stream_response = client.post(
        "/api/v1/chat/stream",
        json={
            "conversation_id": conversation_id,
            "message": "Say hello in Bengali.",
            "answer_mode": "general",
            "response_language": "Bengali",
        },
    )
    assert stream_response.status_code == 200
    assert "event: final" in stream_response.text

    messages_response = client.get(f"/api/v1/conversations/{conversation_id}/messages")
    assert messages_response.status_code == 200
    messages = messages_response.json()
    assert len(messages) == 2
    assert messages[1]["role"] == "assistant"
    assert messages[1]["sources"] == []
