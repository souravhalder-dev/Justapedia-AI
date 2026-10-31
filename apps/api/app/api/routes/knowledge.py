from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.dependencies import get_justapedia_client
from app.schemas.chat import ArticleRead, SearchResult
from app.services.justapedia.client import JustapediaClient, JustapediaClientError
from app.services.justapedia.utils import truncate_text


router = APIRouter()


@router.get("/search", response_model=list[SearchResult])
async def search_justapedia(
    q: str = Query(..., min_length=1, max_length=400),
    client: JustapediaClient = Depends(get_justapedia_client),
) -> list[SearchResult]:
    try:
        results = await client.search(q)
    except JustapediaClientError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

    return [
        SearchResult(
            title=item.title,
            url=item.url,
            page_id=item.page_id,
            snippet=item.snippet,
            relevance_score=item.score,
        )
        for item in results
    ]


@router.get("/articles/{page_id}", response_model=ArticleRead)
async def get_article(
    page_id: str,
    client: JustapediaClient = Depends(get_justapedia_client),
) -> ArticleRead:
    try:
        article = await client.get_article(page_id=page_id)
    except JustapediaClientError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

    if not article.text:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Article not found.")

    return ArticleRead(
        page_id=article.page_id,
        title=article.title,
        url=article.url,
        excerpt=truncate_text(article.text, 500),
        content=article.text,
    )
