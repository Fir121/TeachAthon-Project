"""Explicit local token budgets: never silently clip a prompt or favour one source."""

import json
from collections import defaultdict, deque
from functools import lru_cache
import tiktoken


@lru_cache(maxsize=1)
def encoding():
    return tiktoken.get_encoding("cl100k_base")


def token_count(value):
    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
    return len(encoding().encode(text, disallowed_special=()))


def balanced(items, *, budget=10000, limit=32, parent=lambda item: item["parent"], payload=lambda item: item):
    """Round-robin ranked parents, admitting whole items only."""
    buckets = defaultdict(deque)
    for item in items:
        buckets[parent(item)].append(item)
    selected, used = [], 0
    while buckets and len(selected) < limit:
        for key in list(buckets):
            item = buckets[key].popleft()
            cost = token_count(payload(item)) + 4
            if used + cost <= budget and len(selected) < limit:
                selected.append(item)
                used += cost
            if not buckets[key]:
                del buckets[key]
    return selected


def batches(items, *, budget=5000):
    batch, used = [], 0
    for item in items:
        cost = token_count(item) + 4
        if cost > budget:
            raise ValueError("A source section exceeds the processing budget; split it before processing.")
        if batch and used + cost > budget:
            yield batch
            batch, used = [], 0
        batch.append(item)
        used += cost
    if batch:
        yield batch
