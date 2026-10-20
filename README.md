# LectureLoop — Codex starter specification

**Purpose:** This folder is the authoritative starting contract for building the working TeachAthon 2026 MVP from scratch.

**Read first:** `AGENTS.md`, `docs/PRODUCT.md`, `docs/DECISIONS.md`, `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, `docs/API.md`, `docs/AI_MEDIA.md`, `docs/UI.md`, and `docs/IMPLEMENTATION.md`.

**Codex kickoff:** use `CODEX_START_PROMPT.md` as the opening instruction after placing this folder at the root of a new repository. Do not confuse this specifications-only bundle with a completed application.

## Goals
- An actual usable web app, not a clickable mockup, on **one Linux VM via Docker Compose**, with locally persistent media and database.
- All core features integrated end-to-end; prioritize functional vertical slices over polishing disconnected screens.
- Single implementation agent; do not spawn or assume parallel developer teams.
- One course's documents, live lectures, audio/transcript and forum feed **the same course-limited retrieval system**.

## Delivery conventions
- Make a working, tested commit-sized increment at each milestone in `docs/IMPLEMENTATION.md`.
- Record architectural exceptions and trade-offs in `docs/DECISIONS.md` as the project evolves.
- Never invent success status for uploads, transcription, indexing, retrieval or AI operations.
- Real integrations when credentials are configured; transparent error/retry states when not.

## Setup after Codex generates source
The implementation is expected to provide `.env.example`, a usable `docker compose up --build -d`, migrations, and a documented lecturer/student onboarding flow. `.env` and media are private and must not be committed.

## Run the application

```sh
python3 scripts/configure.py
docker compose up --build -d
```

Open **http://localhost:8080**. Register a lecturer, create a course, upload a PDF/PowerPoint in Resources, wait for conversion, create a lecture with that deck, and start. Use a second browser/profile for a student; enrol via request, invitation, or lecturer-add. Lecturer controls and projection have separate views. Microphone capture is explicit; recording consent is selected before start.

Set `OPENAI_API_KEY` in private `.env` and recreate API/worker for real captions, semantic search and topic intelligence. All AI adapters are server-side; questions and manual polls work during provider failure. Generated answers are OFF by default.

See [deployment, checks and backups](docs/DEPLOYMENT.md) and [actual milestone evidence](docs/PROGRESS.md). API contract: http://localhost:8080/api/openapi.json . The implementation currently targets local Compose; the owner deferred VM deployment until a VM is ready.

AI implementation and owner review spaces: [AI workflow review](docs/AI_WORKFLOW_REVIEW.md), including PDF extraction/indexing/display, provider inputs, storage, privacy, automatic decisions and known limitations.
