import re
from html import unescape


STOPWORDS = {
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "by",
    "for",
    "from",
    "how",
    "in",
    "is",
    "it",
    "of",
    "on",
    "or",
    "that",
    "the",
    "to",
    "what",
    "when",
    "where",
    "who",
    "why",
}


def clean_html_snippet(value: str) -> str:
    value = re.sub(r"<[^>]+>", " ", value or "")
    return normalize_text(unescape(value))


def normalize_text(value: str) -> str:
    value = unescape(value or "")
    value = value.replace("\r", "\n")
    value = re.sub(r"\n{3,}", "\n\n", value)
    value = re.sub(r"[ \t]+", " ", value)
    return value.strip()


def tokenize_for_scoring(value: str) -> list[str]:
    tokens = re.findall(r"[a-zA-Z0-9]+", value.lower())
    return [token for token in tokens if token not in STOPWORDS and len(token) > 1]


def truncate_text(value: str, limit: int = 320) -> str:
    text = normalize_text(value)
    if len(text) <= limit:
        return text
    return text[: limit - 3].rstrip() + "..."
