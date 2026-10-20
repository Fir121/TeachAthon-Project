# Architecture, deployment and repository structure

## Topology (all application services on one VM)
```
HTTPS browser -- Caddy :443 -- / -> React SPA static build
                            -- /api/* -> FastAPI :8000
                            -- /ws/*  -> FastAPI :8000 WebSocket
FastAPI <-> PostgreSQL (+pgvector), file/media volume
Worker <-> PostgreSQL (jobs), file/media volume, ffmpeg/LibreOffice, external AI adapters
FastAPI <-> External AI services (OpenAI initial; future provider replacements)
```
One VM, docker compose services: `proxy`, `web` (static build served by Caddy), `api`, `worker`, `db`. For simplicity Caddy may serve the compiled frontend directly without a separate `web` runtime. Persistent volumes for DB and application media; don't expose DB publicly. One process per backend container, one worker with durable database-backed jobs. No Redis/Kafka/Kubernetes initially.

## Core flow and event discipline
- REST for state-changing commands and snapshots; WebSocket for broadcast (slide changed, poll opened/closed, question added/updated, feedback aggregate changed, transcript delta, topic changed, processing status). Never use websocket messages as only source of persisted changes. Use monotonic session event sequence, snapshot reconciliation and reconnect.
- Lecturer browser runs slide viewer and records mic. Send actual mic audio to a backend adapter for transcription (backend OpenAI credentials only). Send independently compressed durable audio chunks to authenticated media upload endpoint; worker assembles/re-encodes on end. Preserve slide change offsets, annotations, transcript offsets and recording chunk offsets in a common session-relative time base.
- Background worker polls `processing_jobs` using `SELECT ... FOR UPDATE SKIP LOCKED`, heartbeat/lease fields and retry count; types include `ingest_document`, `transcribe_media`, `index_chunks`, `generate_outline`, `match_answer_excerpt`, `assemble_recording`, `postprocess_live_transcript`. Worker and API use same Python package.
- RAG result always has grounded `source_id`, `source_type`, source location/recording offsets, short matching excerpt, search score and, where applicable, `suggested_match` label; no generated statement presented as recorded speech.
- Permissions never inferred from UI state. Server filters by `course_id`, course membership and source visibility. Do not allow cross-course query vectors or leaked counts.

## Repository tree (recommended exact starter convention)
```
/
  AGENTS.md
  README.md
  CODEX_START_PROMPT.md
  .env.example                   # Codex creates from documented keys
  compose.yaml                   # Codex creates
  infra/
    Caddyfile
    Dockerfile.api
    Dockerfile.web
  apps/
    web/
      package.json
      vite.config.ts
      src/
        app/                     # router, providers, auth bootstrap
        api/                     # generated/typed HTTP and WS client
        components/ui/           # shared design primitives
        features/
          auth/
          courses/
          resources/
          presenter/
          live-student/
          live-lecturer/
          questions/
          polls/
          forum/
          recordings/
          search/
        stores/                  # ephemeral Zustand state
        styles/
        tests/
    api/
      pyproject.toml
      alembic/
      app/
        main.py
        config.py
        db.py
        core/                    # auth, permissions, errors, media storage
        models/                  # SQLAlchemy entities
        schemas/                 # Pydantic request/response
        api/routers/             # REST and WS endpoints
        services/                # domain orchestration
        ai/                      # text/embedding/STT adapters, retrieval, context
        jobs/                    # worker and job handlers
        media/                   # document conversion/audio pipeline
      tests/
  docs/
    PRODUCT.md
    DECISIONS.md
    ARCHITECTURE.md
    DATA_MODEL.md
    API.md
    AI_MEDIA.md
    UI.md
    IMPLEMENTATION.md
    PROGRESS.md                 # generated/updated by Codex
```
Organize backend by clear domain module and shared models rather than elaborate DDD. Frontend by features. Prefer typed APIs from OpenAPI when straightforward, else manually typed shared responses from Pydantic schemas. E2E Playwright tests for critical classroom flows.

## Security and lifecycle
- Password hashes via Argon2, session auth with secure HTTP-only cookies and CSRF protections or robust bearer auth; consistent choice in implementation.
- Explicit lecturer vs student membership, server checks for every course and media operation; limits on upload size/type; path traversal and HTML sanitisation; no public raw media directories; MIME sniffing; bounded AI inputs.
- Raw audio chunk integrity checked and assembled in chronological order. If upload fails, display actionable state and retry. Recover from processing/AI failures without losing slides, polls or posted questions.
- Keep sensitive environment keys on VM only, `.env.example` documents them. VM backups for DB and media and log rotation; avoid logging transcripts/private question bodies in reverse proxy or error tracing.
