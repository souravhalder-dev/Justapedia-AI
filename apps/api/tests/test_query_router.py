from app.services.rag.query_router import QueryRouter


def test_small_talk_skips_retrieval():
    router = QueryRouter()
    assert router.needs_retrieval("Hello") is False
    assert router.needs_retrieval("Thank you") is False


def test_knowledge_query_uses_retrieval():
    router = QueryRouter()
    assert router.needs_retrieval("Who was the first Mughal emperor?") is True
