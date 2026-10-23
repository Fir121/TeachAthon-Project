# LectureLoop — current implementation status

Updated 2026-10-20. **M0–M6 integrated core is implemented and running locally** at http://localhost:8080. Owner explicitly deferred VM deployment; no remote deployment is claimed. No blocking credentials remain: the owner configured the real server-side OpenAI key in ignored `.env` (mode 0600).

| Milestone | Delivered and verified |
| --- | --- |
| M0 | Compose/Caddy/Postgres pgvector; FastAPI/React; password/cookie auth; role and course authorization; initial build/tests |
| M1 | Three enrolment methods, shared lecturers, nested folders, validated uploads, durable conversion/retry, real PDF/PPTX slides and lecture setup |
| M2 | Shared presenter/student state, separate projection window, saved ink, QR/code join, persistent polls/vote revision, anonymous/named public/private Q&A |
| M3 | Actual mic encoding + PCM24k live OpenAI STT, mobile captions, durable chunks, FFmpeg assembly, protected range playback, timestamped archive/slide replay |
| M4 | Real FTS/pgvector indexing and hybrid search; mandatory proof-bound preflight/failure fallback; cited docs/audio/public threads; generated answers OFF by default |
| M5 | Real topic/outline adapters and poll policy; private/public semantic groups; feedback classification with original preserved; actual suggested recording excerpts without auto-resolution |
| M6 | Persistent forum/replies/moderation/search; responsive screens; deployment/backup instructions; full local integration, privacy and operational checks |

## Final evidence

- `docker compose up --build -d`: successful; API/Postgres healthy, worker/Caddy running; migrations through **0009** applied.
- `docker compose exec -T api python -m pytest -q -p no:cacheprovider`: **22 passed**, including actual LibreOffice PPTX conversion and FFmpeg byte-range playback.
- Host backend suite: **20 passed, 2 skipped** (the conversion tools are installed in the Linux image).
- `npm --prefix apps/web run build`: TypeScript + production build passed. `npm --prefix apps/web test`: **4 passed**. Python static checks and frontend format check passed; npm install/audit reported **0 vulnerabilities**.
- `LIVE_AUDIO_FIXTURE=/tmp/lectureloop-speech.wav npm --prefix apps/web run test:e2e`: **2 passed (26.9s)**. Real generated speech -> actual OpenAI -> enrolled mobile captions -> final transcript; anonymous private question marked answered before matching -> actual suggested recording excerpt; general public teaching transcript reusable in course search; original private question remains inaccessible to learner. Also verified desktop/mobile signup/enrolment, upload, slides, poll revision after refresh, private feed isolation, recording assembly, HTTP 206, and replay seek synchronization.
- `E2E_BROWSER=webkit npm --prefix apps/web run test:e2e -- --grep 'lecturer and mobile'`: **1 passed**. WebKit engine desktop/mobile classroom flow verified.
- Paid, opt-in actual REST/domain integration script passed resource extraction/embeddings/hybrid preflight, opt-in grounded summary, strict public/private equivalence grouping and group resolution, anonymous feedback classification, generated MP3 batch transcription and timestamped media citation. Actual OpenAI model checks passed for `gpt-live-transcribe`, `gpt-transcribe`, configured text and embedding models.
- Fresh isolated Postgres: `upgrade head -> downgrade base -> upgrade head` passed for all nine migrations; 55 UUID columns and pgvector verified; temporary database removed.
- `./scripts/backup.sh /tmp/lectureloop-validation-backup`: passed; automatic API/worker restart passed. Dump restored into a separate test database; **23 referenced media objects**, rendered slide previews and private signing key verified against extracted archive. Restore test DB removed; live `/api/ready` returned ready.
- Actual contract exported to `docs/openapi.json` and route inventory `docs/API_IMPLEMENTED.md` (92 REST/WebSocket operations).

## Scope and remaining limits

- **VM/HTTPS:** deliberately deferred by owner; local Compose is the delivered deployment. Production instructions are in `docs/DEPLOYMENT.md`.
- **Browser/device scope:** Chromium speech/recording and WebKit classroom are automated; physical Safari/iOS microphone permission and encoding have not been manually checked.
- **Storage:** original chunks are retained for recovery; automatic orphan-file garbage collection is not implemented. Limits, disk monitoring and maintenance guidance are documented.
- **API docs:** `/api/openapi.json` is the authoritative served contract. The optional Swagger UI uses third-party CDN assets that are blocked by the strict CSP; use the JSON contract.
- **Fixture records:** exact fixture IDs created by current tests are removed. Historical synthetic test courses remain because automatic approval review rejected pattern-based deletion as potentially affecting user data. No data was deleted by that rejected action.
- **M7:** optional licensed replay/demo remains deferred; no third-party university recordings have been collected or shipped. Abstract `AudioSource` supports a future replay source.

## Milestone work log

## Initial review — 2026-10-20
Read AGENTS.md, README.md and all eight specification documents. No blocking requirement contradictions. Docker engine 29.7.2 is available. Fresh directory has no git metadata.

## M0 — in progress
Source scaffold: FastAPI, SQLAlchemy, Alembic migration, opaque cookie auth, Argon2, origin protection, course CRUD/discovery and membership enforcement; database-backed worker; Vite React TS/Tailwind/TanStack Query/Zustand; accessible signup/signin and course dashboard; Compose/Postgres pgvector/Caddy/private media volume.

Validation pending first build and tests. OpenAI key/account entitlement and VM hostname not yet verified. No generated AI response or successful processing state is fabricated.

## M0 — checked foundation
- `docker compose up --build -d`: passed; Postgres and API healthy, worker/proxy running; migrations exited successfully.
- `GET http://localhost:8080/api/ready`: `{status: ready}`. OpenAPI served at `/api/openapi.json`; app served by Caddy.
- Backend foundation tests: 2 passed. Frontend account component test: 1 passed. TypeScript/production build passed.
- Initial Compose env_file form was incompatible; changed to the portable list form. A local ignored `.env` was generated from the example; no real credentials added.

## M1 — implemented, integration verification in progress
Enrolment requests/approval, one-use invitations, lecturer-add, equal multi-lecturer access; cycle-safe nested folders; bounded validated uploads; real PyMuPDF rendering and LibreOffice conversion; observable retriable durable ingestion; resource management/download/preview; prepared-deck lecture creation; course settings screens.
- Backend tests now 4 passed, including real PDF render, type rejection, course isolation, folder cycle and enrolment/invitation checks.
- TypeScript/production build passed.
- Full running-stack worker smoke pending rebuild. Audio imports deliberately report unavailable until M3 connects transcription.

M1 running-stack check: `apps/api/.venv/bin/python scripts/smoke.py` passed against Caddy/API/Postgres/worker: signup, membership denial, request+approval, real two-page PDF conversion, authenticated slide access, lecture creation. Synthetic test content only. Frontend build and tests passed with patched Vite/Vitest; `npm audit` reports 0 vulnerabilities.

## M2 — implemented; browser verification in progress
Session lifecycle and join code/QR, durable authorization-filtered WebSocket events with reconnect snapshots; shared live slide state, fullscreen and separate projection mode; saved annotation strokes; one-open poll constraint, supersede/history, latest-vote upsert and lecturer-only aggregates; anonymous/named public/private questions, proof-bound keyword preflight, upvote, moderation, answers and persistent discussions. UI renders actual state/errors and explicit post-after-preflight.
- Backend: 6 tests passed, including privacy, proof binding, DB anonymity constraint, private activity sequence protection, slide permissions, poll supersede/upsert and final session ending.
- Student and lecturer event sequences differ: hidden private activity cannot be counted through sequence gaps.
- Full audio pipeline, hybrid pgvector retrieval, topic grouping and archive still pending subsequent milestones.

M2 browser gate: `npm run test:e2e` passed (Chromium, lecturer desktop + separate 360px mobile student context). Actual browser signup, course creation, worker upload/conversion, lecture creation/start, WebSocket connection, shared slide advance, vote+revision+refresh persistence, anonymous question, lecturer resolution notification, private question visible only to lecturer. Screenshots written to ignored `apps/web/test-results/`. Frontend component suite: 3 passed; backend: 6 passed. Compose rebuilt successfully through migration 0003.

## M3 — recording implemented and Linux-tested; live provider gate blocked by missing key
Browser microphone permission and MediaRecorder codec negotiation; 24 kHz AudioContext/AudioWorklet PCM; configurable server-side live transcription adapter with manual bounded commits and item-ID matching; durable checksummed/idempotent chunks; pause/resume groups; FFmpeg assembly with session-relative silence offsets; authenticated range playback; transcript/timeline archive and synchronized slide/ink replay; abstract AudioSource for later replay source.
- Linux container backend suite: 8 passed, including actual FFmpeg assembly and HTTP 206 authorized byte-range playback. Host suite: 7 passed, 1 skipped because ffmpeg is provided in the container.
- Frontend: 4 component/logic tests passed. Initially Vitest collected Playwright files; fixed its include pattern to `src/**/*.test.{ts,tsx}`.
- OpenAI key is absent (checked presence only). Owner asked to configure ignored `.env`; live speech accuracy/model entitlement and batch STT cannot be validated yet. No fabricated captions/transcripts. Manual classroom and recording work without key.

## M4 — implementation underway
Postgres full-text and pgvector index, external model/dimension compatibility guard, asynchronous resource/transcript/forum indexing, dynamic visibility/exclusion filtering, bounded preflight, optional grounded summary OFF by default, cited course search screen.

M3/M4 live provider checks after owner configured ignored `.env`: actual `gpt-transcribe` returned the locally synthesized binary-search sentence; actual `gpt-live-transcribe` accepted current session schema, acknowledged a committed PCM window, and returned the final transcript; embedding API returned 1536 dimensions; Responses structured-output adapter returned validated topic JSON. Keys were never printed or sent to frontend. Test speech was synthesized locally with macOS `say`, converted to 24kHz mono by container FFmpeg; no third-party lecture data used.

Browser recording test diagnostics: initial run did not complete capture start within its assertion timeout; isolated rerun started capture and exposed a test race reading session ID before route navigation. Added explicit URL wait. Recording/browser result pending rerun.

## M4 — implemented and checked
Hybrid course-filtered FTS/pgvector retrieval, cited resources/audio/public questions and lecturer answers; current resource exclusion, deletion and visibility filters; immutable embedding schema/model compatibility guard; bounded 5s retrieval + optional 3s grounded answer; stateless preflight proof bound to exact question options and course; explicit failure/post-anyway path. Optional generated answers default OFF. Search UI integrated.
- Linux backend suite after M4: 11 passed. Real embedding and structured provider checks passed.
- Unit retrieval fixtures exclude private/cross-course/excluded sources and unrelated passages; failed retrieval still produces a valid posting proof.

## M5 — implemented; integrated checks underway
Structured topic context from slide + rolling transcript + material excerpts + optional outline; minimum stable interval, checkpoint/cooldown policy, suggested/manual/end-only modes and pause override; LLM equivalence grouping across public/private questions in lecturer-only queue; manual group/split/resolve; anonymous feedback classification with original retained; asynchronous actual-transcript answer matching, editable/removable suggested excerpts, never auto-resolving unmarked questions. Post-lecture index and matching jobs queued at end.
- Host backend suite: 13 passed, 1 ffmpeg-only skip. Frontend production build passed.
- Mocked-provider tests verify strict semantic behavior without external calls; real provider smoke is separate. Automatic question grouping and topic inference are functional adapters, not canned results.

## M6 — final integration and operational checks in progress
Course forum/replies, anonymous/named edits and moderation; carry-over of live questions; searchable resources, public discussions and transcript passages; resource index status/retry; course edit/delete; native PostgreSQL UUID migration; ingress size limit/log rotation; reproducible backend/frontend lockfiles; one-VM HTTPS and backup/restore instructions; local deployment confirmed by owner (VM deferred).
- Host backend suite: 15 passed, 1 FFmpeg-only skip. TypeScript/production build and 4 frontend tests passed.
- Python static checks pass. Source formatted for review. No copyrighted lecture data collected; optional M7 is intentionally deferred until the completed core is verified.
- Current validation work: apply final migrations to populated Postgres, real browser recording/caption/replay gate, multi-user classroom regression, worker indexing/AI jobs, actual PPTX conversion and backup check.

M6 integrated checks: both Playwright tests passed (24.2s) with generated speech via actual OpenAI. Verified separate desktop/mobile signup and live collaboration; revised poll vote after refresh; anonymous public Q + lecturer answer; private Q excluded from public feed; real browser mic encoding, durable upload, worker assembly, protected range playback, seek->slide mapping; live captions received by enrolled mobile learner, finalized transcript retained in archive, transcript passage found in course search.
Linux suite: **21 passed**, including real FODP->PPTX fixture creation and actual app PPTX->PDF/image conversion. Source fixture is locally authored, no third-party media. Host suite: 19 passed with FFmpeg/LibreOffice cases skipped because those tools are installed in the image.
Fresh isolated Postgres migration sequence `upgrade head -> downgrade base -> upgrade head` passed; native UUID identity columns and pgvector presence checked. Temporary migration database removed.

Additional actual-model application gate passed: extracted/embedded resource -> hybrid preflight -> opt-in grounded summary; strict LLM equivalence grouping of public/private question variants -> lecturer group resolution; actual feedback classification -> anonymous private question; uploaded generated MP3 -> batch model transcript with exact input-window start -> indexed timestamped media citation. Ran `RUN_OPENAI_SMOKE=1 apps/api/.venv/bin/python scripts/integration_smoke.py /tmp/lectureloop-speech.mp3`; fixture course removed afterward. Optional generated answers remained OFF outside that explicit synthetic-course test.

## Owner UX fixes — 2026-10-20, verified

Implemented history-backed creation/management/question dialogs; lecturer-safe discovery/access guidance; consistent form/error/dropdown spacing, quieter resource actions and contextual notifications; correct page-based PDF citations; authenticated PDF.js viewer, zoom and image fallback; readable expandable source excerpts. New `docs/AI_WORKFLOW_REVIEW.md` maps every AI trigger, provider input, storage path, output, visibility rule, user interaction and known limitation, with blank owner-review tables. AI behavior itself is unchanged.

Initial verification caught and fixed native dialog initial focus, a view-mode/query-navigation race and native embedded PDF downloads. The final viewer renders PDFs itself; no browser PDF plugin is needed. Updated API schema includes the protected binary PDF-preview endpoint.

Checks before final deployment: host backend 20 passed / 2 Linux-tool skips; Linux backend 22 passed; frontend 7 passed; production build and frontend formatting passed. Workspace browser check passed after PDF.js replacement, including real page rendering and no forced downloads. Final Chromium/WebKit regression and final local deployment status pending below.

A broad Ruff invocation picked up 153 import/style/unused-variable findings across the codebase under inherited lint rules; no unrelated mass refactor was applied. Isolated syntax/runtime checks (`--select E9,F63,F7,F82`) pass. Changed Python files are formatted with the project's 120-character convention.

Full regression also exposed an intermittent pre-existing recording assembly failure: the worker's cached session counters could remain stale even after SELECT FOR UPDATE, colliding with live caption event sequences. Event numbers are now allocated atomically in Postgres with UPDATE RETURNING, with separate public counters preserved. A regression test reproduces the stale worker instance and proves private activity does not introduce public sequence gaps. Host backend is now **21 passed, 2 skipped**. SQLAlchemy job failures now show a short processing/retry message instead of raw SQL in the UI. Recording tests also clean their exact fixture course in a finally block on ordinary assertion failures. An overly strict zoom-test label locator was corrected with an explicit accessible control name.

Final local Chromium gate: `LIVE_AUDIO_FIXTURE=/tmp/lectureloop-speech.wav npm --prefix apps/web run test:e2e` — **3 passed (32.9s)**. Verified create-dialog Back/Forward/Escape; desktop/mobile live classroom privacy and poll revision; real OpenAI speech captions and recording/replay; lecturer-only join guidance; management dialog initial/restored focus; readable mobile errors without overflow; actual PDF.js rendering, zoom, page-text disclosure and image fallback; cited page navigation; zero forced downloads; transient notifications cleared on navigation. Screenshots are in ignored `apps/web/test-results/`.

Final Linux backend: `docker compose exec -T api python -m pytest -q -p no:cacheprovider` — **23 passed**. Host backend **21 passed, 2 skipped** for Linux conversion tools. Frontend **7 passed**; TypeScript/production build, formatting and isolated runtime/static checks passed. `docker compose up --build -d` completed successfully with Postgres/API healthy and worker/proxy running. The served OpenAPI contract was re-exported; inventory includes 93 HTTP operations plus two WebSockets. Local-only deployment remains http://localhost:8080; no new credentials or VM are needed for this revision.

Cross-browser completion: WebKit exposed mouse-click/history focus restoration differences; dialogs now record their actual trigger and restore it explicitly. `E2E_BROWSER=webkit npm --prefix apps/web run test:e2e -- --grep 'workspace dialogs|lecturer and mobile' --output=/tmp/lectureloop-webkit-results` — **2 passed (15.2s)**, including the real PDF.js viewer. The final affected Chromium rerun also passed **2/2 (18.0s)**. Ready endpoint returned `{status: ready}`; API/Postgres healthy, worker/Caddy running. This UX revision is complete locally. PDF extraction/chunking/ranking and other AI workflow decisions are documented for owner review rather than silently redesigned.

## PaddleOCR ingestion and grouped source search — 2026-10-20

Implementation stage: **complete and verified locally**. Confirmed lean CPU profile applied; no unresolved product blocker or missing credential.

- Added migration 0010 for versioned extraction checkpoints/chunk offsets. Removed application PyMuPDF use; Poppler renders physical pages and LibreOffice still converts Office files. PaddleOCR PP-StructureV3 runs with pinned official ONNX CPU artifacts (mobile det/rec, layout plus-L), with SHA-256 verification, two threads, five-page checkpoint batches and priority for recording assembly. Rendering stays usable during extraction/backfill.
- Local semchunk 4.1.1 / cached cl100k_base: 512 tokens, 64 overlap, source offsets; documents split per physical page, TXT/JSON never acquire fake pages. Existing extraction and chunks stay live until atomic replacement.
- Typed grouped source links replace public chunk excerpts in course search and both preflight UIs. Internal text remains available for ranking and optional grounding. Eight parents after grouping; page/time links deduplicated; five locations initially. Optional answers remain off by default.
- Retrieval/embedding/generation budgets are 20/10/10 seconds. SQL/ranking uses its own thread/session, provider deadlines are bounded, PostgreSQL statements use remaining time, failed preflight returns an explicit post proof.
- Canonical AI_WORKFLOW.md created; review worksheet replaced by pointer; AGENTS.md requires documentation maintenance with future behaviour changes.

Checked so far:

- Host backend: `apps/api/.venv/bin/python -m pytest apps/api/tests -q` — 26 passed, 4 Linux-tool/OCR skips.
- Offline Linux worker: `docker run --rm -i --network none -v "$PWD/apps/api:/app:ro" lectureloop-worker python ... pytest.main(...)` — **30 passed**, 17.19 s. Actual digital/scanned/multicolumn/blank/rotated-cropped PDF and converted PPTX OCR; token limits/offset/content preservation; five-page checkpoint, injected second-batch failure, resume, old-index preservation, assembly priority; privacy/group/deadline tests. No OpenAI key or outbound access used in this suite.
- Authored OCR: five pages 7.703 s, peak 1501.2 MiB RSS; subsequent single page 2.507 s / 1046.3 MiB, converted PPTX 2.497 s / 928.3 MiB. Six-page render+two batch processes 10.82 s.
- `npm --prefix apps/web run build` and `npm --prefix apps/web test` — build passed, 7 tests passed. Fatal Python lint checks passed.
- Local `docker compose up --build -d` and migration 0010 succeeded; `/api/ready` ready. Real `SELECT pg_sleep(2)` under a 0.1 s statement budget cancelled at 0.104 s.
- Backfill: 14/15 existing PDFs complete at this checkpoint. The remaining 17-page PDF resumed from its saved batch artifacts after an old-image replacement; only that old-worker lease (heartbeat before replacement startup) was released. Final worker now handles SIGTERM gracefully and Compose permits the batch to finish before shutdown. Current real-content batch peak 1626.0 MiB; slowest batch observed 26.984 s. Originals/course permissions/exclusions retained.
- Subsequent Chromium/WebKit and final backfill completion evidence is recorded below; deployment remains local only.

Final verification:

- Final host backend: **27 passed, 4 skips**; final offline native ARM64 Linux worker: **31 passed**, 17.89 s. A stronger follow-up reading-order assertion (the whole left column precedes the right column) passed the real six-page OCR/checkpoint test in 10.16 s.
- Final frontend build and **7 unit tests passed**; fatal Python lint checks passed. The running OpenAPI export now describes SourceGroup/SourceLocation and explicitly omits chunk text/excerpts.
- Chromium: **4 core journeys passed**, 50.9 s (classroom privacy, real microphone captions/recording/replay, grouped PDF/preflight flows, workspace/PDF viewer). Separate real batch-STT/nonzero media timestamp journey **passed**, 6.1 s: **5 Chromium journeys total**.
- WebKit: classroom, grouped PDF/preflight and workspace journeys **3 passed**; separate real batch-STT/nonzero media timestamp journey **passed**, 6.7 s: **4 WebKit journeys total**. Verified the original source player opens and plays from the actual ~30-second input-window boundary.
- Initial integrated search failure exposed an existing all-terms FTS candidate gap after OCR joined sentence punctuation. Candidate collection now accepts any significant query term and applies the original relevance thresholds/ranking afterward. Repaired recording/document searches passed. An initial media test assumed exactly 30000 ms; the actual MP3 boundary was 30001 ms. The test now reads measured transcript times instead of imposing artificial precision.
- Final migration **0010**, **15/15 existing resources extracted**, **zero queued/processing/failed jobs** after tests. All current resources remain in their original courses with exclusions intact; no original files or historical courses were deleted. New browser fixtures remove only their exact freshly-created course IDs.
- Model assets are pinned by immutable official revisions and checked SHA-256; runtime offline extraction/chunking verified. Local Compose API/DB healthy, proxy/worker running. No VM deployment attempted.
- Deployment guidance updated from measured OCR peaks (~1.5–1.6 GiB), batch times and image/idle-service sizes: recommend 2+ cores / 8 GB Docker RAM, retain one OCR batch at a time. AI_WORKFLOW.md is the maintained behaviour reference, including course-wide retrieval versus saved question-specific recording associations.

- Real provider/domain regression: `RUN_OPENAI_SMOKE=1 apps/api/.venv/bin/python scripts/integration_smoke.py /tmp/lectureloop-source-speech.mp3` — **all checks passed**: OCR/embeddings/hybrid retrieval + opt-in grounded answer from internal contexts, private/public semantic grouping and human resolution, anonymous feedback routing, real MP3 batch STT and grouped media links. The exact fixture course was removed afterward. No credentials printed.

- Final dependency consistency: updated `uv.lock` has no PyMuPDF and matches every tested worker package version. Both container locks are reproducibly exported from it; `pip check` passed in API and worker after the final rebuild. Imported media now reports extraction ready only after real STT finishes. Final-image Chromium and WebKit media journeys re-passed with that status assertion (10.4 s / 11.0 s). `/api/ready` is ready.
- Complete: PaddleOCR/Poppler ingestion, local paragraph-aware chunking, resumable backfill, grouped source-link search, bounded preflight, canonical AI documentation and local rollout. No remaining failure in the required checks; lean-profile recognition limitations and sizing guidance are documented.

## Replay, image uploads and keyword relevance — 2026-10-20

Implemented and verified locally. New migration 0011 adds optional private profile/course/lecture image references. Real image decode/orientation/metadata stripping and bounded WebP storage; authorized upload/replace/remove UI in profile dialog, course settings and lecture banner dialog.

Annotation audit found actual persisted ink (8353–9133 ms before clear). Added time/seek replay regression coverage, timeline retry, separate archive heading layout, and slide-image-relative strokes with legacy coordinate compatibility. Course Search uses all-word/local-stemming/proximity qualification instead of accepting partial lexical or semantic-only matches; one-word and short technical queries supported. Preflight's hybrid policy remains intact; AI_WORKFLOW.md updated.

- Host backend: **41 passed, 4 Linux/OCR skips** after image authorization/validation, keyword relevance and annotation-coordinate tests.
- Frontend production build passed; component suite **8 passed**, including rewind/clear/legacy annotation rendering.
- Local Compose rebuild/migration, native Linux suite and Chromium/WebKit results are recorded below.

Verification complete:

- `docker compose up --build -d` applied migration **0011**, API/DB healthy, worker/proxy running. Final source changes built successfully; `pip check` passed in worker.
- `docker run --rm --network none -v "$PWD/apps/api:/app:ro" lectureloop-worker python -m pytest -q -p no:cacheprovider` — **45 passed in 20.31 s**. Includes genuine CPU OCR/Poppler/Office/FFmpeg tests, local keyword precision and inflection checks, image authorization/EXIF removal/resizing/invalid file limits, legacy/new annotation markers and clear events. Host suite **41 passed, 4 Linux/OCR skips**.
- Frontend production build, fatal Python lint and changed-file Prettier checks passed; **8 component tests passed**.
- Chromium: image/profile/course/lecture upload persistence, exact page search/preflight, classroom privacy, source media playback and workspace journeys passed. Real microphone journey re-passed (**14.0 s**) with actual saved drawing, visible learner ink, timed replay, clear and rewind checks. Independent legacy+new ink replay/alignment journey passed (**6.0 s**). **7 Chromium journeys verified across runs**.
- WebKit: **5 journeys passed in 43.6 s** (classroom, imported media times, images, grouped keyword/PDF/preflight and workspace). Dedicated legacy/new ink replay and image alignment passed (**7.8 s**). **6 WebKit journeys verified across runs**. Physical Safari/iOS microphone hardware remains outside these engine checks.
- Drawing regression initially sent no stroke because the test mouse targeted an off-screen SVG after scrolling to its toolbar; corrected by scrolling the drawing surface into view. The stricter course search correctly rejected a prior test query whose word “binary” was absent from that live STT window; the recording test now searches actual retained words “sorted interval”. No search gate was weakened to make the test pass.
- Existing recording audit: ink at **8353 ms**, clear at **9133 ms**. Kept its actual clear semantics; new strokes use slide-image bounds, old events retain legacy coordinates. Browser seek checks confirm ink restores before clear. Archive back-link/eyebrow/title bounding boxes do not overlap on mobile.
- Actual responsive screenshots inspected: image-dialog upload preview/actions and archive with both legacy and image-relative ink. Removed duplicate lecture-banner heading and separated file-input focus outline from helper text.
- API contract exported to `docs/openapi.json`, including nine picture operations, annotation coordinate marker and 1–200-character keyword query bounds. AI_WORKFLOW.md documents the separate local keyword / hybrid preflight policies and explicitly excludes picture uploads from AI/RAG.
- No original resources, recordings or historical courses were removed. Tests clean only exact newly-created fixture course IDs; deployment remains local only.

- Final polished image controls re-passed in Chromium (**2.5 s**) and WebKit (**6.1 s**). Final migration is 0011, `/api/ready` is ready and there are **zero queued/processing/failed jobs**. PostgreSQL candidate checks also passed for C++, AI and sorting/sorted inflections. All requested changes are complete locally.

## Classroom simplification and fixes — 2026-10-22

Implemented the owner-approved plan: slide uploads/preparation retry in Create lecture; contrasting reserved fullscreen controls and exit/Escape/keyboard navigation; new named/public question and reply contracts; automatic posting only after complete warning-free empty retrieval; stable submission identifiers; named lecturer-only feedback; author-only wording edits with separate lecturer delete permission; reply/deletion events plus two-second discussion/reply refresh; per-course live-session locking and uniqueness. Migration 0012 preserves historical private/anonymous data and refuses duplicate-live courses before schema changes. AI workflow, product/API/data/UI/decision/setup documents updated together.

Checked so far: host `cd apps/api && .venv/bin/python -m pytest -q` **44 passed / 4 environment skips**; Linux API `docker compose exec -T api python -m pytest -q -p no:cacheprovider` **47 passed / 1 OCR skip**; frontend `npm test` **12 passed**, production build/typecheck and Prettier check passed; focused fatal-error Ruff check and Python compileall passed. A broad inherited Ruff configuration reports 191 repository-wide findings, mostly existing import/style and fixture warnings; it is not a passing gate. No unrelated mass cleanup applied. The initial pytest invocation from repository root failed module discovery; rerunning from the documented API directory passed, and deployment instructions now use that directory.

Local `docker compose up --build -d` succeeded; `alembic current` reports **0012 (head)**. Read-only pre-migration PostgreSQL query found **zero courses with duplicate live sessions**. Initial Chromium journey passed upload transport retry, real rendering/auto-selection, concurrent PostgreSQL starts (200/409), independent-course start, and both fullscreen layouts; it then caught confirmation toast clearing on dialog navigation. Fixed by retaining a dismissible status banner in the discussion view. Browser reruns and final stack checks pending below.

- Provisioned Linux worker tested offline with `docker run --rm --network none lectureloop-worker python -m pytest -q -p no:cacheprovider`: **48 passed in 18.79 s**, including actual CPU OCR, conversion, chunking and new classroom tests. Later feedback compatibility coverage adds one further test to rerun.
- The browser harness’s exact-text locator could not match an alert containing its dismiss button; corrected the locator to target the alert. Simultaneous Chromium/WebKit runs then collided in Playwright’s shared artifact directory during teardown; independent output directories/sequential full-suite runs are used below. Application bodies reached successful deletion/moderation checks; those collided runs are not counted as passes.

Final verification:

- Host backend: `cd apps/api && .venv/bin/python -m pytest -q` **45 passed / 4 skips** (unavailable host Linux/OCR tools). Focused `ruff check app --select E9,F63,F7,F82` and compileall pass. The broader inherited Ruff style/import/fixture findings remain documented above; no claim that broad lint is clean.
- Final rebuilt Linux worker: `docker run --rm --network none lectureloop-worker python -m pytest -q -p no:cacheprovider` **49 passed in 17.52 s**, no skips, no network/OpenAI key; real OCR/conversion/chunking included.
- Frontend: `npm test` **12 passed**; `npm run build` typecheck/production bundle and `npm run format:check` pass.
- Chromium: `LIVE_AUDIO_FIXTURE=/private/tmp/lectureloop-speech.wav SOURCE_AUDIO_FIXTURE=/private/tmp/lectureloop-source-speech.mp3 npx playwright test --output=test-results/chromium` **8 passed in 1.4 min**. Uses existing authored/generated speech fixtures with actual STT; no third-party lecture content.
- WebKit: five regression journeys passed in the seven-test run; the API restart during the final image rebuild temporarily interrupted its two classroom journeys (502). Against the stable stack, `E2E_BROWSER=webkit npx playwright test --grep 'lecture upload|lecturer and mobile' --output=test-results/webkit-classroom` **2 passed in 28.6 s**. Combined, **all 7 selected WebKit journeys passed**. WebKit hardware microphone capture was excluded; Chromium tested the real browser capture/provider path with the authorized generated-speech fixture.
- The new journey proves actual malformed-PDF conversion failure and reprocess retry; genuine upload transport failure/retry; retained title and ready-deck auto-selection; concurrent PostgreSQL starts returning **200/409**; same-lecture idempotence; independent-course teaching and release on end; both true fullscreen modes with visible navigation/ink/exit, arrows and Escape; successful empty retrieval automatically posting; simultaneous duplicate submissions returning one question; lecturer-only deletion controls for others’ wording; and two-browser reply/thread removal without reload.
- Final schema export refreshed in `docs/openapi.json`. PostgreSQL reports both `question_submission_once` and the partial `one_live_session_per_course` indexes. Local Compose rebuilt successfully; **0012 (head)**; readiness **ready**. Exact fresh interrupted-test fixture `41b37f78-f9ac-41e6-9e2e-411e34493c61` was recovered from its trace and removed through its own test account after verifying its exact name. No historical/user courses were removed. Final queue check: **zero queued, processing or failed jobs**.
- Visual evidence: `apps/web/test-results/create-lecture-upload.png`, `fullscreen-control.png`, `fullscreen-projector.png`, `discussion-deletion-mobile.png`. Fullscreen screenshot inspected: contrasting controls and ink toolbar fit below the constrained slide. Live snapshots also use a two-second fallback refresh, alongside two-second course lists/open replies and immediate session-event invalidation.

All owner-approved changes are implemented locally. Historical private/anonymous data retains its protection; new feedback is named only to lecturers. Deployment remains local only at http://localhost:8080.
