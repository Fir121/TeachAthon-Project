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
