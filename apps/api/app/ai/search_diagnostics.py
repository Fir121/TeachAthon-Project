"""Source-free semantic-search diagnostics in the existing rotated server logs."""

import json
import logging
import re
import time
from pathlib import Path
import httpx
from pydantic import ValidationError
from sqlalchemy.exc import SQLAlchemyError
from ..config import settings
from .evidence import AssessmentCoverageError
from .providers.openai import OpenAIRequestError

log = logging.getLogger(__name__)


def log_search_failure(exc, *, search_id, course_id, mode, stage, started, stage_started, deadline, candidates):
    stamp = time.monotonic()
    record = {
        "search_id": search_id,
        "course_id": course_id,
        "mode": mode,
        "stage": stage,
        "error_type": type(exc).__name__,
        "elapsed_ms": round((stamp - started) * 1000),
        "stage_elapsed_ms": round((stamp - stage_started) * 1000),
        "remaining_ms": max(0, round((deadline - stamp) * 1000)),
        "candidate_count": candidates,
        "text_model": settings().openai_text_model,
        "embedding_model": settings().openai_embed_model,
    }
    if isinstance(exc, AssessmentCoverageError):
        record.update(reason="source_id_coverage", coverage=exc.counts)
    elif isinstance(exc, OpenAIRequestError):
        record.update(reason="provider_http_error", http_status=exc.status_code, provider_request_id=exc.request_id)
    elif isinstance(exc, ValidationError):
        record.update(reason="schema_validation_error", validation_error_count=exc.error_count())
        fields = {"decisions", "id", "relevance", "passage_supported", "reason"}
        record["validation_errors"] = [
            {
                "type": error["type"] if re.fullmatch(r"[a-z_]{1,64}", error["type"]) else "validation_error",
                "location": [part if isinstance(part, int) or part in fields else "*" for part in error["loc"]],
            }
            for error in exc.errors()[:8]
        ]
    elif isinstance(exc, json.JSONDecodeError):
        record.update(reason="invalid_provider_json", json_line=exc.lineno, json_column=exc.colno)
    elif isinstance(exc, (TimeoutError, httpx.TimeoutException)):
        record["reason"] = "timeout"
    elif isinstance(exc, httpx.RequestError):
        record["reason"] = "provider_connection_error"
    elif isinstance(exc, SQLAlchemyError):
        record["reason"] = "database_error"
    elif isinstance(exc, RuntimeError) and stage == "embedding_configuration":
        record["reason"] = "embedding_configuration_error"
    else:
        record["reason"] = "unexpected_error"
    # Frame locations identify unexpected failures without exception messages,
    # traceback source lines, SQL parameters, provider bodies or Pydantic inputs.
    frames = []
    tb = exc.__traceback__
    while tb:
        code = tb.tb_frame.f_code
        frames.append({"file": Path(code.co_filename).name, "function": code.co_name, "line": tb.tb_lineno})
        tb = tb.tb_next
    record["stack"] = frames[-8:]
    log.warning("semantic_search_failed %s", json.dumps(record, separators=(",", ":")))
