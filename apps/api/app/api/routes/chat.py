import json
from collections.abc import AsyncIterator

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.dependencies import get_ai_provider, get_db, get_query_router, get_retrieval_service
from app.schemas.chat import ChatRequest
from app.services.ai.base import AIProvider
from app.services.chat.service import ChatService
from app.services.rag.query_router import QueryRouter
from app.services.rag.retrieval import RetrievalService


router = APIRouter()


def format_sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


@router.post("/stream")
async def stream_chat(
    payload: ChatRequest,
    db: Session = Depends(get_db),
    retrieval_service: RetrievalService = Depends(get_retrieval_service),
    query_router: QueryRouter = Depends(get_query_router),
    ai_provider: AIProvider = Depends(get_ai_provider),
) -> StreamingResponse:
    service = ChatService(
        db=db,
        retrieval_service=retrieval_service,
        query_router=query_router,
        ai_provider=ai_provider,
    )

    async def event_stream() -> AsyncIterator[str]:
        async for item in service.stream_chat(payload):
            yield format_sse(item["event"], item["data"])

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
