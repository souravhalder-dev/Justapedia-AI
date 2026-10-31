from functools import lru_cache
from typing import List

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    app_env: str = "development"
    app_name: str = "Justapedia AI API"
    app_version: str = "0.1.0"

    backend_host: str = "0.0.0.0"
    backend_port: int = 8000

    justapedia_api_url: str = "https://justapedia.org/api.php"
    justapedia_request_timeout: int = 20
    justapedia_max_retries: int = 3
    justapedia_cache_ttl_seconds: int = 300

    ai_provider: str = "openrouter"
    ai_model: str = "nvidia/nemotron-3-ultra-550b-a55b:free"
    embed_model: str = "nvidia/llama-nemotron-embed-vl-1b-v2:free"
    ai_api_key: str | None = None
    ollama_base_url: str = "http://localhost:11434"

    # Fallback models (comma-separated) tried in order when primary fails
    openrouter_fallback_models: str = "qwen/qwen3.8-27b:free,google/gemma-4-31b-it:free"

    # Response completeness & quality settings
    chat_max_tokens: int = 3072          # Generous limit so answers are complete and never cut off
    chat_temperature: float = 0.3        # Controlled, high-coherence generation
    chat_max_context_chunks: int = 6     # Sufficient chunks for comprehensive coverage
    chat_max_search_results: int = 5
    chat_max_articles: int = 3           # Retrieve enough articles for full factual coverage

    database_url: str = "postgresql+psycopg://postgres:postgres@localhost:5432/justapedia_ai"
    redis_url: str | None = None

    cors_allowed_origins: List[str] = Field(default_factory=lambda: ["http://localhost:3000"])

    @field_validator("cors_allowed_origins", mode="before")
    @classmethod
    def parse_origins(cls, value: str | list[str]) -> list[str]:
        if isinstance(value, list):
            return value
        return [item.strip() for item in value.split(",") if item.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
