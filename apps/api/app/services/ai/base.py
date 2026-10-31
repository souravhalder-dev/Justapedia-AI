from collections.abc import AsyncIterator
from typing import Protocol


class AIProvider(Protocol):
    async def generate_response(self, prompt: str) -> str: ...

    async def stream_response(self, prompt: str) -> AsyncIterator[str]: ...
