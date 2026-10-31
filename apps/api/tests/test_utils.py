from app.services.justapedia.utils import clean_html_snippet, tokenize_for_scoring, truncate_text


def test_clean_html_snippet_removes_tags_and_unescapes_entities():
    value = "<span>History &amp; culture</span><b> matters</b>"
    assert clean_html_snippet(value) == "History & culture matters"


def test_tokenize_for_scoring_filters_stopwords():
    tokens = tokenize_for_scoring("What is the history of Justapedia and why does it matter?")
    assert "history" in tokens
    assert "justapedia" in tokens
    assert "what" not in tokens
    assert "the" not in tokens


def test_truncate_text_adds_ellipsis_for_long_values():
    text = "a" * 40
    assert truncate_text(text, limit=20) == ("a" * 17) + "..."
