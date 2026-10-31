from fastapi import Depends

from app.db.session import get_db
from app.services.ai.base import AIProvider
from app.services.ai.factory import create_ai_provider
from app.services.justapedia.client import JustapediaClient
from app.services.rag.query_router import QueryRouter
from app.services.rag.retrieval import RetrievalService


def get_justapedia_client() -> JustapediaClient:
    return JustapediaClient()


def get_retrieval_service(client: JustapediaClient = Depends(get_justapedia_client)) -> RetrievalService:
    return RetrievalService(client)


def get_query_router() -> QueryRouter:
    return QueryRouter()


def get_ai_provider() -> AIProvider:
    return create_ai_provider()


__all__ = [
    "get_ai_provider",
    "get_db",
    "get_justapedia_client",
    "get_query_router",
    "get_retrieval_service",
]
