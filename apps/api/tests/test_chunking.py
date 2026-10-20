import tiktoken
from app.ai.chunking import split_text, CHUNK_VERSION


def test_local_chunks_boundaries_offsets_and_content(monkeypatch):
    import requests

    def forbidden(*args, **kwargs):
        raise AssertionError("Chunking must not call a network service")

    monkeypatch.setattr(requests, "get", forbidden)
    encoding = tiktoken.get_encoding("cl100k_base")
    paragraphs = [f"Paragraph {i}. " + ("The search interval halves after each comparison. " * 36) for i in range(12)]
    text = "\n\n".join(paragraphs)
    parts = split_text(text)
    assert len(parts) > 2
    covered = set()
    for part in parts:
        assert part["text"] == text[part["start_char"] : part["end_char"]]
        assert 0 < len(encoding.encode(part["text"])) <= 512
        assert part["version"] == CHUNK_VERSION
        covered.update(range(part["start_char"], part["end_char"]))
    assert all(i in covered for i, value in enumerate(text) if not value.isspace())
    assert any(a["end_char"] > b["start_char"] for a, b in zip(parts, parts[1:]))
    short = "First paragraph.\n\nSecond paragraph."
    assert split_text(short)[0]["text"] == short
    assert split_text("  \n\n ") == []
