# Implemented API surface

Generated from the actual FastAPI router. Machine-readable contract: [openapi.json](openapi.json). Request models in the contract and TypeScript response types in `apps/web/src` are validated by integration tests.

All course data requires active membership. Lecturer commands additionally check course lecturer membership. Private questions are excluded from student lists, events and retrieval; named authors retain authorized write access to their own private submission. Anonymous authors are never persisted.

| Method | Route |
| --- | --- |
| GET | `/api/health` |
| GET | `/api/ready` |
| POST | `/api/v1/auth/register` |
| POST | `/api/v1/auth/login` |
| GET | `/api/v1/auth/me` |
| POST | `/api/v1/auth/logout` |
| GET | `/api/v1/courses` |
| POST | `/api/v1/courses` |
| GET | `/api/v1/courses/discover` |
| GET | `/api/v1/courses/{cid}` |
| PATCH | `/api/v1/courses/{cid}` |
| DELETE | `/api/v1/courses/{cid}` |
| POST | `/api/v1/courses/{cid}/join-requests` |
| GET | `/api/v1/courses/{cid}/join-requests` |
| POST | `/api/v1/courses/{cid}/join-requests/{student_id}/{decision}` |
| POST | `/api/v1/courses/{cid}/members` |
| GET | `/api/v1/courses/{cid}/members` |
| DELETE | `/api/v1/courses/{cid}/members/{target}` |
| POST | `/api/v1/courses/{cid}/invitations` |
| GET | `/api/v1/courses/{cid}/invitations` |
| POST | `/api/v1/invitations/accept` |
| GET | `/api/v1/courses/{cid}/settings` |
| PATCH | `/api/v1/courses/{cid}/settings` |
| GET | `/api/v1/courses/{cid}/folders` |
| POST | `/api/v1/courses/{cid}/folders` |
| PATCH | `/api/v1/folders/{fid}` |
| DELETE | `/api/v1/folders/{fid}` |
| POST | `/api/v1/courses/{cid}/resources` |
| GET | `/api/v1/courses/{cid}/resources` |
| GET | `/api/v1/resources/{rid}/status` |
| GET | `/api/v1/resources/{rid}` |
| PATCH | `/api/v1/resources/{rid}` |
| DELETE | `/api/v1/resources/{rid}` |
| GET | `/api/v1/resources/{rid}/download` |
| GET | `/api/v1/resources/{rid}/preview` |
| GET | `/api/v1/resources/{rid}/pages/{index}` |
| POST | `/api/v1/resources/{rid}/reprocess` |
| POST | `/api/v1/courses/{cid}/lectures` |
| GET | `/api/v1/courses/{cid}/lectures` |
| GET | `/api/v1/lectures/{lid}` |
| GET | `/api/v1/lectures/{lid}/slides` |
| GET | `/api/v1/lectures/{lid}/outline` |
| POST | `/api/v1/lectures/{lid}/outline` |
| POST | `/api/v1/lectures/{lid}/prepare` |
| POST | `/api/v1/resources/{rid}/reindex` |
| GET | `/api/v1/resources/{rid}/transcript` |
| POST | `/api/v1/lectures/{lid}/sessions/start` |
| POST | `/api/v1/sessions/{sid}/end` |
| GET | `/api/v1/sessions/{sid}/snapshot` |
| GET | `/api/v1/sessions/{sid}/join-info` |
| POST | `/api/v1/sessions/join` |
| POST | `/api/v1/sessions/{sid}/slides/change` |
| POST | `/api/v1/sessions/{sid}/annotations` |
| POST | `/api/v1/sessions/{sid}/polls` |
| GET | `/api/v1/sessions/{sid}/polls` |
| POST | `/api/v1/polls/{pid}/vote` |
| POST | `/api/v1/polls/{pid}/close` |
| GET | `/api/v1/polls/{pid}/results` |
| POST | `/api/v1/sessions/{sid}/context/{action}` |
| GET | `/api/v1/sessions/{sid}/timeline` |
| POST | `/api/v1/courses/{cid}/questions/preflight` |
| POST | `/api/v1/courses/{cid}/questions` |
| GET | `/api/v1/courses/{cid}/questions` |
| GET | `/api/v1/questions/{qid}` |
| PATCH | `/api/v1/questions/{qid}` |
| DELETE | `/api/v1/questions/{qid}` |
| POST | `/api/v1/questions/{qid}/vote` |
| DELETE | `/api/v1/questions/{qid}/vote` |
| POST | `/api/v1/questions/{qid}/resolve` |
| POST | `/api/v1/questions/{qid}/dismiss` |
| POST | `/api/v1/questions/{qid}/comments` |
| POST | `/api/v1/questions/{qid}/answer` |
| GET | `/api/v1/questions/{qid}/answers` |
| GET | `/api/v1/questions/{qid}/match-status` |
| GET | `/api/v1/courses/{cid}/search` |
| PATCH | `/api/v1/answers/{aid}` |
| DELETE | `/api/v1/answers/{aid}` |
| GET | `/api/v1/sessions/{sid}/audio/config` |
| POST | `/api/v1/sessions/{sid}/audio/chunks` |
| POST | `/api/v1/sessions/{sid}/audio/finalize` |
| GET | `/api/v1/sessions/{sid}/processing-status` |
| GET | `/api/v1/sessions/{sid}/recording` |
| GET | `/api/v1/sessions/{sid}/transcript` |
| GET | `/api/v1/sessions/{sid}/lecturer-queue` |
| GET | `/api/v1/sessions/{sid}/topics` |
| POST | `/api/v1/polls/{pid}/feedback` |
| POST | `/api/v1/sessions/{sid}/clusters` |
| POST | `/api/v1/clusters/{cluster_id}/resolve` |
| POST | `/api/v1/clusters/{cluster_id}/split` |
| POST | `/api/v1/clusters/{cluster_id}/merge` |
| DELETE | `/api/v1/answer-sources/{qid}` |
| PATCH | `/api/v1/answer-sources/{qid}` |
| POST | `/api/v1/feedback/{fid}/route` |
| WebSocket | `/ws/sessions/{sid}` |
| WebSocket | `/ws/sessions/{sid}/audio` |

## Grouped search contract (0010)

Search and preflight retain `matches`, now a `SourceGroup[]` (stable parent `source_id`, `source_type` document/recording/discussion, title, URL, locations, optional question/audio metadata and best-hit score). Locations carry nullable physical page or input-window times and a direct URL. No chunk text/excerpts are returned. Preflight token/status/error/method/generated_answer fields are retained. See generated `openapi.json` for `SourceGroup`, `SourceLocation`, `SearchResponse` and `PreflightResponse`. Resource status additionally exposes extraction status/progress/errors separately from render/index status.

## Picture uploads and keyword search (0011)

Authenticated GET/POST/DELETE `/api/v1/auth/me/avatar` manages only the signed-in user's image. GET/POST/DELETE `/api/v1/courses/{cid}/banner` and `/api/v1/lectures/{lid}/banner` require membership for reads and lecturer membership for writes. POST is multipart `file`; GET returns normalized private WebP; DELETE removes the stored reference/derivative. User/course/lecture DTOs return versioned image URLs without storage paths.

Course search accepts 1–200 characters of search words and uses local all-keyword/proximity matching; preflight still accepts questions and uses hybrid retrieval. Annotation input optionally carries `coordinates: stage|slide` (legacy stage default); new clients send slide-relative points, and snapshot/timeline preserve the marker.

## Named submissions and live limits (0012)

- Preflight accepts `{text, session_id?, submission_id?: UUID, purpose?: "question"|"feedback"}`; purpose defaults to question. Creation accepts those same fields plus `preflight_token`; only question purpose can create a public post. Extra anonymity/visibility fields are rejected (422). Replies accept `{body}` and inherit parent visibility.
- Proofs bind the authenticated actor, exact payload/purpose and submission identity, expiring after ten minutes. Question creation deduplicates by course/author/submission UUID (or the proof’s generated UUID if omitted). A retry returns the existing question with the existing 201 response status, including after the session ends; reuse with changed original text/session returns 409.
- Question/reply responses separate `can_edit` (author only) and `can_delete` (author or lecturer). PATCH by another author returns 403 even for lecturers; DELETE remains lecturer moderation. Legacy anonymous/private read and moderation rules remain enforced.
- Superseded in 0013: `/polls/{pid}/feedback` accepts `{text}` directly and records the authenticated sender without source search or a proof. Lecturer queue feedback includes `author`; classification/manual routing create private questions preserving that author. Historical missing authors remain anonymous.
- Start locks the course and enforces one live session per course. A conflict returns 409 with `{code,message,request_id,active_session:{id,title,url}}`. Same already-live lecture returns its session; an ended lecture cannot restart. Other courses can run concurrently.
- Session events include `question.deleted`, `reply.created`, `reply.updated`, `reply.deleted`; private audiences remain filtered. Clients invalidate lists/threads and refresh visible course discussion/reply queries every two seconds, plus focus/reconnect refresh.

## Discussion continuity and original notes (0013)

- POST `/polls/{pid}/feedback` accepts only `{text}` (3–8000 characters); no retrieval/proof. It checks membership, open poll and live session, returns 202, and records exact original text and authenticated sender before background classification. Unwanted extra fields return 422. Existing question preflight/purpose compatibility remains available but is not used or required for notes.
- POST `/questions/{qid}/dismiss` remains lecturer-only and now returns `{state,discussion_only:true}`. Resolution is unchanged. Session snapshots/lecturer queues exclude it; normal course lists and search keep it. The action detaches its live cluster and publishes a normal authorized question update. DELETE still removes content.
- Question DTOs add `discussion_only` and nullable `recording_answer:{title,url,state}`. This link is derived from human answered state and lecture recording availability, independently of excerpt matching; it opens `/recordings/{sid}` without a time query. States live/processing/ready distinguish availability. Disabled/no-audio/failed recordings return null. A precise excerpt remains in `match` and takes UI precedence.
- Feedback queue records retain their exact `text_original`; optional `text_rewritten` and `ai_modified` describe only meaningful derived question wording. Plain feedback and cosmetic-only changes have NULL/false. Lecturer-only `feedback.updated` events notify classification completion.
