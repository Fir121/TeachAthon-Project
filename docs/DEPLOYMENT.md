# Run and operate LectureLoop

## Local use
Requires Docker with Compose, with about 4 GB RAM available and disk for media. Docker builds install LibreOffice and FFmpeg; the host does not need them.

```sh
python3 scripts/configure.py
docker compose up --build -d
docker compose ps
```

Open http://localhost:8080. Create a lecturer account, create a course, upload a PDF/PPTX under Resources, wait for actual conversion, create a lecture using the prepared deck, and start it. Create a student account in another browser/profile. Enrol by invitation, request+approval, or lecturer-add. The join code/link requires course membership.

For AI features set `OPENAI_API_KEY` in ignored `.env`, then `docker compose up -d --force-recreate api worker`. Never put it in a frontend Vite variable. All model IDs and provider base URL are externalized. `gpt-live-transcribe` uses server WebSocket PCM24k with manual five-second commits; `gpt-transcribe` processes 30-second file windows. Transcript offsets locate input windows, not individual words. Microphone permission, TLS, network and provider errors are surfaced; slides, questions and manual polls remain functional.

Optional generated answers are OFF by default. Semantic indexing without a key uses genuine text extraction and keyword/full-text search; no embeddings are invented. Configure the key and choose Retry search indexing on a resource to add real embeddings. Changing model/dimension after schema creation is rejected; use a deliberate migration, clear old vectors and reindex rather than mixing embedding spaces. Initial supported dimension range is 1–2000 for HNSW.

API docs: `/api/docs` (Swagger UI needs its external JS assets; use `/api/openapi.json` if a restrictive network blocks the UI). Authenticated media URLs support HTTP Range for recording playback. Resources are served with attachment disposition; no public raw media directory exists.

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

Document conversion and indexing have separate visible states. Failed conversion has Retry processing; failed/missing embeddings have Retry search indexing. Jobs claim rows with SKIP LOCKED, retry three times with backoff, and recover processing leases after 15 minutes. Worker runs jobs sequentially. Process long recordings in bounded windows. User originals remain available during processing failures. Resource removal and indexing exclusion immediately filter search through current metadata even before cleanup.

Upload limit: 100 MB per file, ingress limit 105 MB including multipart overhead; 500 rendered pages; archive recordings use 4-second browser chunks, max 5 MB each. Check disk with `docker system df` and `df -h`; alert before storage fills. Original media chunks are retained for recovery, so monitor volume growth. Deleted metadata is inaccessible through the API; orphan file garbage collection is not automatic. Review retained file directories during a maintenance window against database storage keys before removal. Do not prune volumes as a cleanup shortcut.

## Backups and recovery

Run `./scripts/backup.sh /secure/backups/lectureloop-YYYYMMDD`. It quiesces API/worker for the snapshot, saves a Postgres custom dump and private media tarball, and restarts services on exit. Backups include transcripts, course documents, anonymous question text and the private preflight signing key. Restrict access, encrypt off-host copies and test restore regularly. Back up `.env` separately using a secret manager. Caddy can reacquire certificates, but its volumes may also be backed up.

To restore into an empty deployment: start only db (`docker compose up -d db`), wait for health, then `docker compose exec -T db pg_restore -U lectureloop -d lectureloop --clean --if-exists < database.dump`. Restore media with `docker compose run --rm --no-deps -T --user root api tar -C /media -xzf - < media.tar.gz`, then `docker compose run --rm --no-deps --user root api chown -R lectureloop:lectureloop /media`. Run `docker compose up -d` to apply any newer migrations and start services. Restore commands replace database contents: execute only against the intended empty/recovery deployment. Verify membership and an archived recording before reopening access.

## Development and checks

```sh
uv sync --project apps/api
npm ci --prefix apps/web
apps/api/.venv/bin/python -m pytest apps/api/tests -q
npm --prefix apps/web run build
npm --prefix apps/web test
# Running Compose required; browser install once:
cd apps/web && npx playwright install chromium && npm run test:e2e
```

`docker compose exec -T api python -m pytest -q -p no:cacheprovider` includes actual FFmpeg tests that skip on hosts without FFmpeg. Unit tests disable real provider calls. `scripts/smoke.py` creates unique synthetic course content in the running stack. Playwright creates isolated accounts, uses a disclosed synthetic microphone test device and validates actual browser encoding, uploads, assembly and playback. `RUN_OPENAI_SMOKE=1` and the documented provider smoke script separately exercise paid model APIs. No canned AI responses are used in application code. No licensed third-party lecture demo has been collected; M7 is optional after the working core.

To rerun paid provider/domain checks with an authorized short test recording, copy a 24 kHz PCM16 WAV into the API container and run `docker compose exec -e RUN_OPENAI_SMOKE=1 api python -m app.provider_smoke /tmp/speech.wav`. To exercise extraction, optional summaries, private/public semantic grouping and MP3 ingestion through actual REST routes, run `RUN_OPENAI_SMOKE=1 apps/api/.venv/bin/python scripts/integration_smoke.py /path/to/authorized-generated-speech.mp3`. Those checks create clearly named synthetic fixture accounts/courses; the fixture course is removed afterward. No real key is printed.

For the full browser speech gate, set `LIVE_AUDIO_FIXTURE=/absolute/path/to/authorized-speech.wav npm --prefix apps/web run test:e2e`. Chromium uses that file as its disclosed test microphone input; actual application recording and provider calls remain in use. Without it the recording test uses a synthetic device tone and does not claim speech accuracy. Existing account courses are not used as test fixtures.

Additional browser-engine smoke: install WebKit with `cd apps/web && npx playwright install webkit`, then from the repository root run `E2E_BROWSER=webkit npm --prefix apps/web run test:e2e -- --grep 'lecturer and mobile'`. This covers the classroom flow in the WebKit engine; physical Safari/iOS microphone hardware is a separate manual check.

Earlier validation runs left courses clearly named `Smoke course …`, `Browser course …` and `Recording …`. They contain actual persisted synthetic test activity and generated speech, not application seed data or fabricated provider output. New tests remove their exact freshly created course IDs. Historical cleanup by pattern was rejected by automatic approval review, so those earlier records remain intact; do not delete arbitrary courses based on labels alone.
