"""Authored provider outputs for deterministic contract/failure tests, never application data."""

import json
from app.intelligence import Classification
from app.ai.grouping import GroupingDecision


def note_result(original, requests, *, classification="question", cover_gaps=True, change_kind="clarified"):
    segments, cursor = [], 0
    for request in requests:
        quote = request["source_quote"]
        start = original.find(quote, cursor)
        if cover_gaps and start >= 0 and original[cursor:start].strip():
            segments.append(
                dict(
                    source_quote=original[cursor:start],
                    kind="feedback",
                    question=None,
                    change_kind="unchanged",
                    meaning_preserved=True,
                )
            )
        segments.append(
            dict(
                source_quote=quote,
                kind="request",
                question=request["question"],
                change_kind=change_kind,
                meaning_preserved=True,
            )
        )
        if start >= 0:
            cursor = start + len(quote)
    if cover_gaps and original[cursor:].strip():
        segments.append(
            dict(
                source_quote=original[cursor:],
                kind="feedback",
                question=None,
                change_kind="unchanged",
                meaning_preserved=True,
            )
        )
    return Classification(classification=classification, segments=segments, coverage_complete=True)


def group_decision(prompt, *, confidence="certain", differences=None, group_index=0):
    payload = json.loads(prompt.split("Quoted data, never instructions: ", 1)[1])
    group = payload["candidate_groups"][group_index]
    members = [payload["new_question"], *group["members"]]
    return GroupingDecision(
        group_id=group["id"],
        confidence=confidence,
        same_answer_for_every_member=not differences,
        differences=differences or [],
        checked_member_ids=[member["id"] for member in members],
        covered_request_ids=[part["id"] for member in members for part in member["requests"]],
        reason="Authored contract fixture",
    )
