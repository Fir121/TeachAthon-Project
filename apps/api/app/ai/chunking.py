"""Local, deterministic, paragraph-aware chunks. Offsets refer to the original source text."""

from functools import lru_cache
import semchunk
import tiktoken

CHUNK_VERSION = "semchunk-4.1.1-cl100k-512-64-v1"


@lru_cache(maxsize=1)
def chunker():
    return semchunk.chunkerify(tiktoken.get_encoding("cl100k_base"), 512, chunking_model=None, cache_maxsize=10000)


def split_text(text):
    if not text.strip():
        return []
    chunks, offsets = chunker()(text, offsets=True, overlap=64)
    return [
        {"text": value, "start_char": start, "end_char": end, "version": CHUNK_VERSION}
        for value, (start, end) in zip(chunks, offsets, strict=True)
    ]
