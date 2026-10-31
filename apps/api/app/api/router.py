from fastapi import APIRouter

from app.api.routes import chat, conversations, feedback, health, knowledge


api_router = APIRouter()
api_router.include_router(health.router, tags=["health"])
api_router.include_router(conversations.router, prefix="/api/v1/conversations", tags=["conversations"])
api_router.include_router(chat.router, prefix="/api/v1/chat", tags=["chat"])
api_router.include_router(knowledge.router, prefix="/api/v1", tags=["knowledge"])
api_router.include_router(feedback.router, prefix="/api/v1/feedback", tags=["feedback"])
