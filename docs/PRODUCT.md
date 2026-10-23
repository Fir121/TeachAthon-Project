# Product and acceptance requirements

## North star
LectureLoop is a **human-centred live classroom and persistent course discussion platform**. It closes the loop among student confusion, teacher intervention and reusable human teaching knowledge. It is not a standalone AI tutor, auto-answer bot or LMS.

## Actors and capabilities
**Lecturer:** self-register/login, manage owned/shared courses, approve enrolled students, invite student/lecturer, build nested files, upload & index course materials, create lecture with deck, optionally review AI outline, start session, present deck with annotation, microphone recording/transcript, monitor polls and questions, moderate/answer/merge/split, manage forum, review/play historical lecture and retrieval references.

**Student:** self-register/login, discover/request/enrol course, join active lecture by QR/code/link after authorization, mobile-first companion that follows current slide, show/hide captions, answer current poll and optionally add text question/feedback, submit named, course-public questions with preflight retrieval, upvote public question, read updates, use post-lecture forum, search lecture archives / transcript, play audio with synchronised slide.

## Student question flow
1. Student composes a named question visible to course members; no anonymity/visibility selectors.
2. Submits to **preflight** endpoint; display spinner and matched existing source answers & existing public questions. Never expose lecturer-only/private questions or private written answers.
3. Post question runs retrieval first. A complete warning-free search with no matches posts automatically and shows a confirmation banner; matches require opening/upvoting or explicit continuation. Failed/degraded retrieval always requires explicit Post anyway.
4. New discussion enters the public course feed and lecturer queue. Feedback-derived questions and historical private questions stay lecturer-only. Lecturer view groups similar public and private content while clearly marking confidentiality; public student view is an ordinary question feed, never the private-aware grouping representation.
5. Lecturer may mark one question or cluster resolved; grouped members also update. A recorded verbal explanation is optional; after class, a job matches suitable transcript/audio excerpt. An inaccurate excerpt is removable. Replies inherit their thread’s visibility. Only authors can edit wording; lecturers can delete and moderate.
6. If source search fails or exceeds its configured budget (20 seconds retrieval plus up to 10 seconds optional generation), show retry plus 'Post anyway' (fault tolerance exception to required preflight).
7. Private typed answers stay private. Public class audio explanations may be shared as general course content without revealing a private question.

## Student feedback flow
- At most one active understanding poll per session. Default 4 labels; open by AI topic-change policy or lecturer. Responses anonymous to other students, aggregate in lecturer dashboard. One latest response per registered student and poll. Student changes replace their vote; previous version need not be retained.
- Free-text notes identify the sender to lecturers and remain lecturer-only, including inferred questions. Historical anonymous feedback retains no author. Free text added to a confusion response is classified as `question` or `feedback` and then handled accordingly. Soft rewrite is visible with 'AI edited'; teacher can read raw; don't alter user originals in storage. When classifier fails, preserve raw message and let lecturer view/route it.
- Lecturer closes poll; next automatically opened poll will supersede previous if necessary while preserving aggregates and per-student latest votes in DB. Polls visible history within dashboard. Configured cadence/modes per course before lecture start: auto/cooldown, suggested, manual, end-only; exact available modes can be implemented as simple initial controls.
- Optional future concept quizzes, end checks and analytics separate from four-button understanding.

## Live lecture
- Lecturer must select processed slide deck to start. Present slides using clean fullscreen/projection interface and optional dashboard sidebar or separate instructor page; listen to keyboard next/prev, don't lose synchronisation across tabs. Annotations saved with slide and timestamp during session.
- Start mic with explicit browser permission. Recording requires clear consent indicator. PCM stream drives live STT; audio recording retained when enabled in lecturer course's authorized area. Live captions are an optional student panel. Lecturer can pause mic/transcription AI and disable auto-poll while retaining slide/Q&A functionality.
- At most one lecture is live per course; conflicts link to the existing lecture without ending it. Different courses can run concurrently. Session can't restart after it ends; produce transcript, audio + slide change timeline, optionally merged media. Session questions stay in course forum (public/private rules upheld). Archived lecture is browseable immediately; indexing may remain processing.

## Course workspace
- Lecturer-owned and lecturer-shared; multi-lecturer equals perms. Course directory with nested folders, drag/drop upload, rename/move/delete, status, reprocess and indexing exclusion at course resource level. Uploads automatically indexed; file failures surfaced with retriable operation.
- PDF/PPT/PPTX/DOC/DOCX/MP3/MP4/TXT/JSON import. PPT and doc convert to PDF or extracted text (static slides no complex animation guarantee); ffmpeg extracts audio from MP4; segmented transcripts indexed. Large files processed asynchronously, playable as soon as source available.
- Forums: course-level posts, follow-up replies/comments, voting where applicable, new posts/replies named and course-public; private legacy/feedback threads retain protection. Only authors can edit; lecturers can remove/resolve. General course search reaches permitted source documents, public discussions, and recording transcript passages with time links. AI suggestions precede creating new forum post.

## Nonfunctional minimum
- Proper authz on every resource, forum thread, media endpoint and websocket; course isolation even for vector retrieval; processing failure visible; no fake status. Responsive/mobile-first student. Accessible forms/labels, keyboard navigation, contrast, reasonable touch targets. Persistent VM volumes; HTTPS for microphone permission; sensible upload limits and ingress controls.
- Avoid storing student identity for anonymous question authors; lecturer never sees identity. Named authors can modify/delete own questions; only lecturer can moderate anonymous.
- Access to audio recording, captions/transcripts and previously submitted resources limited by course membership; consent notices before recording. External copyrighted material only with rights/attribution.

## Out of scope for initial version
Multi-turn AI chat, general independent tutoring, direct unrestricted AI answers, grade books, assignment workflow, sign-language avatar, video screen recording, external screen analysis, local LLM deployment itself, personalization and adaptive quizzes, browser push/email, slide animations preservation, student draft courses.
