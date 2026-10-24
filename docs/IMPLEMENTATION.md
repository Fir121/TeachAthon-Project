# Codex implementation order and acceptance gates

**Single agent, one VM, no existing repo.** Build first from functioning infrastructure to a working classroom, then retrieval and archive. The product owner wants comprehensive MVP—not a dummy vertical-slice demo. Keep milestones small enough to validate; commit or checkpoint between them.

## M0 — Foundation (first working Compose up)
- Scaffold Vite React TS Tailwind, FastAPI SQLAlchemy Alembic, PostgreSQL pgvector, DB worker, Caddy, Compose, shared volumes, `.env.example`, README.
- Health endpoints and `docker compose up --build`, migrations, OpenAPI, frontend route and error framework. Password auth, role selection, secure sessions, course membership authorization.
- Gate: lecturer registers/signs in, student signs in, access-controlled course CRUD works, backend/frontend tests run, no secrets committed.

## M1 — Courses, file ingestion, lecture setup
- Multi-lecturer course membership and all 3 student enrolment methods; nested folder manager. Upload supported PDFs/PPTX/DOCX/TXT/JSON/MP3/MP4 with observable async jobs; static slide previews, pdf/ppt conversion, transcript indexing later as next milestone. Course isolated resources.
- Lecture creation requires prepared deck and can display slides. Processing states and retries.
- Gate: create course, invite/enrol, upload pptx/pdf, see rendered slides, fail an upload and retry, access denied outside course.

## M2 — Live presenter and realtime student experience
- Live session start/end, join QR/code, presenter slide navigation fullscreen, optional annotation events, instructor separate control room and student compact responsive companion. WebSocket events with snapshot/reconnect; shared DB state.
- Poll lifecycle with manual trigger, 4-option voting, latest vote upsert, close/supersede and history, aggregate instructor dashboard. New questions named and course-public (legacy private/anonymous protections retained), upvote, lecturer moderation; in-app update notification. At this stage connect preflight with explicit pending implementation status, but do not fake AI; before M4 it can be a genuine resource keyword matching baseline with clearly labelled retrieval.
- Gate: two browsers/mobile + lecturer see exact same slide, poll votes consistent after refresh, private content invisible, named edit/delete and anonymous nonedit enforced.

## M3 — Audio recording + live captions + replay
- Real mic permission + backend realtime STT via OpenAI adapter, partial/final caption messages to students, transcription state. Simultaneously durable recorded audio chunk uploads and post-lecture media assembly; timestamped slide/annotation events; recorded lecture replay with synced slides/audio and transcript. Documented mic/provider error states.
- Gate: speak into lecturer mic, enrolled student sees captions, transcript and audio remain after session, seek to a moment and see correct slide. No synthetic transcript if mic denied.

## M4 — Source indexing and preflight RAG
- Process supported docs/recordings and ongoing completed transcripts to pgvector and Postgres full-text search; hybrid search with exact course filters and public/private restrictions. Optional short grounded answer OFF by default.
- Mandatory preflight matching older lecturer explanations, relevant docs/lecture segments and public questions; allow submit despite match and after timeout. Timestamped historical audio references and recording playback link.
- Gate: old resource asked as new question produces real cited text or audio timestamp; irrelevant question not falsely shown answered; private reply never leaks; failure still posts through explicit fallback.

## M5 — AI topic intelligence, grouping, answer reuse
- Structured LLM current topic from slide + transcript + optional outline; configurable course polling automation/cooldown and lecturer manual override; AI feedback classification/soft reword original kept; public/private lecturer-only question groups and lecturer queue sorting.
- Post-lecture match audio excerpt for lecturer-marked answered Q, and suggest possible response for unmarked Q (do not auto-close). Editable/removable match, source status pending/ready/unavailable.
- Gate: topic transition intelligently prompts a poll at sensible checkpoint, question variants cluster, resolved lecturer group updates underlying Qs, previous teacher audio discovered/replayed on future query.

## M6 — Forum, polish, deployment and true E2E
- Full course forum: named course-public post/reply, protected legacy/feedback threads, sorting/votes, lecturer moderation, automatic carry-over from live, source preflight and search. Search across authorised resources/forums/recordings. On-VM HTTPS deployment instructions, backups, media limits, error handling.
- Gate: entire user journey in browser from signup/course upload/live mic slide poll/Q&A through end recording/forum/RAG and playback; tests run, all buttons working, request isolation verified, docker compose deployment tested.

## M7 — Only after real app works: licensed replay/demo
- Optional `ReplayAudioSource` and prepared slide time map to feed *same* live STT/polls/Q&A pipeline, using appropriately licensed lecture media; never embed third-party video/audio in repo by default. Record which portions use prepared timestamps/inputs versus actual live model processing.
- Gate: replay creates an ordinary live session to which real registered students can join, questions work; honest labels and licence credit. Capture backup demo video if requested.

## Tests minimum
- Backend pytest for authz/course-scoping, anonymous author null enforcement, privacy in retrieval/clustering/events, vote invariants, course join, upload job retries, transcript offset conversions, RAG selection and timeout fallback, lecturer answer matching.
- Frontend unit/component tests for poll render and ask-preflight/error flows; Playwright E2E smoke test from course signup to student Q&A and simple instructor response; optional real OpenAI smoke test behind explicit env flag.
- Track progress honestly in `docs/PROGRESS.md`: completed endpoints/screens, checked tests, missing env, known issues, next tasks.

## External dependencies / operations
- Need OpenAI API key and supported project entitlement/usage limits for chosen models, VM hostname/domain or temporarily local HTTPS tunnel, Docker, ffmpeg/LibreOffice inside worker images, persistent volume and enough disk for recorded audio.
- Test public HTTPS (getUserMedia unavailable on insecure external HTTP). Never store actual keys in repo. For browser transcript streaming follow current OpenAI API docs, not assumed SDK method names.


## M8 — Owner-promoted interactive slide diagrams

Optional batched actual-image opportunity analysis → any-slide/on-demand generation → private running preview/refinement → deliberate approval → immutable session publication → independent live student exploration → historical archive/slide-timeline exploration. Core permissions, stale-source/jobs, unique approval, zero suggestions, multimodal request validation and the actual opaque CSP renderer are tested. Feature is integrated in the existing worker/API/React/Compose stack. Verification and residual platform limits are recorded in PROGRESS.md / AI_WORKFLOW.md.

## M9 — Owner-promoted experimental BSL signing demo

Standalone actual-corpus/CWASA render test first, then optional student live-final queue and saved-window archive signing, private same-VM Kozha planner, strict message/session boundaries, real pause/resume/speed, visible omissions/latency, captions fallback and disclosed prepared vocabulary script. No new STT, synthetic gestures or modified engine. Required duplicate/unavailable-renderer/mobile/session-transition checks and exact observed results live in BSL_AVATAR.md / PROGRESS.md.
