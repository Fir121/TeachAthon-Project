"""Single-pass semantic extraction with exact source accounting; no language-cue regex."""

from dataclasses import dataclass

VERSION = "whole-note-segments-v2"


def question_rewrite(original, candidate, classification, *, change_kind="clarified", meaning_preserved=True):
    if classification != "question" or not candidate or change_kind != "clarified" or not meaning_preserved:
        return None
    candidate = candidate.strip()
    if not candidate or len(candidate) > 8000:
        return None
    # A tiny formatting check only. Preserve technical case, operators and punctuation.
    if " ".join(original.split()) == " ".join(candidate.split()):
        return None
    if candidate == original.strip() + "." or original.strip() == candidate + ".":
        return None
    return candidate


@dataclass
class Extraction:
    text: str
    requests: list
    spans: list
    complete: bool
    issues: list


def extract_note(original, result):
    """Check provenance/whole-note accounting; one model call interprets meaning."""
    cursor, parts, spans, issues = 0, [], [], []
    valid = result.coverage_complete and bool(result.segments)
    if not valid:
        issues.append("model_did_not_attest_complete_coverage")
    previous_request_unchanged = False

    def account_gap(start, end):
        gap = original[start:end]
        if any(not character.isspace() and character not in ".!?。！？" for character in gap):
            return False
        if gap:
            spans.append({"start": start, "end": end, "kind": "separator"})
            # Restore actual source punctuation rather than removing or inventing it.
            if previous_request_unchanged and parts and gap.strip():
                parts[-1]["text"] += gap.strip()
                parts[-1]["source_end"] = end - (len(gap) - len(gap.rstrip()))
        return True

    for index, segment in enumerate(result.segments):
        quote = segment.source_quote
        start = original.find(quote, cursor) if quote.strip() else -1
        if start < 0 or not account_gap(cursor, start):
            valid = False
            issues.append("unaccounted_source_text_or_invalid_quote")
            break
        end = start + len(quote)
        spans.append({"start": start, "end": end, "kind": segment.kind})
        cursor = end
        if segment.kind == "uncertain":
            valid = False
            issues.append("uncertain_intent")
        previous_request_unchanged = False
        if segment.kind == "request":
            if not segment.question or not segment.meaning_preserved:
                valid = False
                issues.append("request_intent_not_preserved")
            rewrite = question_rewrite(
                quote,
                segment.question,
                "question",
                change_kind=segment.change_kind,
                meaning_preserved=segment.meaning_preserved,
            )
            text = rewrite or quote
            previous_request_unchanged = rewrite is None
            parts.append({"id": str(index), "text": text, "source_start": start, "source_end": end})
        elif segment.question is not None or segment.change_kind != "unchanged":
            valid = False
            issues.append("feedback_was_rewritten")
    if not account_gap(cursor, len(original)):
        valid = False
        issues.append("unaccounted_trailing_source_text")
    if (result.classification == "question") != bool(parts):
        valid = False
        issues.append("inconsistent_classification")
    combined = "\n\n".join(part["text"] for part in parts)
    if len(combined) > 8000:
        valid = False
        issues.append("output_exceeds_budget")
    if not valid:
        return Extraction(original, [], spans, False, list(dict.fromkeys(issues)))
    return Extraction(combined or original, parts, spans, True, [])


def question_requirements(question):
    if question.request_parts and question.edited_at is None:
        return [{"id": f"{question.id}:{part['id']}", "text": part["text"]} for part in question.request_parts]
    # Legacy derived questions have no checked decomposition: retain their whole note.
    text = question.body_original if question.ai_modified and question.edited_at is None else question.body_display
    return [{"id": f"{question.id}:whole", "text": text}]
