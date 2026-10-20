"""Precise course keyword search. Local Snowball stemming; no provider calls."""

import re
import threading
import unicodedata
from collections import Counter
from functools import lru_cache
import snowballstemmer

_local = threading.local()
_STOP = set(
    "a an the and or of to in on at by for from with is are was were be been being this that these those how why what when where which does do did can could would should please".split()
)


def tokens(text):
    text = unicodedata.normalize("NFKC", text).casefold()
    return [word for word in re.findall(r"[^\W_]+(?:\+\+|#)?", text, re.UNICODE) if word not in _STOP]


@lru_cache(maxsize=32768)
def stem_word(word):
    if not hasattr(_local, "stemmer"):
        _local.stemmer = snowballstemmer.stemmer("english")
    return _local.stemmer.stemWord(word) if word.isalpha() else word


def stems(text):
    return [stem_word(word) for word in tokens(text)]


def keyword_match(query, text, title):
    """Return (rank, reliable passage locator) or None. All words must match locally."""
    query_words = stems(query)
    wanted = set(query_words)
    if not wanted:
        return None
    body, heading = stems(text), stems(title)
    in_body, in_title = wanted <= set(body), wanted <= set(heading)
    if not in_body and not in_title:
        return None
    proximity = 0.0
    if in_body:
        counts, left, span = Counter(), 0, len(body) + 1
        for right, word in enumerate(body):
            if word in wanted:
                counts[word] += 1
            while len(counts) == len(wanted):
                span = min(span, right - left + 1)
                if body[left] in counts:
                    counts[body[left]] -= 1
                    if counts[body[left]] == 0:
                        del counts[body[left]]
                left += 1
        # Prevent isolated words spread over several unrelated paragraphs from qualifying.
        in_body = len(wanted) == 1 or span <= 80
        proximity = min(1, len(wanted) / max(1, span))
    if not in_body and not in_title:
        return None
    phrase = (
        any(body[i : i + len(query_words)] == query_words for i in range(len(body) - len(query_words) + 1))
        if in_body
        else False
    )
    # Scores are ordering heuristics, never displayed as confidence/probability.
    score = (0.72 + 0.18 * proximity + 0.08 * phrase + 0.02 * in_title) if in_body else 0.85
    if in_title and " ".join(query_words) == " ".join(heading):
        score = max(score, 0.99)
    return min(1, score), in_body
