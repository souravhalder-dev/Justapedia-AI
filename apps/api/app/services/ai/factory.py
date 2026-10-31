from app.core.config import get_settings
from app.services.ai.base import AIProvider
from app.services.ai.mock_provider import MockProvider
from app.services.ai.ollama_provider import OllamaProvider
from app.services.ai.openrouter_provider import OpenRouterProvider


def create_ai_provider() -> AIProvider:
    settings = get_settings()
    provider = settings.ai_provider.strip().lower()

    if provider == "mock":
        return MockProvider()
    if provider == "ollama":
        return OllamaProvider()
    if provider == "openrouter":
        return OpenRouterProvider()

    raise ValueError(f"Unsupported AI provider: {settings.ai_provider}")
