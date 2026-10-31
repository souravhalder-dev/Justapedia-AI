from dataclasses import dataclass


@dataclass
class JustapediaSearchItem:
    title: str
    url: str
    page_id: str | None
    snippet: str
    score: float


@dataclass
class JustapediaArticle:
    title: str
    url: str
    page_id: str | None
    text: str


@dataclass
class ArticleChunk:
    title: str
    url: str
    page_id: str | None
    snippet: str
    section_title: str | None
    chunk_text: str
    relevance_score: float
