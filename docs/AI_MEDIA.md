# AI, ingest, transcription, retrieval and recording implementation

## AI abstraction boundaries
Define provider contracts under `apps/api/app/ai/providers/` for:
- `TextModel.structured(prompt, schema)` -> validated Pydantic JSON for topic classification, question equivalence / clustering, feedback classifier, concise source-based optional answer, excerpt selection.
- `VisionModel.structured_images(prompt, local_image_data_urls, schema)` -> validated opportunity/artifact output for explicit optional interactive-diagram preparation; bounded actual slide images, separate env-configured model, private revision + human approval lifecycle. See AI_WORKFLOW.md §14.
- `EmbeddingProvider.embed(texts)` -> embeddings + model ID/dimension.
- `LiveTranscriber.start_session(...), send_audio(...), receive_events(...), close(...)` -> partial/final transcript events.
- `BatchTranscriber.transcribe(audio_file|chunks)` -> timestamped segments or mapped relative offsets.

Initial provider is OpenAI. Model names **all in env**, e.g. `OPENAI_TEXT_MODEL`, `OPENAI_EMBED_MODEL`, `OPENAI_LIVE_STT_MODEL=gpt-live-transcribe`, `OPENAI_BATCH_STT_MODEL=gpt-transcribe`, `OPENAI_API_KEY`. A local-compatible provider may be plugged into adapters later; don't build a local inference server now.

Use up-to-date OpenAI API docs at implementation time. Realtime transcription guide: https://developers.openai.com/api/docs/guides/realtime-transcription ; file transcription guide: https://developers.openai.com/api/docs/guides/speech-to-text . Current gpt-live-transcribe sessions use PCM 24 kHz streaming, manual input audio turn commit (model does not support server VAD); client-side VAD/controlled commits, item_id-based ordering. Do not assume word-level offsets from a model without checking its output contract.

## Resource ingestion

The confirmed PaddleOCR/semchunk/source-link plan supersedes older extraction and result-display defaults. See [AI_WORKFLOW.md](AI_WORKFLOW.md) for the maintained actual behaviour, including models, storage and limitations.
1. Validate file type, size and per-course lecturer permission. Persist original to private volume, metadata and queued job immediately.
2. PDF via PaddleOCR PP-StructureV3 + Poppler, PDF slides rendered and text extracted. PPT/PPTX -> static PDF using LibreOffice headless in worker; DOC/DOCX -> extracted text, optionally converted preview PDF. TXT/JSON -> validated text (JSON Q&A import with documented assumed fields); no arbitrary remote URLs.
3. MP3/MP4 -> ffmpeg extracts audio to compressed storage + analysis-sized chunks, run file STT per chunk; maintain exact chunk start offsets even if transcript model lacks utterance timestamps. Retain original playable media; MP4 can be played for historical uploads, even though live captures audio only.
4. Split locally with semchunk, cached cl100k_base, maximum 512 tokens and 64-token overlap, with character offsets. Preserve paragraph separators, physical document pages and original transcript/forum locators. TXT/JSON have no artificial page numbers. Index text internally with course/source IDs, versions, embeddings and PostgreSQL full-text search.
5. Surface processing status queued/processing/ready/failed; retry failed jobs. As soon as source is stored, media/document access works even if indexing pending. On disable/remove, ensure search filter excludes resource, with background embedding cleanup.

## Retrieval before posting
- Mandatory `preflight` call on question text, server enforced by short-lived opaque proof per submission or equivalent; failures allow explicit post-anyway fallback. Do not wait forever. Query candidate source chunks only in course and permitted visibility. Use **hybrid ranking** (keyword+pgvector) and an LLM rerank/classify step only for relevant top results when helpful.
- Return grouped document/recording/discussion source links and deduplicated page/time locations; no chunk excerpts. Rank by best qualifying hit and limit to eight source groups after grouping. Link to audio times and slides. Never turn 'material mentions topic' into 'lecturer answered this precise question'.
- If lecturer setting enables short generated answers, generate only grounded short text with explicit citations; otherwise never present an invented prose answer. No multi-turn AI conversations.
- Student may view results and still submit. Public pending similar question can be upvoted; if submitting anyway, backend groups for lecturers asynchronously. Even private student questions are matched against safe course sources, but never offered matches revealing other private questions or private written replies.
- Relevance confidence must use calibrated thresholds/tests and honest labeling. E.g. no matched answer is better than unrelated timestamp.

## Question grouping and teacher suggestions
- Embedding nearest-neighbor shortlist across questions of course; optional LLM strict-equivalence check (same answer would satisfy both). Cluster public+private only in privileged lecturer domain; **never** expose private cluster membership/size to student API.
- A question answered by lecturer remains answered immediately. After lecture, `match_answer_excerpt` tries to locate best *actual spoken* explanation via hybrid search of recorded transcript + bounded adjacent window; generated excerpt with valid existing recording offset, stored as `suggested match`. If no credible excerpt, leave question answered and recording page link only, show 'No precise excerpt found yet'.
- If unmarked but transcript strongly appears to address an open question, AI may suggest `possibly addressed` to lecturer; **never auto-close**. Typed private lecturer answers remain private; general public lecture audio is course-searchable even if originally prompted by a private question.
- AI can classify/free-text reword (soft transformation, not hallucinated facts); originals immutable; presenter sees both; if model fails, feedback routed as written.

## Live topics and polling
- On slide change or periodic transcript updates, compute rolling context from current slide, optional outline, last N finalized transcript segments, prior topic. LLM structured output `{topic,subtopic,transition,new_checkpoint,brief_reason}`. Use stable state/hysteresis, topical minimum duration, configurable cooldown per course. Treat these as heuristics, not high-confidence ground truth.
- New poll only for meaningful checkpoint, respect course policy; one active poll at a time, supersede/archive previous when opening another. Lecturer retains manual opening/closing and the power to disable automatic polling. Return poll counts and latest vote aggregates; do not force intrusive modal on students.
- Slides and transcript often sufficient; no continuous screenshot vision in MVP.

## Live audio and recording
- Lecturer browser gets mic permission once (HTTPS), captures audio stream, routes PCM 24k 16-bit mono for live STT, and simultaneously `MediaRecorder` compressed chunks for durable recording. Implement robust codec detection and server-side FFmpeg conversion; avoid writing full raw uncompressed audio to DB.
- All offsets use `session_started_at` plus capture-relative monotonic times; track source buffer offsets, slides, transcripts, recording chunk indexes, annotations. Do not assume server wall-clock timestamps equal sample times, especially under network delay.
- `gpt-live-transcribe` handles partial and final segments; commit speech turns via client-side VAD or deterministic bounded chunks compatible with current API; dedupe/order events by item id. Broadcast partial text as captions and store final segments with appropriate offset mapping.
- Lecturer explicitly accepts recording with clear notice, can pause/disable it. When recording is off, live Q&A and manual slides/polls still work; record-dependent search/playback disabled and UI must say why. Show capture/transcription degradation clearly.
- After lecture: finalize chunks, assemble audio, preserve slide/annotation/timestamp event timeline, index final transcript chunks; searchable as processing progresses. A recording player reconstructs slide sequence from events and audio seek time; it must not invent playback of things not captured (e.g., video animations).
- For historical prerecorded recording imports, do not assume the original slides are synchronised. Audio/video and transcript timestamps work even without slide alignment. Optional manual timestamp-to-slide mapping for licensed replay demo later.

## Mandatory error paths
- OpenAI unavailable: record/preflight AI timeout, offer 'post anyway', allow manual polls and question interaction. No fabricated results.
- Microphone denied: continue lecture without AI context/captions/recording; clear warning.
- Corrupt upload: show failed state and retry; no 'ready' until processing succeeded.
- Short or ambiguous retrieved segment: show source as potentially relevant, not verified precise answer; lecturer can delete association.
- Version/media mismatch: show non-playable state rather than corrupt seek playback.

## Tests
- Tiny fixture transcripts and QA pairs with known expected matches/nonmatches and adversarial private/public cases.
- Timestamp arithmetic and seek across slide changes.
- Automatic poll cooldown, one-open invariant, teacher override and response upsert.
- Mock provider unit tests plus small live API smoke test that runs only with configured credentials.

Owner revision 2026-10-22: Post question runs mandatory retrieval; only complete warning-free empty results auto-post after that explicit submit action. Matches, degraded fallback and failures retain explicit confirmation. New questions/replies are named and course-public; notes store their sender for lecturers and inferred questions stay private with that attribution. Historical anonymity/privacy remains protected. See AI_WORKFLOW.md for current proof, retry and visibility details.
