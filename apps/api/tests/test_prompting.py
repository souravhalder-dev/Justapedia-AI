from app.services.justapedia.types import ArticleChunk
from app.services.rag.prompting import build_direct_prompt, build_grounded_prompt


def test_grounded_prompt_contains_untrusted_context_block():
    prompt = build_grounded_prompt(
        "Who founded Justapedia?",
        [
            ArticleChunk(
                title="Justapedia",
                url="https://justapedia.org/wiki/Justapedia",
                page_id="1",
                snippet="Justapedia is a knowledge project.",
                section_title=None,
                chunk_text="Justapedia was founded as a knowledge project.",
                relevance_score=1.0,
            )
        ],
    )

    assert "Untrusted retrieved Justapedia reference material" in prompt
    assert "Do not invent facts" in prompt
    assert "Justapedia was founded as a knowledge project." in prompt


def test_direct_prompt_does_not_claim_retrieval():
    prompt = build_direct_prompt("Hello there")
    assert "Do not claim to have searched Justapedia unless retrieval actually happened." in prompt
    assert "User message:\nHello there" in prompt


def test_prompts_include_explicit_response_language_when_requested():
    direct_prompt = build_direct_prompt("Explain gravity", response_language="Bengali")
    grounded_prompt = build_grounded_prompt(
        "Explain gravity",
        [
            ArticleChunk(
                title="Gravity",
                url="https://justapedia.org/wiki/Gravity",
                page_id="2",
                snippet="Gravity is a natural phenomenon.",
                section_title=None,
                chunk_text="Gravity is a natural phenomenon by which all things with mass are brought toward one another.",
                relevance_score=1.0,
            )
        ],
        response_language="Spanish",
    )

    assert "Answer in Bengali." in direct_prompt
    assert "Answer in Spanish." in grounded_prompt
