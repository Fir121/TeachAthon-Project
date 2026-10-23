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
| GET | `/api/v1/lectures/{lid}/diagrams/preparation` |
| POST | `/api/v1/lectures/{lid}/diagrams/analyse` |
| POST | `/api/v1/lectures/{lid}/diagrams/generate` |
| GET | `/api/v1/lectures/{lid}/diagrams/approved` |
| GET | `/api/v1/diagrams/{did}/preview` |
| POST | `/api/v1/diagrams/{did}/{action}` |
| GET | `/api/v1/diagrams/{did}/render` |
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

## Split groups into individual questions (0014)

- Creating a cluster requires at least two distinct question IDs (422 otherwise). Request/response shapes remain unchanged.
- POST `/clusters/{cluster_id}/split` clears selected members' cluster membership; a lone remainder is detached too. It returns `{split:true}`, emits lecturer-only `question.cluster.updated`, preserves all question content/resolution/privacy, and prevents automatic regrouping of detached questions. Explicit manual grouping/merging remains available. Empty/one-member clusters are removed.
- Lecturer queue `groups` retains its existing shape; an individual entry has `id:null`, its own display text as `canonical_text` and one question. The same projection applies when a queue filter leaves one visible member of a larger group, avoiding bulk actions on hidden members. Student question DTOs expose neither group metadata nor the internal suppression flag.

## Semantic assessment and provenance (0015)

- Course Search still accepts words; search/preflight now share hybrid candidate recall plus bounded semantic source assessment. Public result groups/links remain unchanged and contain no chunk excerpts. No-key/provider/index-incomplete paths return explicit warnings; preflight remains failed/degraded for explicit Post anyway, never automatic submission. Its method reflects actual stages.
- New lecturer-only POST `/feedback/{fid}/reprocess` queues one fresh classification attempt (202); active jobs deduplicate. Notes do not require preflight. Queue feedback adds `processing_status=complete|original_retained`; original-retained notes remain readable with retry/manual routing. Internal source spans/request parts stay lecturer-domain data.
- Automatic groups require complete member/request coverage and certainty. Legacy unverified auto groups return `review_pending=true` and resolve returns 409 until verified; individual actions and manual grouping remain usable. Every group member stays visible. Author edits detach stale group membership.
- Match DTOs can contain multiple `excerpts` with actual offsets/URLs and complete/partial coverage. Partial or unresolved associations remain lecturer-only; answered learners retain whole-recording fallback. Earlier unversioned ready suggestions are lecturer `legacy` review data until explicitly rechecked/corrected. New lecturer-selected ranges carry `lecturer_selected=true` and background jobs preserve them.
- New lecturer-only POST `/answer-sources/{qid}/reprocess` returns 202 and deduplicates active jobs; it requires an ended session with ready recording (409 otherwise). Explicit rechecking can replace an earlier selected/removed association; background work cannot restore removed links.
- Outline responses retain `topics` and add versioned processing/partial/ready status, completed/total section counts, page coverage and stable topic references. All source sections are processed in token-bounded checkpoint batches.


## Interactive diagrams (0016)

- Lecturer-only GET `/lectures/{lid}/diagrams/preparation`: lock flag, checkpointed analysis/input caveat/suggestions and revision metadata/status/job attempts/errors; never artifact source.
- Lecturer-only POST `/lectures/{lid}/diagrams/analyse` (202): explicit full-deck batched analysis; repeated same-pixel requests reuse work and failed requests resume it. Zero suggestions is a successful complete result.
- Lecturer-only POST `/lectures/{lid}/diagrams/generate` (202): `{request_id:UUID,slide_index:int,feedback?:string}`; any in-range slide, including unsuggested slides. Optional `feedback` (up to 1,500 characters) carries initial lecturer teaching notes or later refinement, stored privately and passed as `lecturer_guidance` with the slide. Empty is valid. UUID replays deduplicate; changed payload reuse is 409; identical active requests coalesce. Regenerate creates a private revision.
- Lecturer-only GET `/diagrams/{id}/preview`: completed preview metadata. POST `/diagrams/{id}/approve` and `/diagrams/{id}/reject` explicitly approve or reject/unpublish before start. Approval atomically supersedes the earlier approved revision.
- Member GET `/lectures/{lid}/diagrams/approved`: published source-matching metadata, restricted to active index during live teaching. Session snapshots include `diagrams` with the same restriction; ended snapshots return all published slides for replay.
- Member GET `/diagrams/{id}/render?viewer=UUID`: authenticated HTML with renderer CSP, no-store and opaque sandbox. Requires `Sec-Fetch-Dest: iframe` and `Sec-Fetch-Site: same-origin`; direct navigation is 403. Students receive 404 for unapproved/rejected/superseded, unpublished or inactive-live-slide artifacts; source mismatch is 409. Lecturers can render completed previews through the same route. Missing login 401; nonmember/cross-course/removed member 404; student preparation commands 403; invalid index/input 422. All mutation endpoints return 409 after a session has ever started. In-flight workers cannot publish late results.
