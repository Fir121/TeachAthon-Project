"""Conservative display policy: original feedback is never rewritten."""

import re
import unicodedata


def question_rewrite(original: str, candidate: str | None, classification: str) -> str | None:
    """Only retain a question rewrite that changes words, not just presentation."""
    if classification != "question" or not candidate or not candidate.strip():
        return None
    candidate = candidate.strip()[:8000]

    def words(value):
        return re.findall(r"\w+", unicodedata.normalize("NFKC", value).casefold())

    return candidate if words(original) != words(candidate) else None


_REQUEST_CUE = re.compile(
    r"\b(?:what|why|how|when|where|which|who)\b|"
    r"\b(?:tell\s+me|explain|clarify|help\s+me|can\s+you|could\s+you|would\s+you|"
    r"i\s+(?:don't|do\s+not)\s+understand)\b|[?？]",
    re.IGNORECASE,
)


def complete_question_text(original: str, requests) -> str:
    """Preserve all requests in one queue entry; uncertain extraction falls back to the full note.

    Exact source quotes are transient validation data, not a second copy of the stored note.
    The guard is deliberately conservative; it is not a semantic completeness proof.
    """
    if not requests:
        return original
    cursor = 0
    rendered = []
    gaps = []
    for request in requests:
        source = request.source_quote
        start = original.find(source, cursor) if source.strip() else -1
        if start < 0 or not request.question.strip():
            return original
        gaps.append(original[cursor:start])
        cursor = start + len(source)
        # A cosmetic-only rewrite retains the exact quoted request, including its punctuation.
        rendered.append(question_rewrite(source, request.question, "question") or source)
    gaps.append(original[cursor:])
    # An explicit question/request outside all returned quotes must never disappear.
    if any(_REQUEST_CUE.search(gap) for gap in gaps):
        return original
    result = "\n\n".join(rendered)
    return result if len(result) <= 8000 else original
