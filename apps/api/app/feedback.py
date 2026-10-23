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
