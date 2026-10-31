import re


SMALL_TALK_PATTERNS = [
    r"^(hi|hello|hey)\b",
    r"^(thanks|thank you)\b",
    r"^(good morning|good evening|good night)\b",
    r"^(who are you)\b",
]


class QueryRouter:
    def needs_retrieval(self, query: str) -> bool:
        normalized = query.strip().lower()
        if not normalized:
            return False
        return not any(re.search(pattern, normalized) for pattern in SMALL_TALK_PATTERNS)
