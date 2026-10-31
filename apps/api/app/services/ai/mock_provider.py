import asyncio
from collections.abc import AsyncIterator

from app.services.ai.base import AIProvider


class MockProvider(AIProvider):
    async def generate_response(self, prompt: str) -> str:
        return self._summarize(prompt)

    async def stream_response(self, prompt: str) -> AsyncIterator[str]:
        text = self._summarize(prompt)
        for word in text.split():
            yield f"{word} "
            await asyncio.sleep(0.01)

    def _summarize(self, prompt: str) -> str:
        if "No trusted Justapedia context was found" in prompt:
            return "I could not find enough reliable information from Justapedia to answer that confidently."

        if "User message:\n" in prompt and "[Source " not in prompt:
            user_message = prompt.split("User message:\n", 1)[1].split("\n\n", 1)[0].strip()
            return (
                f"I understood your request: {user_message}. "
                "The app is currently using the mock provider, so this is only a development-style reply. "
                "Switch the backend to Ollama for real multilingual answers that feel much closer to ChatGPT."
            )

        sources = []
        for block in prompt.split("[Source ")[1:]:
            title_line = next((line for line in block.splitlines() if line.startswith("Title: ")), None)
            if title_line:
                sources.append(title_line.replace("Title: ", "", 1))

        if not sources:
            return "I could not find enough reliable information from Justapedia to answer that confidently."

        joined = ", ".join(sources[:3])
        return (
            f"Based on Justapedia sources including {joined}, I found relevant material for your question. "
            "This Phase 1 mock provider is wired correctly, but for real answer generation you should switch "
            "the backend provider to Ollama or another compatible model."
        )
