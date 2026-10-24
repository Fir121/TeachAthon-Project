# Run and operate LectureLoop

## Local use
Requires Docker with Compose. Recommend **2+ CPU cores and 8 GB RAM available to Docker**, plus disk for original media, rendered pages and checkpoints. The tested ARM64 Docker environment has 7.746 GiB usable RAM; inference uses two CPU threads. Docker builds install Poppler, LibreOffice and FFmpeg; the host does not need them. Local deployment is the current verified target; no VM deployment has been performed.

```sh
python3 scripts/configure.py
docker compose up --build -d
docker compose ps
```

Open http://localhost:8080. Create a lecturer account, create a course, upload a PDF/PPTX under Resources, wait for actual conversion, create a lecture using the prepared deck, and start it. Create a student account in another browser/profile. Enrol by invitation, request+approval, or lecturer-add. The join code/link requires course membership.

For AI features set `OPENAI_API_KEY` in ignored `.env`, then `docker compose up -d --force-recreate api worker`. Never put it in a frontend Vite variable. All model IDs and provider base URL are externalized. `gpt-live-transcribe` uses server WebSocket PCM24k with manual five-second commits; `gpt-transcribe` processes 30-second file windows. Transcript offsets locate input windows, not individual words. Microphone permission, TLS, network and provider errors are surfaced; slides, questions and manual polls remain functional.

Optional generated answers are OFF by default. Semantic indexing without a key uses genuine text extraction and keyword/full-text search; no embeddings are invented. Configure the key and choose Rebuild search index on a resource to add real embeddings. Changing model/dimension after schema creation is rejected; use a deliberate migration, clear old vectors and reindex rather than mixing embedding spaces. Initial supported dimension range is 1–2000 for HNSW.

API docs: `/api/docs` (Swagger UI needs its external JS assets; use `/api/openapi.json` if a restrictive network blocks the UI). Authenticated media URLs support HTTP Range for recording playback. Original-file downloads use attachment disposition. Authenticated PDF/converted-document previews feed a self-hosted PDF.js viewer with page navigation, zoom and an image fallback; no browser PDF plugin is required. The CSP keeps framing disabled and permits same-origin workers and WebAssembly for PDF decoding. No public raw media directory exists.

## One Linux VM with HTTPS

Use a hostname whose A/AAAA records point to the VM; open inbound TCP 80/443. Install Docker Engine and the Compose plugin. Copy the source and private configuration to the VM. Use an SSH account with access to Docker; do not put private SSH keys or `.env` in git.

Set in VM `.env`:

```dotenv
SITE_ADDRESS=lectures.example.org
APP_ORIGIN=https://lectures.example.org
COOKIE_SECURE=true
HTTP_PORT=80
HTTPS_PORT=443
```

Keep the randomly generated database password and matching DATABASE_URL from `scripts/configure.py`. For an existing database, changing POSTGRES_PASSWORD alone does not rotate the initialized database password. Preserve it or explicitly rotate it in Postgres. Set OPENAI_API_KEY and entitled model IDs. Then run `docker compose up --build -d`. Caddy provisions HTTPS for the configured domain. Verify `/api/ready`, account signup, authorization, microphone permission, captions and recording playback in the actual external browser. A domain and SSH target are required for the final on-VM verification; local Compose is not evidence of public HTTPS deployment.

Only Caddy publishes ports; Postgres remains on the Compose network. API and worker run unprivileged. Compose volumes persist DB, media, TLS certificates and configuration. One API process and one worker are intentional. No Redis, Kubernetes or external object storage. Set Docker daemon log rotation (`max-size: 10m`, `max-file: 3`) or use the service defaults in compose.yaml. HTTP access logging is disabled to avoid recording user/question correlations. The application does not audit anonymous question requester identities.

## Jobs, failures and storage

Rendering, OCR extraction and indexing have separate visible states. A prepared slide deck is usable as soon as rendering finishes. Failed conversion has Retry processing; failed/missing embeddings have Rebuild search index. Jobs claim rows with SKIP LOCKED, retry three times with backoff, and recover processing leases after 15 minutes. Worker runs jobs sequentially. OCR runs in checkpointed batches of five pages, releases inference memory between subprocesses, and yields to recording assembly before the next batch. The worker handles SIGTERM after saving its current operation; Compose allows 11 minutes for its bounded batch to finish. Expired processing leases recover after a crash. Process long recordings in bounded windows. User originals remain available during processing failures. Resource removal and indexing exclusion immediately filter search through current metadata even before cleanup.

Upload limit: 100 MB per file, ingress limit 105 MB including multipart overhead; 500 rendered pages; archive recordings use 4-second browser chunks, max 5 MB each. Check disk with `docker system df` and `df -h`; alert before storage fills. Original media chunks are retained for recovery, so monitor volume growth. Deleted metadata is inaccessible through the API; orphan file garbage collection is not automatic. Review retained file directories during a maintenance window against database storage keys before removal. Do not prune volumes as a cleanup shortcut.


## Local OCR provisioning, backfill and sizing

Dependencies are pinned in `apps/api/uv.lock`; regenerate container requirements with `uv export --project apps/api --locked --format requirements-txt --no-hashes --no-emit-project` (add `--extra ocr` for the worker). The worker image installs the separately pinned `apps/api/requirements-ocr.lock`; API/migration images do not load the OCR runtime. Build provisioning downloads official ONNX model artifacts at the exact revisions in `app/ocr_models.json`, verifies `app/ocr_checksums.json`, and caches them at `/opt/lectureloop/models`. `cl100k_base` is cached under `/opt/lectureloop/tokenizer` in both images. Models/tokenizer are image layers, so normal source edits reuse the provisioning cache. Internet is needed to provision/rebuild uncached layers, **not** to OCR or chunk documents afterward. No document content is sent to model artifact hosts. OpenAI embeddings/STT/text features still require their configured provider; local OCR, chunking and keyword retrieval work without a key.

Migration 0010 preserves existing usable data. Worker startup idempotently schedules old resources for versioned extraction/chunking backfill and old transcript/forum chunks for local reindexing. Per-page checkpoints live beside the private original under the extraction version directory. Source files and old searchable extraction stay available until the complete replacement is committed. Exclusion and current course permissions remain authoritative throughout. A failed batch retains completed pages; Retry processing resumes them. Rebuild search index retries missing embeddings independently. A ready index without a configured key means keyword-searchable text, not invented vectors. Monitor extraction progress in Resources; metadata is also available from `/api/v1/resources/{id}/status`.

Measured in the local ARM64 environment (2026-10-20): authored five-page lean OCR batch **7.774 s / 1515.9 MiB peak RSS**, subsequent single-page batch **2.634 s / 1049 MiB**; full six-page rendering plus two extraction subprocesses **11.03 s**. A real existing-document batch peaked at **1626 MiB**, with the slowest observed batch **26.984 s**. After inference exits, observed idle worker/API/proxy/DB memory was approximately **123/86/23/79 MiB**. Image size reported by Docker was approximately **804 MB worker / 423 MB API**, with shared layers. These small samples are sizing evidence, not throughput promises for dense scans or concurrent classroom load. Keep the 8 GB recommendation and monitor RSS, CPU, queue delay and disk before increasing concurrency or upload/page limits.

Retrieval budgets are `RETRIEVAL_TIMEOUT_SECONDS=20`, `QUERY_EMBEDDING_TIMEOUT_SECONDS=10` (inside retrieval) and `ANSWER_TIMEOUT_SECONDS=10` (optional generation after retrieval). Settings are bounded to keep preflight at most 30 seconds. Search/preflight route work runs in threads; PostgreSQL and provider deadlines are enforced. AI behaviour/storage details are maintained in [AI_WORKFLOW.md](AI_WORKFLOW.md).

Provisioned offline verification (no key and no outbound network):

```sh
docker run --rm --network none lectureloop-worker python -m pytest -q -p no:cacheprovider
```

The test fixtures are authored digital/scanned/multicolumn/blank/rotated PDFs and a LibreOffice-converted deck. They verify five-page checkpoint/resume and atomic old-index replacement. Tests use temporary SQLite metadata; they do not modify the application's database or media volume.

## Backups and recovery

Run `./scripts/backup.sh /secure/backups/lectureloop-YYYYMMDD`. It quiesces API/worker for the snapshot, saves a Postgres custom dump and private media tarball, and restarts services on exit. Backups include transcripts, course documents, anonymous question text and the private preflight signing key. Restrict access, encrypt off-host copies and test restore regularly. Back up `.env` separately using a secret manager. Caddy can reacquire certificates, but its volumes may also be backed up.

To restore into an empty deployment: start only db (`docker compose up -d db`), wait for health, then `docker compose exec -T db pg_restore -U lectureloop -d lectureloop --clean --if-exists < database.dump`. Restore media with `docker compose run --rm --no-deps -T --user root api tar -C /media -xzf - < media.tar.gz`, then `docker compose run --rm --no-deps --user root api chown -R lectureloop:lectureloop /media`. Run `docker compose up -d` to apply any newer migrations and start services. Restore commands replace database contents: execute only against the intended empty/recovery deployment. Verify membership and an archived recording before reopening access.

## Development and checks

```sh
uv sync --project apps/api
# Provision the host tokenizer once; Docker images already include it.
apps/api/.venv/bin/python -c 'import tiktoken; tiktoken.get_encoding("cl100k_base")'
npm ci --prefix apps/web
(cd apps/api && .venv/bin/python -m pytest -q)
npm --prefix apps/web run build
npm --prefix apps/web test
# Running Compose required; browser install once:
cd apps/web && npx playwright install chromium && npm run test:e2e
```

`docker compose exec -T api python -m pytest -q -p no:cacheprovider` includes actual Poppler/LibreOffice/FFmpeg tests; the worker-image offline command above also runs real ONNX OCR. Host-only runs skip unavailable Linux/OCR tools. Unit tests disable real provider calls. `scripts/smoke.py` creates unique synthetic course content in the running stack. Playwright creates isolated accounts, uses a disclosed synthetic microphone test device and validates actual browser encoding, uploads, assembly and playback. `RUN_OPENAI_SMOKE=1` and the documented provider smoke script separately exercise paid model APIs. No canned AI responses are used in application code. No licensed third-party lecture demo has been collected; M7 is optional after the working core.

To rerun paid provider/domain checks with an authorized short test recording, copy a 24 kHz PCM16 WAV into the API container and run `docker compose exec -e RUN_OPENAI_SMOKE=1 api python -m app.provider_smoke /tmp/speech.wav`. To exercise extraction, optional summaries, question equivalence grouping and MP3 ingestion through actual REST routes, run `RUN_OPENAI_SMOKE=1 apps/api/.venv/bin/python scripts/integration_smoke.py /path/to/authorized-generated-speech.mp3`. Those checks create clearly named synthetic fixture accounts/courses; the fixture course is removed afterward. No real key is printed.

For the full browser speech gate, set `LIVE_AUDIO_FIXTURE=/absolute/path/to/authorized-speech.wav npm --prefix apps/web run test:e2e`. Chromium uses that file as its disclosed test microphone input; actual application recording and provider calls remain in use. Without it the recording test uses a synthetic device tone and does not claim speech accuracy. Existing account courses are not used as test fixtures.

Additional browser-engine smoke: install WebKit with `cd apps/web && npx playwright install webkit`, then from the repository root run `E2E_BROWSER=webkit npm --prefix apps/web run test:e2e -- --grep 'lecturer and mobile'`. This covers the classroom flow in the WebKit engine; physical Safari/iOS microphone hardware is a separate manual check.

Earlier validation runs left courses clearly named `Smoke course …`, `Browser course …` and `Recording …`. They contain actual persisted synthetic test activity and generated speech, not application seed data or fabricated provider output. New tests remove their exact freshly created course IDs. Historical cleanup by pattern was rejected by automatic approval review, so those earlier records remain intact; do not delete arbitrary courses based on labels alone.

The grouped-source browser journey uses the authored six-page `e2e/search-pages.pdf`; it verifies deduplication, five-location expansion, PDF page 6, both preflight screens and explicit retry to obtain a genuine proof after an injected transport failure. For real imported-media timestamp playback in Chromium/WebKit, provide `SOURCE_AUDIO_FIXTURE=/absolute/path/to/authorized-speech-longer-than-30s.mp3`; the test calls actual batch STT and follows the 0:30 link. The verification here used a 40-second repetition of authored generated speech, not a third-party lecture. Example: `E2E_BROWSER=webkit SOURCE_AUDIO_FIXTURE=/tmp/lectureloop-source-speech.mp3 npm --prefix apps/web run test:e2e -- --grep 'workspace dialogs|lecturer and mobile|grouped source links|recording search groups'`.

Semantic quality gate (0015): `docker compose exec -e RUN_OPENAI_SMOKE=1 worker python -m app.quality_smoke`. This is one small authored fixture file and pass/fail runner, using actual local REST/PostgreSQL/provider paths. It prints case timings/model versions and removes only its own exact fixture course. It needs the configured OpenAI key and makes paid calls; it prints no credentials. Unit tests remain offline. Migration 0015 adds request/provenance metadata; worker startup queues versioned reprocessing of existing notes and review of old automatic groups. Manual/human wording, resolution, privacy and anonymous identities remain protected. Unverified automatic groups cannot be bulk-answered until checked; individual cards remain usable. Partial outline processing resumes from saved checkpoints. Deployment remains local only.

Profile pictures and course/lecture banners are local private media, outside the resource/OCR pipeline. They accept decoded JPEG/PNG/WebP up to 5 MB and 20 MP, strip metadata and store bounded WebP derivatives. Their references are added by migration 0011. Profile controls are available from the avatar button; course banners in course settings; lecture banners on lecture setup. Include these media files in the existing volume backup. Course search and preflight now share hybrid recall and bounded semantic assessment; keyword-only search remains an explicit fallback without provider credentials. Incomplete checks cannot automatically post a question.

Migration 0012 adds named feedback attribution, question retry identifiers and one-live-session-per-course uniqueness. It first checks for courses with multiple live sessions and refuses migration with those course IDs; explicitly end the extra lectures through the existing application before retrying. Historical private/anonymous records are not published or reidentified. Rebuild all local services together so the simplified request schemas and frontend update together.

Migration 0013 recovers previously dismissed discussions using a separate live-queue flag, preserves known human resolution and queues public records for reindexing. It also removes cosmetic/general-feedback rewrite derivatives while keeping originals and human edits. Rebuild API/worker/frontend together for the direct `{text}` poll-note contract and updated feedback classifier. Notes no longer require any source-search/provider success before acceptance.


## Interactive diagram renderer and configuration (0016)

Rebuild API/worker/proxy together with `docker compose up --build -d`; migration 0016 adds private diagram analysis/revision tables. No new service, volume or runtime dependency. `OPENAI_DIAGRAM_MODEL=gpt-4.1-mini` must support vision + strict structured output; `DIAGRAM_TIMEOUT_SECONDS=120` is bounded at 180. The server’s existing key/base URL are reused. Image inputs leave the VM only after explicit lecturer preparation commands. Generated source is in Postgres and therefore in database backups, never Vite/Caddy's static tree. Course permissions and no-store responses protect render reads.

Caddy's negative matcher excludes only `/api/v1/diagrams/{UUID}/render` from the global CSP. The backend supplies that document's restrictive CSP with `frame-ancestors 'self'` and HTTP `sandbox allow-scripts`; all other application responses retain their original script/framing policy. Do not append a second global CSP or add global inline/eval permissions. Preview/live/replay frames grant only allow-scripts and use opaque origins. Do not expose the API on a separate public port or turn the render document into a static file. See AI_WORKFLOW.md §14 for CPU, generated-content quality and self-navigation limitations.

Checks: `npm --prefix apps/web run test:e2e -- e2e/interactive-diagrams.spec.ts --grep 'approved diagrams'` seeds a clearly authored test-only artifact through an operator test process, then uses the real authenticated renderer/proxy/browser; no production fixture endpoint exists. Add `E2E_BROWSER=webkit` for WebKit. `RUN_DIAGRAM_AI=1 npm --prefix apps/web run test:e2e -- e2e/interactive-diagrams.spec.ts --grep 'real vision'` explicitly makes paid model calls on a newly authored disposable slide/course, exercises real generation controls, lecturer approval and mobile archive, then removes only its exact fixture course. All other pytest/Vitest tests mock providers only inside tests.

## Trace semantic-search fallback failures

Use the existing rotated API container logs:

```sh
docker compose logs --timestamps --since 1h api | rg semantic_search_failed
```

Each event is one JSON record with `search_id`, internal `course_id`, `mode`, failure `stage`, configured model names, error type/category, timing/budget, candidate count and source-free stack locations. A secondary keyword-fallback failure shares the same search ID. Categories distinguish provider HTTP/connection failures, timeouts, schema validation, source-ID coverage, embedding configuration, database and unexpected errors. HTTP failures include `http_status` and a sanitized `provider_request_id` when the provider supplied `x-request-id`; coverage errors include counts instead of source IDs. Schema failures include bounded validator types/known field locations with unknown field names masked. These metadata support investigation without logging questions, source text/titles, response bodies, raw exceptions, SQL parameters, embeddings or keys. Provider request-ID guidance: [OpenAI API reference](https://developers.openai.com/api/reference/python).

These records use Compose's existing `json-file` rotation (10 MB × 3 files per service), not a new database or telemetry service. Collect the logs before recreating the API container; Docker log retention covers restarts/rotation, not removed containers. The browser keeps the ordinary warning and posting/retry controls. The confidence warning is generated only when every candidate in a nonempty assessment is uncertain.

## Optional noncommercial BSL avatar experiment

See [exact BSL setup and rollback](BSL_AVATAR.md). `docker compose -f compose.yaml -f compose.bsl.yaml up --build -d` adds a pinned/checksummed private Kozha dependency on the same VM, with no public port or runtime egress. Use both files for later updates. Base-only installs default disabled and remain functional. No migration, new credentials or external translator is required; original live STT still uses its normal backend provider. Caddy forwards the BSL assets' dedicated legacy-engine CSP only for `/api/v1/sessions/{UUID}/bsl/assets/*`, leaving main-app and generated-diagram policies intact. Preserve authenticated HEAD/range proxy support for avatar archives. Noncommercial DictaSign and unchanged-engine CWASA notices ship in the panel. This is not a validated interpreter replacement; actual test evidence and limitations are in BSL_AVATAR.md / PROGRESS.md.
