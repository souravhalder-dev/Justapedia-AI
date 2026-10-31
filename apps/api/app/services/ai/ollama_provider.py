import json
from collections.abc import AsyncIterator

import httpx

from app.core.config import get_settings
from app.services.ai.base import AIProvider


class OllamaProvider(AIProvider):
    def __init__(self) -> None:
        self.settings = get_settings()

    async def generate_response(self, prompt: str) -> str:
        chunks = []
        async for chunk in self.stream_response(prompt):
            chunks.append(chunk)
        return "".join(chunks).strip()

    async def stream_response(self, prompt: str) -> AsyncIterator[str]:
        payload = {
            "model": self.settings.ai_model,
            "prompt": prompt,
            "stream": True,
        }

        async with httpx.AsyncClient(timeout=httpx.Timeout(60.0)) as client:
            async with client.stream("POST", f"{self.settings.ollama_base_url}/api/generate", json=payload) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if not line:
                        continue
                    data = json.loads(line)
                    if data.get("response"):
                        yield data["response"]
                    if data.get("done"):
                        break
