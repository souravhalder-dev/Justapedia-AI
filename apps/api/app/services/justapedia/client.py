import asyncio
from typing import Any

import httpx
from cachetools import TTLCache

from app.core.config import get_settings
from app.services.justapedia.types import JustapediaArticle, JustapediaSearchItem
from app.services.justapedia.utils import clean_html_snippet, normalize_text


class JustapediaClientError(Exception):
    pass


class JustapediaClient:
    def __init__(self) -> None:
        self.settings = get_settings()
        self.cache: TTLCache[str, Any] = TTLCache(maxsize=512, ttl=self.settings.justapedia_cache_ttl_seconds)
        self.headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "en-US,en;q=0.9",
        }

    async def search(self, query: str, limit: int | None = None) -> list[JustapediaSearchItem]:
        limit = limit or self.settings.chat_max_search_results
        cache_key = f"search:{query.strip().lower()}:{limit}"
        if cache_key in self.cache:
            return self.cache[cache_key]

        params = {
            "action": "query",
            "format": "json",
            "utf8": "1",
            "list": "search",
            "srsearch": query,
            "srlimit": limit,
        }
        data = await self._request_json(params)
        items: list[JustapediaSearchItem] = []
        for rank, item in enumerate(data.get("query", {}).get("search", []), start=1):
            page_id = str(item.get("pageid")) if item.get("pageid") is not None else None
            title = item.get("title", "Untitled")
            url = f"https://justapedia.org/wiki/{title.replace(' ', '_')}"
            snippet = clean_html_snippet(item.get("snippet", ""))
            score = max(0.0, 1.0 - ((rank - 1) * 0.12))
            items.append(
                JustapediaSearchItem(
                    title=title,
                    url=url,
                    page_id=page_id,
                    snippet=snippet,
                    score=score,
                )
            )
        self.cache[cache_key] = items
        return items

    async def get_article(self, page_id: str | None = None, title: str | None = None) -> JustapediaArticle:
        identifier = page_id or title
        if not identifier:
            raise ValueError("Either page_id or title must be provided.")

        cache_key = f"article:{identifier}"
        if cache_key in self.cache:
            return self.cache[cache_key]

        params = {
            "action": "query",
            "format": "json",
            "utf8": "1",
            "prop": "extracts|info",
            "inprop": "url",
            "explaintext": "1",
            "redirects": "1",
        }
        if page_id:
            params["pageids"] = page_id
        else:
            params["titles"] = title

        data = await self._request_json(params)
        pages = data.get("query", {}).get("pages", {})
        if not pages:
            raise JustapediaClientError("Justapedia returned no article pages.")

        page = next(iter(pages.values()))
        article = JustapediaArticle(
            title=page.get("title", title or "Untitled"),
            url=page.get("fullurl") or f"https://justapedia.org/wiki/{page.get('title', '').replace(' ', '_')}",
            page_id=str(page.get("pageid")) if page.get("pageid") is not None else page_id,
            text=normalize_text(page.get("extract", "")),
        )
        self.cache[cache_key] = article
        return article

    async def _request_json(self, params: dict[str, Any]) -> dict[str, Any]:
        timeout = httpx.Timeout(10.0)
        last_error: Exception | None = None

        for attempt in range(1, self.settings.justapedia_max_retries + 1):
            try:
                async with httpx.AsyncClient(timeout=timeout, headers=self.headers, follow_redirects=True) as client:
                    response = await client.get(self.settings.justapedia_api_url, params=params)
                    response.raise_for_status()
                    return response.json()
            except (httpx.HTTPError, ValueError) as exc:
                last_error = exc
                if attempt < self.settings.justapedia_max_retries:
                    await asyncio.sleep(0.5 * attempt)

        raise JustapediaClientError("Failed to retrieve data from Justapedia.") from last_error
