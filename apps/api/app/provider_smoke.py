"""Opt-in paid API check using a supplied, authorized PCM WAV fixture.
Run: docker compose exec -e RUN_OPENAI_SMOKE=1 api python -m app.provider_smoke /tmp/speech.wav
"""

import asyncio
import os
import sys
import wave
from pathlib import Path
from pydantic import BaseModel, ConfigDict
from .ai.providers.openai import OpenAIBatch, OpenAILive, OpenAIEmbeddings, OpenAIText


class Topic(BaseModel):
    model_config = ConfigDict(extra="forbid")
    topic: str


async def main(path):
    if os.getenv("RUN_OPENAI_SMOKE") != "1":
        raise SystemExit("Set RUN_OPENAI_SMOKE=1 explicitly; this makes paid external API calls.")
    text = await OpenAIBatch().transcribe(path)
    if not text.strip():
        raise RuntimeError("File transcription returned no speech.")
    print("File transcript:", text[:300])
    vectors = await OpenAIEmbeddings().embed(["Binary search halves a sorted search interval."])
    print("Embedding dimensions:", len(vectors[0]))
    topic = await OpenAIText().structured(
        "Name this teaching topic: binary search halves a sorted search interval.", Topic
    )
    print("Structured topic:", topic.topic)
    live = OpenAILive()
    try:
        await live.start_session("A short computer science lecture.")

        async def receive():
            async for event in live.receive_events():
                if event.get("type", "").endswith("input_audio_transcription.completed"):
                    print("Live transcript:", event.get("transcript", "")[:300])
                    return

        task = asyncio.create_task(receive())
        with wave.open(str(path), "rb") as audio:
            if audio.getframerate() != 24000 or audio.getnchannels() != 1 or audio.getsampwidth() != 2:
                raise RuntimeError("Use 24 kHz mono PCM16 WAV.")
            while data := audio.readframes(2400):
                await live.send_audio(data)
                await asyncio.sleep(0.03)
        await live.commit()
        await asyncio.wait_for(task, 30)
    finally:
        await live.close()
    print("All provider checks passed.")


if __name__ == "__main__":
    asyncio.run(main(Path(sys.argv[1])))
