# Decisions and intentional defaults

## Confirmed by project owner
- Primary roles: `lecturer` and `student`. Multiple lecturers can manage same course with equal privileges; no TA/admin role required for MVP.
- Email/password accounts and role selected at signup for prototype. Student account: name, email, password. Enrolment via invite links, student requests, or lecturer-add. Course discoverable, content gated. Course membership required for live session access.
- Persistent course contains hierarchical resource folders, lectures, sessions, forum, recordings, course-isolated RAG. A lecture takes place once in MVP; ending a session is final, not resumable.
- Uploaded resource targets: PDF, PPT/PPTX (converted to static PDF), DOC/DOCX, MP3, MP4, TXT and JSON exports. Processing automatic unless lecturer disables resource indexing; display pending/ready/failed and retry. Existing recording transcripts searchable and timestamp-linked.
- Built-in slide presentation is mandatory for live lecture; requires a prepared deck. Lecturer microphone used for live transcript/context; recorded audio + slide timeline + annotations allow after-class playback. No full screen video capture in MVP. Keep lecturer dashboard in sidebar or separate tab/window; student can see current slide, optionally captions, cannot independently navigate live slides.
- AI topic awareness combines current slide, rolling speech transcript, course materials and optional auto-generated outline. Do not equate slide transition with topic transition. No user-facing topic confidence indicator necessary.
- Poll: initial labels Understood / Somewhat understood / Unsure or confused / Completely lost (copy tweakable). Only one active; student can revise while open, only final vote retained; lecturer closes manually, but a new poll supersedes/archives previous one. Poll frequency/mode is course setting, not editable while live; lecturer can manually trigger polls.
- Questions (owner revision 2026-10-22): new discussions are named and course-public; anonymity/visibility choices removed. Historical private/anonymous records preserve their protections. Private visible only to lecturer course members. Anonymity must not store question-author user ID; anonymous author cannot later change/delete. Lecturer can delete but cannot edit another author’s wording; named author can edit/delete. General free-text feedback AI-classified/summarised; any soft AI rewrite is labelled and original remains available to lecturers.
- Retrieval **must run before posting**; if AI is down/times out, show error and allow posting. A successful warning-free empty question search posts automatically after Post question; matches/failures/degraded fallback require explicit confirmation. AI primarily returns **existing references** (material extracts / actual recorded excerpt) and not a chatbot. Optional short AI generated answer is course setting OFF by default; no multi-turn AI chat or teaching styles in MVP.
- Student sees suggestions to existing public questions and can upvote or insist on new post. Private question data cannot leak via suggestions; lecturer grouping sees equivalent private/public questions, mark group answered updates all. Private typed responses do not become public search results; public verbal lecture explanations are reusable without exposing originating private question.
- Lecturer may mark a question answered. No separate start-answer/stop-answer interaction. Recording excerpt matching happens asynchronously; a marked question stays answered even when a precise excerpt is not found, with honest playback state. Without marking, AI may suggest to lecturer (not silently resolve).
- Forum: EdStem-like posts and replies, lecturer and student authors, source search before posting, automatic carry-over of live Q&A, meaningful search. Lecturer controls resource and content moderation.
- Live captions visible in an optional student panel; no live transcript search. Post-lecture transcripts searchable. Interface responsive on all viewports; mobile-first student UI.
- Future only: general screen sharing, live-code and full video, multi-language, sign-language interpretation support, adaptive quizzes, standalone student-created draft courses, flashcards/revision, LMS integration.
- MVP all key features genuinely operational; no mock workflows. CS50 sample lecture/demo is **after** application foundation, not driving architecture.
- Single Codex agent builds from scratch; OpenAI API available; all deployments one Linux VM using Docker Compose; reasonable paid outbound AI APIs OK.

## Delegated engineering defaults (editable; Codex can implement without confirmation)
- Frontend: Vite + React + TypeScript, Tailwind, shadcn/ui primitives, TanStack Query for server state, Zustand for ephemeral UI, React Router. FastAPI backend, SQLAlchemy 2, Pydantic 2, Alembic; Postgres + pgvector. One backend worker process consuming DB-backed jobs (avoid introducing Redis unless a proven need). Caddy reverse proxy and HTTPS.
- Browser `getUserMedia` + MediaRecorder for lecturer recording; separate PCM stream for near-live transcription routed via backend adapter. Prefer modern browser support, validate on Chrome and Safari; clear error for unsupported encoding. Persist time-offsets from authoritative session clock. Raw audio recorded in small durable chunks and assembled by background FFmpeg job.
- OpenAI initial AI text/embedding and transcription adapters with env-configured model IDs. Default live STT `gpt-live-transcribe`; batch `gpt-transcribe` subject to API support / timestamp availability. STT indexes have chunk start/end offsets even when model doesn't provide word timestamps.
- Server-side session cookies (httpOnly Secure SameSite=Lax in production) or short access token with secure refresh design; Argon2 password hashes; CSRF precautions if cookies. File access authenticated and course-scoped.
- Background processing: `processing_jobs` table; dedicated Compose worker polls jobs using SKIP LOCKED and retries. Live endpoint never waits on embeddings, full audio stitching or long file conversion.
- Object storage: VM volume behind backend API, with file paths and metadata in database; safe filename generation, MIME verification, file size limits, file hashing; protected media HTTP range requests for seeking.
- Events: one WebSocket per live client for classroom state, plus authenticated binary audio upload path for lecturer if needed. JSON message envelope with version, event ID, session ID and monotonic sequence. Client reconnects using snapshot fetch.

## Intentional clarifications
- Teacher-uploaded material is course-trusted *as a resource*, but may contain uncorrected student responses; never claim text quoted inside uploaded documents was spoken/endorsed by lecturer unless supported. Do not add unnecessary verification UI for every chunk.
- Polls are topic-oriented but can be manually triggered, still one active. When new poll begins, supersede prior poll and keep its results.
- Student questions do not require slide/topic attachment; preserve lecture/session association and created_at for audit and playback correlation only. Do not rely on slide context for RAG answer relevance.
- A lecturer answer is a course-trusted act of marking a question addressed, not proof that an AI-selected recording excerpt is correct. Return credible excerpts as 'suggested excerpt' with source/time; teacher can remove bad link.
- Audio consent: explicit recording toggle/notice; microphone unavailable means slide presentation, questions and manual polls continue, but live transcription/context-dependent functions visibly unavailable. This keeps the public demo functional without pretending transcription worked.

## Implementation defaults — 2026-10-20
- No requirement contradictions found in the initial complete specification review.
- Cookie authentication uses opaque random tokens, SHA-256 token hashes in Postgres, Argon2 passwords, SameSite=Lax and configured Secure cookies. Unsafe cross-origin browser requests are rejected; API is same-origin behind Caddy. API access logging is disabled to avoid durable requester/question correlations.
- Memberships coalesce lecturer/student enrolment in one constrained table. Worker uses Postgres SKIP LOCKED and renewable/recoverable leases; no Redis.
- Caddy directly serves the compiled frontend; only Caddy exposes ports. Default local address is http://localhost:8080, suitable for browser microphone localhost exemption. Production requires HTTPS, a hostname and COOKIE_SECURE=true.
- OpenAI live/file guides verified on 2026-10-20: https://developers.openai.com/api/docs/guides/realtime-transcription and https://developers.openai.com/api/docs/guides/speech-to-text . Preserve configurable gpt-live-transcribe / gpt-transcribe IDs, use PCM 24 kHz and item IDs; never invent word offsets.

## Integrated implementation defaults
- Native PostgreSQL UUIDs are used for identity and tenant keys. Migration 0008 converts the initial scaffold's textual UUIDs without discarding data. Folder sibling names are case-insensitively unique.
- Real OpenAI HTTP adapters use Responses JSON schema, embedding dimensions/model compatibility, file transcription JSON and server-side Realtime WebSocket transcription. Their contracts are in `app/ai/providers/contracts.py`. Replacement providers can implement those protocols; no local inference runtime is built.
- Capture uses browser AudioContext resampling to 24kHz plus AudioWorklet PCM16. Manual five-second turns bound live input offsets. FFmpeg joins chunks per capture group before decoding (MediaRecorder fragments are not individually assumed playable), offsets groups into the common session timeline, and retains checksummed originals. Tests use generated speech/tone only, clearly as test fixtures.
- Private text and mixed private/public group metadata stay out of student feeds, retrieval and public event sequences. Private verbal explanations are represented only as general lecture transcript sources, without question origin links. Historical anonymous submissions remain identity-free. New named preflight proofs are stateless, expire after ten minutes, bind the actor/purpose/submission ID and contain no raw question.
- Full-text indexing remains real without provider credentials; semantic embeddings are only marked ready after actual provider success. Content conversion and search-index status are distinct; either can be retried. Changing an embedding space requires explicit migration and reindexing.
- Presence is transient per-user WebSocket connection state within the single API process, shown only as an aggregate to lecturers; no durable question-requester correlation is stored. All durable teaching/poll/question state is in Postgres.
- Owner confirmed on 2026-10-20: VM is not ready; deploy locally only. No SSH or domain work is required in this session.
- Named private submissions retain the author's edit/delete permission through an in-memory submission receipt and authorized write endpoints. They are still excluded from every student feed, private-thread read endpoint, public event and search result; no private replies are disclosed to students. Anonymous submissions have no author linkage or later write permission. The receipt echoes only the text the author just submitted.
- Worker leases renew every 30 seconds during processing, with attempt guards and recovery after expiry. Job status ordering uses creation timestamps rather than next retry time, so an old backoff cannot hide a newer successful run.
- Excerpt matching waits for actual playable recording state, uses existing transcript windows plus bounded adjacent windows, rechecks removal before writing, and never changes lecturer resolution state. Matching is retriggered after recording assembly and late finalized transcripts.
- New end-to-end tests remove only their exact freshly created fixture course IDs. Automatic approval review rejected pattern-based cleanup of historical test courses/media because the pattern could include user-created data; those records were preserved. No workaround was attempted.

## Workspace UX revision — 2026-10-20
- Course/lecture/folder creation, folder editing, resource management, question composition and course deletion use URL-backed native dialogs. Open adds history; Back/Escape/Cancel closes, Forward reopens, and directly linked dialogs close in place. Native modal semantics constrain focus; initial field focus, restoration and viewport scrolling are handled explicitly.
- Student discovery/request-to-join appears only for student accounts. Lecturers create courses or use lecturer invitations; backend membership/role checks remain authoritative.
- Resource actions stay compact; management uses a spacious form with separate processing and removal sections. Errors stay beside the relevant form; duplicate global notifications are suppressed while a dialog is open. Notifications expire and are cleared on navigation.
- Document citations use the resource viewer plus page number. Audio times are shown only for actual numeric recording offsets; null document timestamps are never formatted as zero.
- PDF and converted Office previews use authenticated PDF bytes and a self-hosted, lazy-loaded PDF.js canvas viewer with page controls, zoom and optional page-text disclosure. Rendered page images remain a fallback. Native embedded PDF preview triggered downloads in Chromium verification and was replaced. No PDF iframe/framing exception remains; Caddy retains frame-ancestors none and permits only same-origin scripts/workers plus WebAssembly decoding.
- Superseded by the source-link results decision below. Earlier excerpt formatting was a presentation change only: collapse layout whitespace, show an initial excerpt and allow expansion. Models, prompts, extraction, stored chunks, ranking and automatic AI decisions are unchanged. Current behaviour and limitations are documented in AI_WORKFLOW.md.
- Session event counters use an atomic database UPDATE RETURNING, then synchronize the ORM instance without marking counters dirty. This prevents cached worker state from colliding with live caption events, while private events still do not advance the public sequence. Database processing errors are translated into a retry message before reaching product UI.

## Confirmed OCR and source-based search update — 2026-10-20

- Owner approved PaddleOCR PP-StructureV3 with official ONNX CPU artifacts, PP-OCRv5 mobile detection/recognition and PP-DocLayout_plus-L. Lean profile: text/headings/reading order; no dedicated table/formula/chart reconstruction. Poppler replaces application PyMuPDF use. Static LibreOffice conversion, PDF.js and annotations remain.
- Owner approved local semchunk (512 tokens, 64 overlap, cl100k_base, exact offsets), five-page resumable OCR batches, two CPU threads, recording assembly priority, versioned backfill preserving current usable data until successful replacement.
- Owner approved grouped source links in course search and both preflight views, without indexed text excerpts. Limit eight parents after grouping; five locations initially; recordings use actual input-window offsets; TXT/JSON have no physical pages.
- Owner approved retrieval/embedding/generation budgets of 20/10/10 seconds, with preflight at most 30 seconds and explicit post-after-failure proofs. Optional generation remains off by default. Topic/poll/feedback/matching decisions remain unchanged.
- Delegated defaults: immutable versioned per-page JSON checkpoints on private media; model revisions plus SHA-256 validation at image build; cached tokenizer in both images; short-lived OCR subprocesses to return memory between batches. No extra service or Redis.
- AI_WORKFLOW.md replaces the review worksheet and must accompany future AI behaviour changes. Local Compose only; no VM deployment authorized or attempted.

- Integrated OCR/search verification exposed all-terms full-text candidate loss after OCR joined sentence punctuation. Candidate collection now accepts any significant query term, followed by the unchanged two-word/0.45 lexical or 0.78 cosine gates and unchanged rank formula. This repairs keyword fallback without exposing chunks or relaxing relevance qualification.

## Replay, pictures and search refinement — 2026-10-20

- Owner requested checking missing replay ink, image uploads in profile/banner spaces, archive heading spacing, and word-based course search with better relevance. No blocker or questionnaire needed.
- Saved ink was present in one current recording: stroke at 8353 ms, clear at 9133 ms. Replay must honor that brief interval and restore ink when rewound. New ink is normalized to the actual slide image so fullscreen/mobile frames cannot shift it; legacy frame coordinates remain supported.
- Delegated picture scope: own profile picture plus course/lecture banners, with preview/upload/replace/remove. JPEG/PNG/WebP only, 5 MB / 20 MP limits, EXIF orientation, metadata removal, local WebP derivatives in authenticated private storage. Pictures never enter AI/retrieval; no author images or identity links are added to anonymous questions.
- Course Search now requires all significant words in one bounded passage or the current parent title, supports one-word/short technical queries and local English stemming, boosts phrase/proximity matches, and rejects terms scattered more than 80 words apart. Title-only hits have no invented passage links. Course search does not call embeddings. Question/poll-note preflight retains natural-question hybrid retrieval and its existing fallback/proof behaviour.
- Canonical AI_WORKFLOW.md updated with the separate search policies and non-AI picture/annotation flow. Local Compose deployment only.

## Owner-approved classroom simplification — 2026-10-22

- New questions and replies are named and course-public; replies inherit their thread’s visibility. Historical private/anonymous submissions stay protected, with no retroactive publication or identity recovery.
- Feedback notes identify the sender to lecturers and remain lecturer-only through classification/manual routing. Anonymous historical notes retain no author.
- One live lecture per course, with course locking plus a partial unique index. Other courses remain independent; concurrent same-lecture starts return the same session. Existing conflicts must be resolved explicitly before migration.
- Question creation uses a stable submission UUID for retry deduplication. Only complete warning-free empty searches auto-post after the user chooses Post question; matches and failures keep confirmation.
- Authors alone edit wording; lecturers retain moderation/deletion/resolution. Separate edit/delete capabilities are returned by the server. Open discussion lists/replies refresh every two seconds and live events invalidate caches.
- Slide uploads are available inside Create lecture; rendering readiness suffices while OCR/indexing continues. Fullscreen reserves visible control/annotation toolbars and supports exit/Escape.

## Owner follow-up fixes — 2026-10-23

- Dismiss means Move to discussions, not removal. A separate discussion-only flag hides it from live queues while retaining forum/search visibility, original privacy, session context and resolution. Old dismissed records are recovered; actual deletes stay deleted.
- Answered questions retain a whole-lecture recording link independently of AI excerpt success. Precise clips take precedence; the fallback has no fabricated timestamp and labels live/processing states honestly. Missing/disabled/failed recordings produce no fake playback.
- Feedback notes send directly, without source checks/proofs. The lecturer feedback panel shows the original text, while a useful derived question and its edit label stay in the private queue. General feedback never gets rewritten, and cosmetic punctuation/case/spacing edits are ignored. Existing cosmetic feedback derivatives are repaired without altering originals/human edits.

## Manual grouping and complete feedback requests — 2026-10-23

- Owner requested grouping checkboxes only after an explicit action, retention of all questions in mixed notes, and removal of the Original feedback tag. Group questions enters selection mode with tooltip/visible help explaining existing AI grouping; Cancel/Escape clears selection and saving exits it.
- Delegated default: keep one private queue entry per note, with all extracted requests in separate paragraphs. Require ordered exact source quotes, falling back to the complete original when extraction is invalid or leaves an explicit request cue behind. No schema migration or public contract change; source quotes are transient. Safe reclassification preserves human edits, answers, movement and manual grouping. AI_WORKFLOW.md records the prompt, storage, guard and limitations.

## Split groups restore individuals — 2026-10-23

- Owner reported Split group creating individual groups with bulk answer controls. Confirmed: old code stored manual singleton clusters. Split now detaches questions; lone remainders are detached as well. Group headings/actions require multiple visible members. Existing singleton/empty groups are repaired in migration 0014.
- Delegated default: preserve the previous protection against automatic regrouping using an internal per-question flag rather than singleton clusters. Explicit manual regrouping still works. Delayed provider results recheck this decision before writing. Text, human resolution, source matches, authors and visibility stay intact; only grouping state changes. Deletion/movement/reassignment also clean up lone remainders.

## Semantic processing corrections — 2026-10-23

- Owner authorised F1–F10 fixes: feedback must use one strengthened LLM pass (no second verifier/cue regex), grouping prioritises precision over recall, and quality verification stays a small fixture-driven check. Deterministic permissions/proofs/lifecycles remain authoritative.
- Course search retains the Search words UI while sharing semantic source assessment with preflight. Lexical features propose candidates or form an explicit degraded fallback; they no longer certify semantic relevance. Missing credentials/index coverage/assessment failure cannot silently enable automatic posting.
- Single-pass whole-note segments account for every request/feedback span and declared intent. A cheap provenance check permits original sentence separators between exact quotes, retaining that original punctuation; missing words/operators preserve the whole note. No regex infers request meaning.
- Grouping checks all members/requests, rejects missing assumptions and uncertain/distinct teaching needs, and keeps every card visible. Existing auto groups undergo review before bulk answering; manual decisions and human answered states remain intact. Different requested quantities (runtime versus comparison count without shared premises) stay separate.
- Transcript windows are contextualised before semantic selection; complete multi-request coverage may link multiple real passages. Partial coverage stays lecturer-only, with whole-recording fallback. Unversioned ready links are retained for explicit lecturer review; new manual selections and removed links are protected from background replacement.
- Input/token/source budgets are explicit, with complete sections and balanced sources. Outlines map every section, save checkpoints and reduce hierarchically; partial status is visible. Existing local OCR/semchunk remain as approved. No additional service/model provider/dependency introduced. Simple offline regressions plus one authored real PostgreSQL/provider gate check the changes.


## Interactive diagrams — owner-promoted scope, 2026-10-23

- Optional explicit six-page checkpointed vision analysis, with zero suggestions valid and no count target. Generate on demand from suggested or any manually selected slide. Separate env-configured multimodal adapter; no change to text-provider semantics and no new service/dependency.
- Durable private revisions in Postgres, pixel fingerprints independent of OCR, request deduplication and one-approved-per-slide partial unique index. One lecture-row lock serializes edits, final worker writes and start; long provider calls release it. Start publishes only already approved artifacts and makes all preparation mutations final, including for archive.
- The same opaque `sandbox="allow-scripts"` viewer serves preview/live/archive. Route-specific authenticated HTML CSP is forwarded without the conflicting global Caddy policy; the main policy is unchanged. Static checks supplement CSP/sandbox and cannot prove arbitrary code safe. Browser CPU/self-navigation limitations are documented rather than hidden.
- Replay now exposes actual slide-event navigation as well as audio/transcript seeking, making exploration available without recording. Human review and source-slide comparison stay central; valid model output is not certified educational correctness.


## Owner-approved diagram UI revision — 2026-10-23

- Integrated slide workspace, explicit multi-slide selection/generation, per-slide real job feedback, ready-list entry to review and no background auto-opening.
- Approve and next after a running preview replaces the extra checkbox. In-place refinement and explicit replacement review preserve current approvals. Source reference stays compact and expandable; start remains independent.
- A full-viewport laptop canvas/context sidebar replaces the tall stacked viewer. Shared frame execution/security is separate from presentation. New generated HTML follows a structurally validated responsive-v2 visual/controls convention with trusted layout CSS; published/legacy code is not rewritten. No migration or batch endpoint.

## Experimental BSL integration — 2026-10-24

Owner authorized investigating/integrating Kozha and its CWASA iframe. Single optional same-VM internal Compose dependency, no public ports/translator proxy, runtime egress or authoring credentials; existing API remains authoritative. Pinned source and supplementary official CWASA resources are provisioned with checksums at image build, not vendored into git. Upstream engine/config/avatar bytes stay unchanged. Student opts in; live finals/persisted transcripts and archive timestamps are reused, without another STT pipeline. Short stable segments, deduplication, bounded playback and visible missed/unknown coverage prevent a claim of complete live signing. Corpus gaps skip a whole segment; no invented gestures or spelling-as-fluency fallback. Kozha's rule-based planner is an explicit owner-requested experimental exception, not a replacement for semantic course logic. A disclosed authored corpus vocabulary script is the reliable demonstration; grammar and intelligibility remain unvalidated. Noncommercial DictaSign terms and CWASA no-derivatives terms are retained. Full setup/security/limitations/evidence: BSL_AVATAR.md, AI_WORKFLOW.md §16, PROGRESS.md.
