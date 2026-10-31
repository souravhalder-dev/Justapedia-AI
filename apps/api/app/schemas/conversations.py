from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class ConversationCreate(BaseModel):
    title: str | None = Field(default=None, max_length=255)


class ConversationUpdate(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)


class ConversationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    title: str
    created_at: datetime
    updated_at: datetime | None = None


class SourceRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    title: str
    url: str
    page_id: str | None = None
    snippet: str
    section_title: str | None = None
    relevance_score: float


class MessageRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    role: str
    content: str
    status: str
    model: str | None = None
    created_at: datetime
    sources: list[SourceRead] = Field(default_factory=list)


class FeedbackCreate(BaseModel):
    message_id: str
    rating: str = Field(pattern="^(positive|negative)$")
    reason: str | None = Field(default=None, max_length=120)
    comment: str | None = Field(default=None, max_length=2000)


class FeedbackRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    message_id: str
    rating: str
    reason: str | None = None
    comment: str | None = None
