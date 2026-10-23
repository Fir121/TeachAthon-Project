# LectureLoop — Codex starter specification

**Purpose:** This folder is the authoritative starting contract for building the working TeachAthon 2026 MVP from scratch.

**Read first:** `AGENTS.md`, `docs/PRODUCT.md`, `docs/DECISIONS.md`, `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, `docs/API.md`, `docs/AI_MEDIA.md`, `docs/UI.md`, and `docs/IMPLEMENTATION.md`.

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

### OCR models: `/opt/lectureloop/models`

This is a directory **inside the worker container**, containing the local PaddleOCR ONNX models used to extract text and reading order from slides and PDFs:

- `PP-OCRv5_mobile_det`: text detection.
- `PP-OCRv5_mobile_rec`: text recognition.
- `PP-DocLayout_plus-L`: page layout and reading order.

Each model directory contains `inference.onnx` and `inference.yml`; `revisions.json` records their pinned revisions. These are shared model assets, not course uploads or OpenAI models. Uploaded documents and extraction checkpoints live separately in the persistent `/media` volume.

**A new developer using Compose needs no separate model setup.** The `docker compose up --build -d` command above runs [model provisioning](apps/api/scripts/provision_ocr.py) while building the worker image. It downloads official PaddlePaddle artifacts from Hugging Face and verifies pinned revisions and SHA-256 checksums. The first uncached build needs internet access; subsequent builds reuse Docker's cached layers. Models remain in the image across container restarts. Local OCR requires no OpenAI key or runtime downloads. The local chunking tokenizer is provisioned separately at `/opt/lectureloop/tokenizer` during the image build.

Leave `OCR_MODEL_ROOT=/opt/lectureloop/models` unchanged for Compose; do not create that directory on your host. Running the worker directly outside Docker requires separately installing its system/OCR dependencies, running the provisioning script from `apps/api` with `OCR_MODEL_ROOT` set to a writable local directory, and using that same path at runtime. Setting the variable alone does not download models. See [OCR provisioning and sizing](docs/DEPLOYMENT.md#local-ocr-provisioning-backfill-and-sizing) for details.

See [deployment, checks and backups](docs/DEPLOYMENT.md) and [actual milestone evidence](docs/PROGRESS.md). API contract: http://localhost:8080/api/openapi.json . The implementation currently targets local Compose; the owner deferred VM deployment until a VM is ready.

Maintained AI implementation reference: [AI workflow documentation](docs/AI_WORKFLOW.md), including PDF extraction/indexing/display, provider inputs, storage, privacy, automatic decisions and known limitations.

Upload your profile picture from the avatar button. Lecturers can set course banners in Settings and lecture banners on lecture setup. Course Search accepts words (including single terms) and finds semantically relevant sources using embeddings and bounded model assessment. Keyword-only fallback is explicitly labelled when semantic processing is unavailable. Question preflight accepts full questions and requires explicit posting after incomplete/degraded checks. Lecture archives replay saved ink and clear events alongside audio.

Create lecture also accepts slide uploads directly, with conversion progress and automatic deck selection. One lecture can be live per course; conflicting starts link to the existing classroom. New questions/replies show the author’s name to course members. Post question checks sources first and posts automatically only when a successful check finds no matches; matches and search failures require confirmation. Feedback notes identify the sender to lecturers and stay lecturer-only. Authors edit their own words; lecturers can moderate/delete other posts. Historical private/anonymous content keeps its protections.

Move to discussions keeps a live question in the persistent forum rather than deleting it. Answered questions link to their lecture recording even when no precise excerpt is found. Poll notes send directly without source checks, and lecturers see the original feedback separately from any clarified private question.

Feedback processes the whole note in one model pass, keeping every request and the unchanged original. Grouping checks all members' teaching needs and leaves uncertain questions separate; existing automatic groups are rechecked before bulk answering. Outlines process all extracted slide sections with saved progress. A small opt-in real-provider quality check is available: `docker compose exec -e RUN_OPENAI_SMOKE=1 worker python -m app.quality_smoke`; it uses authored disposable fixtures against local PostgreSQL and removes its exact fixture course afterward.
