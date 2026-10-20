# API contract — functional surface and realtime messages

Prefix `/api/v1`. JSON request/response; consistent errors `{code,message,details?,request_id}`; pagination for lists; authenticated course access; API routes need tests. Use FastAPI OpenAPI to keep frontend types aligned. This is a *route contract outline*, not a frozen field-level OpenAPI schema: Codex must define Pydantic models and keep generated docs current.

## Auth and courses
- `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`
- `GET/POST /courses`; `GET/PATCH/DELETE /courses/{id}`; `GET /courses/discover?q=...`
- `POST /courses/{id}/join-requests`, `GET /courses/{id}/join-requests`, `POST /courses/{id}/join-requests/{req_id}/approve|reject`
- `GET/POST /courses/{id}/invitations`, `POST /invitations/accept`, `POST /courses/{id}/members`, `GET /courses/{id}/members`, `DELETE /courses/{id}/members/{user_id}`
- `GET/PATCH /courses/{id}/settings` lecturer-only; immutable snapshot of relevant poll config when session starts.

## Files and teaching materials
- `GET/POST /courses/{id}/folders`, `PATCH/DELETE /folders/{folder_id}` (parent cycles prohibited)
- `GET /courses/{id}/resources`, `POST /courses/{id}/resources` multipart, `GET/PATCH/DELETE /resources/{id}`, `POST /resources/{id}/reprocess`
- `GET /resources/{id}/download` authenticated, `GET /resources/{id}/status` processing+errors
- `GET /courses/{id}/search?q=...` across allowed documents, recordings, public forum and course voice answers; grouped source links with physical page/playback offsets, no private leakage.

## Lectures and sessions
- `GET/POST /courses/{id}/lectures`, `GET/PATCH /lectures/{id}`
- `POST /lectures/{id}/prepare` ensures deck conversion/extraction; `GET /lectures/{id}/slides`, `GET /lectures/{id}/outline`
- `POST /lectures/{id}/sessions/start`, `POST /sessions/{sid}/end`, `GET /sessions/{sid}/snapshot`, `GET /sessions/{sid}/join-info` (QR short code), `POST /sessions/join` validates membership
- `POST /sessions/{sid}/slides/change` lecturer, `POST /sessions/{sid}/annotations` lecturer, `GET /sessions/{sid}/topics` lecturer, `POST /sessions/{sid}/context/pause|resume`
- `GET /sessions/{sid}/transcript` after recording with course access, `GET /sessions/{sid}/recording` range-supported, `GET /sessions/{sid}/timeline` slides+annotations+transcripts, `GET /sessions/{sid}/processing-status`
- `POST /sessions/{sid}/audio/chunks` authenticated lecturer, chunk index+start/end offsets, check integrity, `POST /sessions/{sid}/audio/finalize`; can use separate authenticated WS audio ingest for PCM stream. No public audio endpoints.

## Polls and questions
- `POST /sessions/{sid}/polls` lecturer, `GET /sessions/{sid}/polls`, `POST /polls/{pid}/vote` student, `POST /polls/{pid}/close` lecturer, `GET /polls/{pid}/results` lecturer aggregates only
- `POST /polls/{pid}/feedback` classified in background if needed; secure original/rewrite semantics
- `POST /courses/{id}/questions/preflight` with text+visibility+anonymous+context optional; returns resource matches and **public-only existing-question suggestions**, transient preflight token if useful; asynchronous AI with bound timeout/failure state
- `POST /courses/{id}/questions` with preflight token or signed explicit failed-attempt marker; `GET /courses/{id}/questions?scope=live|forum&sort=...`; `GET/PATCH/DELETE /questions/{qid}` permissions
- `POST/DELETE /questions/{qid}/vote` public only; `POST /questions/{qid}/answer`, `POST /questions/{qid}/resolve`, `POST /questions/{qid}/dismiss`; `POST /questions/{qid}/comments`; `GET /questions/{qid}/answers` permissions.
- `GET /sessions/{sid}/lecturer-queue` lecturer-only grouped view; `POST /clusters/{cid}/merge|split|resolve` lecturer-only; `GET /questions/{qid}/match-status`, `PATCH/DELETE /answer-sources/{id}` lecturer.
- `GET /notifications`, `POST /notifications/{nid}/read` optional modest in-app.

## Realtime
WebSocket `GET /ws/sessions/{sid}` authenticated course member. Snapshot fetched before/after connecting. JSON events:
```
{
 "v":1,"event_id":"uuid","session_id":"uuid","seq":81,
 "type":"poll.opened","at":"ISO-8601","payload":{...}
}
```
Events include `session.started|ended`, `slide.changed`, `annotation.added`, `poll.opened|updated|closed`, `poll.results.updated` (lecturer only), `question.created|updated|answered` (visibility-filtered), `question.cluster.updated` (lecturer only), `transcript.delta|final` (course authorized; captions enabled), `context.topic.updated` (lecturer), `resource.status`, `recording.status`, `participant.count.updated`, `notification.created`. **No private content in a public broadcast; use per-client authorization before broadcasting**.

Audio ingest path: `GET /ws/sessions/{sid}/audio` lecturer-only, receives PCM frames and emits STT via provider behind backend; handle mic pause and close cleanly. If provider WebRTC+ephemeral credentials is selected for implementation, keep private keys server-side and forward transcription results into the same backend store/event hub. Binary audio channels not conflated with general classroom JSON event channel.

## Semantics
- Requests idempotent where feasible: `start` cannot create two live sessions for same lecture; `end` returns ended state if already ended; votes upsert per student; recording audio chunk index deduped; WS reconnect uses DB snapshot rather than replay assumption.
- `preflight` may be slow: return structured error with timeout; client allows post after failed attempted retrieval. Never require AI success to participate.
- Approval is via lecturer course membership and questions' actual visibility, not just user account role.
- Course search and preflight return typed `matches` source groups with stable parent ID, kind, title, primary URL and deduplicated page/time `locations`. No internal chunk text/excerpts are exposed. The eight-result limit applies after grouping; preflight proof fields remain unchanged. See AI_WORKFLOW.md and the generated OpenAPI contract.

Current course search is the all-keyword endpoint (`q`, 1–200 characters), with local English stemming and proximity qualification. Question and poll-note preflight keep hybrid natural-question retrieval. GET/POST/DELETE picture endpoints are `/auth/me/avatar`, `/courses/{cid}/banner` and `/lectures/{lid}/banner`, under `/api/v1`; own-account or course/lecturer permissions apply. See the implemented contract for normalized image limits and URLs.
