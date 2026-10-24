# Data model: initial relational contract

Use PostgreSQL UUID primary keys, timestamptz timestamps, proper FKs / CASCADE or explicit retention policy, check constraints, unique indexes and `course_id` on tenant-scoped rows. Below are logical entities, not mandates for one table per bullet; Codex may coalesce obvious pure-implementation tables while preserving semantics. Use SQLAlchemy 2 & Alembic.

## Identity and enrolment
- `users(id, name, email unique, password_hash, role student|lecturer, created_at, disabled_at)`
- `courses(id, name, description, join_code, discoverable, settings_json, created_at)`
- `course_lecturers(course_id, user_id, created_at)` PK course,user; multiple equal lecturers
- `course_students(course_id, user_id, status pending|active|removed, joined_at)` unique course,user
- `course_invitations(id, course_id, email nullable, token_hash, invited_role, expires_at, created_by, used_at)`
- `course_join_requests(id, course_id, student_id, status, requested_at, reviewed_at)`

## Resources and ingestion
- `resource_folders(id, course_id, parent_id nullable, name, created_at)` cycle-safe; unique folder sibling names
- `resources(id, course_id, folder_id nullable, uploaded_by, original_filename, content_type, storage_key, size_bytes, sha256, kind pdf|pptx|docx|audio|video|txt|json|other, process_status queued|processing|ready|failed, indexing_enabled bool, error_code nullable, created_at)`
- `processing_jobs(id, type, course_id, target_id, status, attempts, next_run_at, lease_until, error_message, created_at, updated_at)`
- `source_chunks(id, course_id, resource_id nullable, lecture_session_id nullable, forum_answer_id nullable, source_type, text, embedding vector(N) nullable, offset_start_ms nullable, offset_end_ms nullable, page_number nullable, metadata_json, created_at)` with keyword search tsvector and pgvector index. **Embedding dimensions determined by configured embedding model; migration/adapter must detect incompatibility rather than silently corrupt.**

## Live teaching
- `lectures(id, course_id, title, description, slide_resource_id, outline_json nullable, created_by, created_at)`
- `lecture_sessions(id, lecture_id unique, course_id, state created|live|ended, started_at, ended_at, active_slide_index, event_sequence, recording_enabled bool, transcript_state, recording_state)`
- `slides(id, lecture_id, slide_index, rendered_image_key, extracted_text, metadata_json)` unique lecture,index
- `slide_events(id, lecture_session_id, slide_index, offset_ms, sequence)` for deterministic replay; `annotation_events(id, session_id, slide_index, offset_ms, stroke_json)`
- `audio_segments(id, session_id, segment_index, start_offset_ms, end_offset_ms, storage_key, codec, size_bytes, uploaded_at)` unique session,index
- `recordings(id, session_id, storage_key, duration_ms, mime_type, state, created_at)`
- `transcript_segments(id, session_id nullable, resource_id nullable, start_ms, end_ms, text, speech_item_id, revision, created_at)` unique stream item as feasible; source chunks link to segments/time.
- `teaching_topics(id, session_id, name, subtopic nullable, started_offset_ms, ended_offset_ms nullable, source_json, status)`; detected topics are optional/advisory and need not have perfect precision.
- `session_events(id, session_id, sequence unique with session, event_type, payload_json, created_at)` bounded retention as needed.

## Polls
- `polls(id, session_id, topic_id nullable, prompt, option_labels_json, status open|closed|superseded, created_by auto|lecturer, opened_at, closed_at)` enforce **one open poll per session via partial unique index**.
- `poll_votes(id, poll_id, student_user_id, option_index, updated_at)` unique poll,student; overwrite during open; aggregate to lecturer only. If strict anonymity to lecturers is required, never return user IDs, only counts.
- `poll_feedback(id, poll_id, text_original, text_rewritten nullable, classification question|feedback|unclassified, ai_modified bool, linked_question_id nullable, created_at)` no student identifiers when submitted anonymously.

## Questions/forum
- Use one `questions` record spanning live Q&A and forum questions: `id, course_id, session_id nullable, title nullable, body_original, body_display, ai_modified, author_id nullable, anonymous bool, visibility public|private, state open|answered|dismissed, created_at, edited_at nullable, deleted_at nullable`. **Constraint anonymous=true -> author_id IS NULL**. No separate question-author linkage, audit user identity or re-identification table for anonymous submissions. Server sees requesting user transiently to authorise course access but does not save it as author.
- `question_votes(question_id, user_id, created_at)` unique; only public questions, toggled vote.
- `question_clusters(id, course_id, session_id nullable, canonical_text, created_at)` + `question_cluster_members(cluster_id, question_id, created_at)`; lecturer-only cluster may include private/public. Student-facing public suggestions MUST filter original questions to public and may not expose count including private.
- `answers(id, question_id, author_id nullable, body, visibility private|public, lecturer_authored bool, created_at, deleted_at nullable)` and optional `answer_sources(id, answer_id nullable, question_id, source_chunk_id nullable, recording_id nullable, start_ms nullable, end_ms nullable, match_state pending|ready|unavailable|removed, created_at)` to capture later audio snippets. Private written answers never returned to other student contexts.
- `forum_comments(id, question_id, parent_id nullable, author_id nullable, anonymous bool, body, visibility, created_at, deleted_at nullable)` enforce private parent propagation and access controls.
- Preflight proof: prefer a short-lived **signed, stateless opaque token** over a database table. Do not write a link between anonymous question payload and an authenticated student (including via stored preflight hashes or audit joins). If a temporary preflight record is necessary, store it without `user_id` or raw text, with aggressive expiry.
- `notifications(id, user_id, kind, payload_json, seen_at nullable, created_at)` optional minimal in-app notifications, not push/email.

## Indexes and privacy
- Course membership unique; media/storage access gated by course+visibility; `source_chunks(course_id, source_type)`, `questions(course_id, visibility, state, created_at)`, `transcript_segments(session_id,start_ms)`, `poll_votes(poll_id, student_user_id)`.
- Deleting a question should remove/soft-delete public text from search and UI quickly; historical lecturer-allowed audio passage can remain available without referencing a private question.
- Anonymous question author ID NULL even if logged-in; for named questions stored author ID. No durable requester correlation in application logs or API response for anonymous questions.
- Do not index private textual answers into public RAG; source chunks must carry and enforce visibility.

## Implemented extraction metadata (migration 0010)

`resources.extraction_json` stores extraction status, target/completed version, completed/total page counts and chunking version separately from rendering readiness. Private per-page OCR JSON checkpoints retain ordered blocks, labels, bounding boxes and model revision provenance; `resources.pages` refers to the current successful extraction. `source_chunks.chunk_metadata` stores splitter version, character offsets, source section and transcript/extraction provenance. Replacement page text and derived chunks commit atomically. Search result groups are transient API projections, not saved query history.

## Implemented pictures and ink coordinates (migration 0011)

Nullable `users.avatar_key`, `courses.banner_key` and `lectures.banner_key` reference private normalized image derivatives. API DTOs expose authenticated versioned URLs, never those storage keys. Photo uploads are not resources/source chunks and add no author link to anonymous questions. New `annotation.added` JSON includes `coordinates=slide`; older/missing markers are interpreted as `stage`. Both formats retain normalized points, slide index, timestamp and clear events in the same ordered event log.

## Named submissions and live limits (migration 0012)

`questions.submission_id` is a nullable UUID with uniqueness across course/author/submission for retry deduplication; legacy records remain NULL. New direct questions always store the authenticated author, `anonymous=false`, `visibility=public`. Replies inherit parent visibility and authenticated author. Existing anonymity/visibility columns and constraints protect legacy records and private feedback questions. `poll_feedback.author_id` is nullable with an on-delete SET NULL user FK; new notes store their sender, old notes remain NULL. Classification/manual routing copy the saved author without reconstructing missing identities. A partial unique index on `lecture_sessions.course_id WHERE state='live'` enforces one live lecture per course. Migration refuses existing duplicate-live courses before changing schema; no sessions are implicitly ended.

## Discussion continuity and feedback repair (migration 0013)

`questions.discussion_only` is a non-null boolean default false, independent of open/answered resolution. Moving out of a live queue preserves the session association and original visibility and clears live cluster membership. Migration converts historical dismissed rows into discussion-only records, restoring answered state only from stored lecturer answer events/replies, queues public records for reindexing, and preserves all original text/identities/replies/votes. Existing feedback-only or cosmetic-only rewrite fields are cleared, including an untouched linked private question derivative when applicable; human edits and original notes are preserved. `recording_answer` is a transient permission-scoped DTO projection, not an invented excerpt or a saved AI match.

## Individual questions after splitting (migration 0014)

`questions.auto_grouping_disabled` is an internal non-null boolean default false. A lecturer split clears `cluster_id` and sets this flag, preventing automatic grouping of that question as either source or candidate. Explicit manual regrouping clears the flag; manual clusters retain their separate manual protection. A group with fewer than two total members is dissolved, preserving manual suppression on any remaining member. Migration repairs existing singleton/empty clusters without changing question text, identity, visibility, human state or matches. The flag and mixed group metadata are not returned to students. Queue singleton `id=null` is a transient projection, including when filtering hides the other members of a genuine group.

## Semantic processing provenance (migration 0015)

`questions.request_parts` is an internal JSON list of validated feedback request IDs/text and source offsets, empty for legacy/direct questions. `poll_feedback.analysis_json` retains single-pass processing/model version, complete/original-retained status, coverage spans/kinds and machine-readable validation issues. `question_clusters.decision_json` stores accepted whole-group checks/model/version/short reason. Defaults preserve existing data without inventing author identities or rewriting historical migrations. Worker backfill versions notes/old auto groups and eligible unavailable recording associations; protected human wording/resolution/manual groups/removed or selected excerpts remain protected.

`match_json` holds per-request binary response-relevance assessments and one or multiple actual captured-window excerpts. A direct response to any request can be linked without completeness grading; older coverage metadata is retained only until automatic reassessment. Unversioned ready links with unknown provenance remain stored for explicit recheck. `Lecture.outline_json` stores input digest/version, per-batch maps/reduction checkpoints and page/section coverage, alongside final topics/stable references; partial coverage is explicit and resumable. No search-query history or provider chain-of-thought is stored.


## Interactive diagrams (migration 0016)

`diagram_analyses` has course/lecture FKs, pixel-based deck digest, per-page fingerprints, completed-page count, checkpointed suggestion JSON, input caveat, job FK and timestamp. Uniqueness on lecture/source digest coalesces repeated analysis; failed retries resume the same checkpoint.

`diagram_revisions` has course/lecture FKs, 0-based slide index (nonnegative check), request UUID (lecture/request unique), source pixel fingerprint, model, refinement, private structured artifact JSON, job FK, creation/approval/publication timestamps and nullable approving-user FK. Checked statuses are pending/preview/approved/rejected/superseded/stale. A partial unique index permits one approved revision per lecture/slide. Publication timestamp is set under the session-start lecture lock, not by a worker. Course deletion cascades the new records; user deletion clears approver identity without discarding artifacts. Endpoints and workers verify actual lecture/course/deck/index relationships. Public metadata contains no source code, proposal or job fields; interaction state lives only inside the mounted iframe.


Recording response matching update — 2026-10-24: the matcher now uses only `direct` / `not_relevant` relevance decisions. No full/partial grading or completeness-based lecturer-review state is produced. Any direct question-and-response passage yields ready links for authorized students once the lecturer has marked the question answered, even if other requests have no match. Links are labelled Lecturer’s response; correctness/exhaustiveness are not evaluated. Existing source/time validation, private boundaries, optional correction/removal and whole-recording fallback remain. Older automatic coverage-model associations are queued for binary reassessment; old partial DTOs appear pending during processing. Manual/removed associations are protected. Match metadata records `semantic-direct-response-v2` and per-request relevance instead of coverage.


Recording reference/timing correction — 2026-10-24: version `semantic-segment-response-v3` uses schema-enforced short request/window/segment aliases. The model selects actual start/end utterances inside its chosen context; the server validates membership/order and maps them to captured transcript timestamps. Excerpt text/URLs/transcript IDs cover the selected span, not the context lead-in. No correctness/completeness grading or extra model call. Unknown references and invalid ranges are rejected with safe failure metadata; existing ready/manual/removed links survive a failed recheck. The approved failed clock-synchronization match is retried in place; completed v2 decisions stay usable until explicitly rechecked.
