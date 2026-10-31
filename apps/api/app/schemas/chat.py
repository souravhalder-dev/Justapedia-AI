from typing import Literal

from pydantic import BaseModel, Field


class ChatRequest(BaseModel):
    conversation_id: str | None = None
    message: str = Field(..., min_length=1, max_length=8000)
    article_action: str | None = Field(default=None, max_length=64)
    article_page_id: str | None = Field(default=None, max_length=64)
    answer_mode: Literal["auto", "grounded", "general"] = "auto"
    response_language: str | None = Field(default=None, max_length=64)


class SearchResult(BaseModel):
    title: str
    url: str
    page_id: str | None = None
    snippet: str
    relevance_score: float


class ArticleRead(BaseModel):
    page_id: str | None = None
    title: str
    url: str
    excerpt: str
    content: str | None = None
