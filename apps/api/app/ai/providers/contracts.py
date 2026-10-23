from pathlib import Path
from typing import Protocol, AsyncIterator
from pydantic import BaseModel


class TextModel(Protocol):
    async def structured(self, prompt: str, schema: type[BaseModel], *, timeout: float = 60) -> BaseModel: ...


class EmbeddingProvider(Protocol):
    async def embed(self, texts: list[str], *, timeout: float = 60) -> list[list[float]]: ...


class BatchTranscriber(Protocol):
    async def transcribe(self, path: Path, prompt: str = "") -> str: ...


class LiveTranscriber(Protocol):
    async def start_session(self, prompt: str = "") -> None: ...
    async def send_audio(self, pcm: bytes) -> None: ...
    async def commit(self) -> None: ...
    def receive_events(self) -> AsyncIterator[dict]: ...
    async def close(self) -> None: ...


class VisionModel(Protocol):
    async def structured_images(
        self,
        prompt: str,
        images: list[str],
        schema: type[BaseModel],
        *,
        timeout: float = 120,
        max_output_tokens: int = 12000,
    ) -> BaseModel: ...
