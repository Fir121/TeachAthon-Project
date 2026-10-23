"""Failure categories and trace metadata must never include private request/response content."""

import asyncio
import json
import time
import httpx
import pytest
from sqlalchemy import select
from test_classroom import room as room
from app.config import settings
from app.models import Resource, SourceChunk
from app.ai import search_engine
from app.ai.evidence import RelevanceOutput
from app.ai.providers import openai as provider

PRIVATE_QUERY = "sensitive-authored-query"
PRIVATE_SOURCE = "sensitive-authored-source-text"
PRIVATE_ERROR = "sensitive-provider-body-and-credentials"


@pytest.fixture
def sources(room, monkeypatch):
    _, student, _, factory, cid, *_ = room
    with factory() as db:
        resource = db.scalar(select(Resource).where(Resource.course_id == cid))
        db.add(
            SourceChunk(
                course_id=cid,
                resource_id=resource.id,
                source_type="resource",
                title=PRIVATE_SOURCE,
                text=PRIVATE_SOURCE,
                embedding=[1.0, 0.0],
                embedding_model=settings().openai_embed_model,
            )
        )
        db.commit()
    monkeypatch.setattr(settings(), "openai_api_key", "contract-fixture-only")

    async def vectors(self, texts, **kwargs):
        return [[1.0, 0.0] for _ in texts]

    monkeypatch.setattr(provider.OpenAIEmbeddings, "embed", vectors)
    return student, factory, cid


def records(caplog):
    return [
        json.loads(r.getMessage().split("semantic_search_failed ", 1)[1])
        for r in caplog.records
        if r.getMessage().startswith("semantic_search_failed ")
    ]


@pytest.mark.parametrize("failure", ["http", "timeout", "schema", "schema_extra", "unexpected", "coverage"])
def test_fallback_logs_traceable_sanitized_failure(sources, monkeypatch, caplog, failure):
    student, _, cid = sources

    async def fail(self, *args, **kwargs):
        if failure == "http":
            raise provider.OpenAIRequestError(429, "req_authored_test")
        if failure == "timeout":
            raise TimeoutError(PRIVATE_ERROR)
        if failure == "schema":
            return RelevanceOutput.model_validate({"decisions": PRIVATE_ERROR})
        if failure == "schema_extra":
            return RelevanceOutput.model_validate({"decisions": [], PRIVATE_ERROR: PRIVATE_QUERY})
        if failure == "coverage":
            return RelevanceOutput(decisions=[])
        raise ValueError(PRIVATE_ERROR)

    monkeypatch.setattr(
        provider.OpenAIEmbeddings if failure in {"http", "timeout"} else provider.OpenAIText,
        "embed" if failure in {"http", "timeout"} else "structured",
        fail,
    )
    result = student.get(f"/api/v1/courses/{cid}/search", params={"q": PRIVATE_QUERY})
    assert result.status_code == 200
    assert "Semantic source assessment is unavailable" in result.json()["warnings"][0]
    entries = records(caplog)
    assert len(entries) == 1
    entry = entries[0]
    assert entry["course_id"] == cid and entry["mode"] == "keywords"
    assert len(entry["search_id"]) == 32
    assert entry["elapsed_ms"] >= entry["stage_elapsed_ms"] >= 0
    assert entry["remaining_ms"] > 0
    assert entry["stack"][-1]["function"] in {"fail", "judge", "model_validate"}
    assert entry["text_model"] == settings().openai_text_model
    if failure in {"http", "timeout"}:
        assert entry["stage"] == "query_embedding"
    else:
        assert entry["stage"] == "source_assessment" and entry["candidate_count"] == 1
    if failure == "http":
        assert entry["reason"] == "provider_http_error"
        assert entry["http_status"] == 429 and entry["provider_request_id"] == "req_authored_test"
    elif failure == "timeout":
        assert entry["reason"] == "timeout"
    elif failure in {"schema", "schema_extra"}:
        assert entry["reason"] == "schema_validation_error" and entry["validation_error_count"] == 1
        assert entry["validation_errors"] == (
            [{"type": "list_type", "location": ["decisions"]}]
            if failure == "schema"
            else [{"type": "extra_forbidden", "location": ["*"]}]
        )
    elif failure == "coverage":
        assert entry["reason"] == "source_id_coverage"
        assert entry["coverage"] == {"expected": 1, "returned": 0, "missing": 1, "unexpected": 0, "duplicates": 0}
    else:
        assert entry["reason"] == "unexpected_error"
    assert not any(
        secret in caplog.text for secret in (PRIVATE_QUERY, PRIVATE_SOURCE, PRIVATE_ERROR, "contract-fixture-only")
    )


def test_expired_search_logs_before_propagating_timeout(sources, caplog):
    _, factory, cid = sources
    with factory() as db, pytest.raises(TimeoutError):
        search_engine.run_search(db, cid, PRIVATE_QUERY, time.monotonic() - 1)
    entry = records(caplog)[0]
    assert entry["reason"] == "timeout" and entry["remaining_ms"] == 0
    assert PRIVATE_QUERY not in caplog.text


@pytest.mark.parametrize(
    "request_id,expected", [("req_authored_test", "req_authored_test"), (PRIVATE_ERROR + " invalid", None)]
)
def test_http_error_preserves_only_safe_provider_metadata(monkeypatch, request_id, expected):
    monkeypatch.setattr(settings(), "openai_api_key", "contract-fixture-only")
    client = httpx.AsyncClient
    transport = httpx.MockTransport(
        lambda _: httpx.Response(
            429,
            headers={"x-request-id": request_id},
            json={"error": {"message": PRIVATE_ERROR}},
        )
    )
    monkeypatch.setattr(provider.httpx, "AsyncClient", lambda **kwargs: client(transport=transport, **kwargs))
    with pytest.raises(provider.OpenAIRequestError) as error:
        asyncio.run(provider.request("/responses", payload={"input": PRIVATE_QUERY}))
    assert error.value.status_code == 429 and error.value.request_id == expected
    assert PRIVATE_ERROR not in str(error.value)
