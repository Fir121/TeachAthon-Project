# LectureLoop — Future TODOs & Product Roadmap

> **Purpose:** Living backlog of product enhancements intentionally deferred beyond the TeachAthon MVP. This is **not** a list of unfinished MVP features and does not claim that anything has already been implemented.
>
> **Source of truth:** `docs/PRODUCT.md`, `docs/DECISIONS.md`, and the owner's answered questionnaires govern the current MVP. Track incomplete committed functionality and bugs in `docs/PROGRESS.md` instead.
>
> **Codex instructions:** Do not implement items from this file until the owner explicitly promotes them into scope. Preserve the core principle: *LectureLoop strengthens human classroom interaction; it must not become a generic AI chatbot.* Update this backlog when an item is discussed, approved, implemented, or dropped.

**Status key:** `[ ]` Not started · `[x]` Complete · `Proposed` means design details remain open. Priorities here reflect a suggested **post-MVP** order, not competition requirements.

## P1 — High-value next features

### 1. AI-enhanced interactive slides and diagrams — promoted and implemented 2026-10-23
- [x] Explicit optional preparation analyses all slides in bounded actual-image batches, with zero-or-more suggestions and no target count.
- [x] Manual generation on any slide, on-demand suggestion generation, private preview/refinement and lecturer approval.
- [x] Genuine concept-specific HTML/CSS/JavaScript interactions through an authenticated opaque sandbox and dedicated renderer CSP.
- [x] Optional current-slide student experience, unchanged projection and independent local state.
- [x] Same approved experience on historical replay slides, including slide-timeline navigation without audio.
- [x] Immutable publication at lecture start, source-pixel mismatch protection, revision/deduplication/permissions tests and real browser/provider verification.

Implementation: `apps/api/app/diagrams.py`, `apps/api/app/ai/diagrams.py`, `apps/web/src/InteractiveDiagrams.tsx`. Tests: `apps/api/tests/test_diagrams.py`, `apps/web/e2e/interactive-diagrams.spec.ts`. See AI_WORKFLOW.md §14 and PROGRESS.md for verified scope and remaining browser/quality limitations. This item is no longer deferred; no commit identifier is fabricated.

### 2. Concept checks and end-of-lecture comprehension
- [ ] Let lecturers create or approve topic-linked questions while preparing/reviewing a lecture outline.
- [ ] Optionally send concept questions alongside an understanding poll.
- [ ] If planned checks were not issued live, offer a combined end-of-lecture check.
- [ ] Auto-mark conventional MCQs; for free-text questions, allow lecturer-provided marking guidance and clearly labelled, low-stakes LLM-assisted checking.
- [ ] Show results to student and lecturer without treating them as authoritative grades.
- [ ] Keep confidence ratings distinct from demonstrated comprehension.

**Why:** Complements the live confusion feedback loop; explicitly deferred from the MVP.

### 3. General screen-aware teaching
- [ ] Support browser screen/window sharing as an alternative to presenting inside LectureLoop.
- [ ] Detect meaningful visual changes and use OCR/vision analysis where necessary.
- [ ] Combine screen evidence with microphone transcripts and optional lecture outline to maintain topic awareness.
- [ ] Recognise live coding, websites, demonstrations, and content that is not part of an uploaded deck.
- [ ] Preserve the **share screen + mic + teach normally** experience, with built-in presentation as a reliable alternative.
- [ ] Minimise transmitted screenshots, protect unrelated on-screen information, and provide clear capture permissions/status.

**Why:** Restores the original low-friction ambition beyond slide-dependent teaching.

### 4. Student-created draft course spaces
- [ ] Allow students to create private, independent draft course spaces without waiting for a lecturer to adopt LectureLoop.
- [ ] Let students upload and search their own resources using course-grounded retrieval (not general chatbot answers).
- [ ] Exclude live lecturer/classroom functionality from these draft spaces.
- [ ] Decide whether/how a draft may later be handed over to an official lecturer-managed course, including ownership and permissions.

**Why:** Lets students obtain value before faculty adoption; explicitly suggested during product discovery.

## P2 — Broader product enhancements

### 5. Accessibility and language
- [ ] Offer live caption translation and multilingual transcript views.
- [ ] Support multilingual interface copy and appropriately scoped translations of course materials.
- [ ] Explore integration with **qualified human sign-language interpretation** and validated signing technologies; do not treat unvalidated AI avatars as a replacement.
- [ ] Improve accessible descriptions of complex diagrams and interactive visualisations.

**Already in MVP scope:** keyboard-accessible UI, student-facing live captions, retained/searchable transcripts, and timestamped transcript playback. Do **not** move those into this backlog.

### 6. Richer recording and presentation capabilities
- [ ] Optionally capture full screen video (with appropriate consent) for coding demonstrations, videos, animations, and other non-static visual teaching.
- [ ] Support external PowerPoint/presentation workflows and synchronisation rather than requiring the built-in presenter.
- [ ] Explore preserving PowerPoint builds, transitions, embedded media, and speaker notes where feasible.
- [ ] Add optional presenter utilities such as a laser pointer, timer, and notes view.
- [ ] Optionally export standalone, permission-checked audio/video explanation clips from existing recording timestamps.

**Already in MVP scope:** microphone audio recording, static PDF/PPTX presentation, annotations, slide-event timeline, and synchronized audio/slide replay.

### 7. Personalised revision and study assistance
- [ ] Generate optional lecture summaries and revision notes from permitted materials.
- [ ] Offer flashcards and self-tests linked to real course sources.
- [ ] Explore personalised revision suggestions based on opt-in activity and concept-check results.
- [ ] Consider useful student bookmarks/saved explanations if demand is demonstrated.
- [ ] Keep these experiences constrained to course knowledge, with sources visible; do not add an unrestricted multi-turn tutor by default.

### 8. Integrations and institutional deployment
- [ ] Integrate with university LMS platforms and existing learning systems, subject to provider/University approvals.
- [ ] Explore EdStem import/synchronisation beyond the MVP's generic TXT/JSON resource ingestion.
- [ ] Add university SSO, institutional lecturer verification, and optional institutional administration features if a pilot requires them.
- [ ] Explore calendar/session scheduling and course enrolment synchronisation.
- [ ] Document operational/privacy requirements for a genuine university pilot rather than assuming a hackathon deployment is institutionally approved.

### 9. Classroom and course insights
- [ ] Expand historical understanding trends, poll participation summaries, recurring misconceptions, and unanswered-question analytics.
- [ ] Explore optional AI sorting of lecturer queues using teaching context and question upvotes.
- [ ] Add configurable lecturer summaries of common free-text feedback, with original submissions inspectable where permitted.
- [ ] Do not equate nonparticipation with lack of understanding or produce unjustified individual learning judgements.

### 10. Notifications, export, and optional quality feedback
- [ ] Add optional persistent notifications, browser push, or email for resolved questions and course events if there is demand.
- [ ] Allow a simple thumbs-down/report on inaccurate AI-matched source suggestions and route reports to lecturers.
- [ ] Consider aggregated, privacy-aware retrieval feedback for future improvements; do not automatically treat votes as ground truth.
- [ ] Explore export of recordings, transcripts, and Q&A where permission and copyright allow.

**Already in MVP scope:** simple in-browser question notifications and lecturer ability to remove wrong matches.

## P3 — Research / explore only after the product proves itself

- [ ] Multimodal retrieval from recordings using audio, transcripts, video frames, diagrams, and slide context together.
- [ ] More reliable recognition of **when** verbal lecturer explanations actually answer queued questions, without requiring a start/stop-answer button.
- [ ] Automatic analysis of recurring misconceptions and adaptive timing of polls, with careful validation and lecturer control.
- [ ] More open-ended AI-generated educational simulations where accuracy, security, and accessibility can be evaluated.
- [ ] Better support for low-resource, self-hosted LLM/embedding/transcription providers; retain swappable adapters now, but do not build a local inference stack merely for the MVP.

## Deliberately **not** on the active roadmap

- Unrestricted AI chat or a general-purpose ChatGPT replacement.
- Automated assignment completion, full grading, or a general LMS/gradebook replacement.
- High-stakes AI assessment without human oversight.
- Treating uploaded material as proof that every quoted statement is a verified lecturer response.
- A separate answer-versioning/retraction feature as a v1 requirement; the owner explicitly asked not to prioritise this.

## Backlog maintenance rules

1. **Do not confuse future scope with MVP defects.** Missing or broken promised MVP functions go into `docs/PROGRESS.md`, with severity and evidence.
2. Keep each future item unimplemented until the project owner authorises it. Avoid accidental scope expansion by Codex.
3. Before starting an item, write its acceptance criteria, privacy implications, dependencies, and any new architectural decisions.
4. If an item is built, mark `[x]`, link to the relevant commit/PR and tests, and update product/architecture documents.
5. Keep the human-first, course-scoped retrieval and lecturer-control principles intact throughout future iterations.

**Last updated:** 2026-10-23 · **Owner review:** Pending
