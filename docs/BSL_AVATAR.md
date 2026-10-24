# Experimental BSL signing avatar

Owner-promoted experiment, 2026-10-24. This is an opt-in **corpus-sign demonstration**, not validated BSL interpretation or an accessibility substitute for a qualified interpreter. Normal slides, captions, polls, questions and lecturer controls work independently.

## Run locally or on the existing VM

From the repository root, with the normal private `.env` configured:

```sh
docker compose -f compose.yaml -f compose.bsl.yaml up --build -d
```

Always include both files when updating an enabled installation. The override enables BSL on the API and builds `kozha` on the **same VM**. It publishes no port, joins an internal network shared only with the API, has no outbound route, runs unprivileged/read-only, and is limited to 1 CPU / 1 GiB. No OpenAI key, database connection, microphone, authoring API or third-party hosted translator is supplied to Kozha. Initial image provisioning needs GitHub, PyPI and UEA internet access. Runtime corpus rendering/planning works without internet; the existing live caption provider still needs its normal configuration.

The normal `docker compose up --build -d` remains valid and defaults `BSL_ENABLED=false`. To disable a previously enabled installation, recreate API/proxy with the base configuration and stop the optional service:

```sh
docker compose up --build -d api proxy
docker compose -f compose.yaml -f compose.bsl.yaml stop kozha
```

If `.env` explicitly sets `BSL_ENABLED=true`, set it false before the base-only recreation. Do not remove database/media volumes. Production still uses the existing HTTPS hostname and `COOKIE_SECURE=true`; no new public hostname, port or secret is needed. This change was tested locally, not on an external VM or physical phone.

Enrol a student, start a normal lecture, and open **BSL Avatar (Experimental)** below the slide/captions controls. Nothing loads or translates until the student opts in. Lecturer and projection views have no avatar. Controls: pause/resume, actual engine speed 0.5×/1×/2×, prepared script, close, retry after rendering failure. Caption text remains visible in the panel, including when the service is disabled or WebGL fails.

## Start with the standalone renderer

Open **Standalone corpus rendering test** from the student panel. Its authenticated URL is:

```text
/api/v1/sessions/{session-id}/bsl/assets/test.html
```

It runs independently of speech capture, classroom transport and the live planner. **Play prepared script** plays the following authored vocabulary cues, using exact existing corpus nodes:

| Displayed script cue | Actual corpus glosses |
| --- | --- |
| Today: school, teacher, student. | `today(n)#2`, `school(n)#1`, `teacher(n)#1`, `student(n)#1` |
| Read a book. | `read(v)#1`, `book(n)#1` |
| Ask a question. | `ask(v)#2`, `question(n)#3` |

These are corpus vocabulary sequences, not a linguistically reviewed sentence translation. The same script is available within the student panel under **Play prepared script**; the visible label clearly separates it from the lecturer's speech. It creates no caption/transcript records, audio, model-generated signs or fake successful translation state. Use it for a reliable rendering demonstration because unrestricted technical-lecture translation is unreliable.

## What was inspected and reused

- `AudioCapture.tsx` already captures/resamples PCM to 24 kHz and sends it through the authenticated lecturer audio WebSocket. `app/audio.py` maps committed provider item IDs onto captured input windows, saves `Transcript` once per item, and emits `transcript.final`. **No speech recognition pipeline or audio provider was added.**
- `useSessionSocket` already invalidates transcript queries for final events; reconnects fetch authoritative snapshots. The optional panel reads those persisted finals through the existing transcript API and refreshes a 12-caption tail every two seconds as transport recovery. Partial deltas only update captions and never enter signing plans. The existing full transcript response remains the default; `recent=1..32` requests a small ordered tail and responses now include the original `item_id`.
- Student and lecturer session membership is enforced by the existing `live`/`member` helpers. Backend accepts only a persisted caption UUID and stable part number, never arbitrary browser English, glosses, URLs or SiGML. Course/session identity is checked before any internal request and again after planning. Ended-session access permits real transcript replay; it does not restart a lecture.
- The architecture remains one VM with Compose, Caddy, API, worker and Postgres. Kozha is an optional local dependency, not a new public application service. Existing DB schema/migrations are unchanged.

## Kozha integration and provenance

Context7 had no Kozha entry; integration details were checked against the pinned repository and official CWASA documentation.

Pinned source: [zhan-a/Kozha](https://github.com/zhan-a/Kozha/tree/ce93d533b24740879df1e84cbb5341dfa575fc1f), revision `ce93d533b24740879df1e84cbb5341dfa575fc1f`. Archive SHA-256: `53953807b3b13650f9ff012a4b1ad9568ace06c867987cdd40b9a8db7501a448`. Provisioning happens at build time in `infra/bsl/provision.py`; only necessary planner sources, the BSL corpus and selected Anna avatar are packaged; unrelated corpora/authoring artifacts are excluded. Corpus and avatar binaries are not checked into this repository. Tested Python dependencies and English spaCy model URL/hash are in `infra/bsl/requirements.lock`.

The restricted `infra/bsl/bridge.py` imports Kozha's **unchanged `process_text(text, "en", "bsl")`**. Its full POS/lemmatisation model must load; the bridge refuses Kozha's blank-spaCy fallback. Kozha applies rule-based token selection, English-to-BSL word-order rules, stopwords, time/pronoun handling, abbreviation splitting and sentence deduplication. This is explicitly labelled an unvalidated experimental planner. There is no additional LLM pass and no claim that lexical processing establishes translation quality. This narrowly scoped owner-requested integration is an experimental exception to using semantic models for ordinary course meaning/relevance decisions.

The adapter maps returned tokens onto exact corpus glosses or existing concept aliases from Kozha's BSL CSV. It chooses the first available corpus variant for a concept; it has no reliable contextual sense disambiguation. Only the actual 881-entry `hamnosys_bsl_version1.sigml` corpus is rendered. If a planner token is missing, the **whole segment is skipped**, with an explicit missed/unsupported notice. Unsupported signs are never invented, silently omitted from an otherwise claimed complete translation, or fingerspelled. Even all tokens resolving only establishes corpus availability, not semantic completeness or fluent grammar: the upstream planner itself may discard words/duplicates or miss meaning.

`app/bsl_assets/panel.html` / `panel.js` adapt Kozha's existing iframe and `play_glosses` interface. Only original corpus `hns_sign` nodes are concatenated inside a `sigml` container; no gesture notation is authored or generated. Raw `play_sigml`, language-switching and fingerspelling interfaces are removed. **`allcsa.js`, CWASA CSS, avatar archives and configuration are not edited.** Native engine GUI controls supply suspension/resumption and speed; `sigmlloaded`, `animactive` and `animidle` hooks supply actual completion, replacing upstream's guessed per-sign delays. Readiness requires parsed nonempty corpus, initialized engine and a ready rendered avatar mesh. Missing assets, WebGL loss and watchdogs cause genuine failure/fallback.

Kozha's bundled CWASA directory omits `COMMON.jar`, `h2s.xsl` and the skin shaders. The provisioner additionally fetches those **unmodified** from the official [CWASA 2024 standard release](https://vhg.cmp.uea.ac.uk/tech/jas/vhg2024/); exact paths/SHA-256 values are checked in the provisioner. They are hosted internally at runtime. Avatar ZIP loading needs authenticated HEAD and byte-range requests; the API proxy preserves their lengths/range headers. This was verified with the real engine, not a mocked canvas.

## Security and resource limits

- Browser → same-origin `/api/v1/sessions/{sid}/bsl/*` → authenticated API → private `kozha:8000`. Caddy has **no** raw Kozha reverse proxy or `/translate` route. The internal bridge serves only health, planning, curated script and an explicit asset allowlist; authoring/transcription upstream endpoints are never mounted on the bridge.
- Caption plan inputs forbid extra fields. Planning is serial/coalesced with a 256-entry, five-minute in-memory cache keyed by session/caption/part/text hash, and 60 requests/minute per student (bounded 1,024-user rate map). Lock wait is at most six seconds, internal HTTP timeout five seconds; failures are sanitized and do not block ordinary teaching. API/bridge logs contain no transcript text or plan payload. Cache is ephemeral, not new retained translation history.
- Each frame has a fresh random viewer UUID. Both parent and wrapper validate exact origin, source window, protocol version, allowed message shape/type, instance and request ID. Child accepts at most 24 exact corpus glosses. Neither side uses wildcard target origins. Mode switches, retries, closing, session transitions and replay seeks invalidate old work/messages; pending browser fetches abort on teardown.
- The iframe executes **trusted, pinned** CWASA/wrapper code with scripts and same-origin access. It is not the opaque generated-diagram sandbox and is not a security boundary against its own trusted source. No arbitrary generated JS or user SiGML enters it. Its scoped CSP permits the legacy engine's eval/inline event attribute requirements and blob workers; network/assets stay same-origin, camera/mic are disabled. The main application's CSP remains unchanged. Caddy excludes only the BSL asset path and existing diagram renderer from the global conflicting policy. Do not add these permissions globally.
- Desktop/mobile panel remains in normal layout, with wrapping 44px controls. Closing unmounts the engine. Renderer CPU/memory and real mobile GPU performance are not guaranteed by iframe isolation.

## Segmentation, queue and replay

Final input windows are split deterministically at whitespace into at most 180-character stable parts (32 parts maximum per caption). Every part retains the **original** `start_ms`/`end_ms`; no word timings are invented. Translation happens only after finalization, so upstream transcription latency (normally five-second input commits), network delay and animation duration are additive.

Opening live mode establishes a baseline and follows subsequent final IDs, without playing historical speech on join. Caption UUIDs deduplicate repeated broadcasts and polling snapshots (bounded recent-ID memory). Up to **three pending segments plus one in flight** are allowed. Oldest overflow and queued/late-planning segments more than 15 seconds past their original input-window end are dropped and counted. Pause freezes actual signing and continues receiving bounded captions; speech can expire or overflow while paused. Signing has a 90-second active watchdog and rendering a 30-second readiness watchdog. UI shows queue length, observed lag and missed/unsupported segments. These counters cover observed segments, not an estimate of all words lost during long disconnection or speech recognition failure; unknown coverage is explicitly disclosed.

In the archive, the student panel uses actual saved caption windows at audio time, signs only during playback, pauses with audio and flushes pending/in-flight work when seeking. It does not synthesize missing content or promise word synchronization. Transcript-only archives can show captions and the prepared script, but have no fabricated audio-driven replay. A speed change controls animation independently of recording playback speed; queues/omissions remain visible.

## Known limitations and observed checks

Actual local planner checks: all three authored demo cues resolved to the exact corpus signs above. “Binary search halves the sorted interval.” was unsupported (`binary`, `halve`, `sorted`, `interval` missing). “The eigenvector is orthogonal.” was unsupported (`eigenvector`, `orthogonal` missing). Broad technical lectures will therefore often show captions only. Negation, classifiers, spatial reference, facial grammar, regional variants and intelligibility have not been validated by BSL users. This is not unrestricted fluent live translation.

Initial Chromium integration passed in **23.9 seconds**: standalone script fully completed with no JavaScript errors; real corpus/mesh rendering; final persisted-caption dispatch (**780 ms** in that run; **1,299 ms** in the prior run), actual animation completion; duplicate broadcast caused no second plan; queued pause/resume and 0.5× engine speed; 360px layout with no horizontal overflow; WebGL-loss teardown/captions fallback; renderer retry; lecture-end teardown; student archive access; lecturer command denial; raw `/api/translate` unavailable. Inputs for queue assertions were explicitly authored test-only persisted finals, not actual microphone speech. Expanded Chromium actual-microphone/provider/recorded-caption replay journey passed in **54.7 seconds**, with **8,385 ms** microphone-start-to-sign dispatch, including existing caption finalisation. Expanded WebKit BSL plus classroom/diagram journeys: **3 passed in 1.3 minutes**. Final trimmed-image Chromium BSL plus classroom/diagram journeys: **3 passed in 59.0 seconds**, including native animation pause/resume, unsupported skips, actual HEAD/206 ranges, scoped CSP and zero external browser requests. Full offline Linux backend **159 passed**, frontend **40 passed**. Detailed failures/corrections, final styling check and exact verification results are in [PROGRESS.md](PROGRESS.md).

Reproduce:

```sh
(cd apps/api && .venv/bin/python -m pytest tests/test_bsl.py -q)
npm --prefix apps/web test -- --run src/BslAvatar.test.tsx
(cd apps/web && RUN_BSL_E2E=1 npx playwright test e2e/bsl.spec.ts)
# Engine cross-check; physical Safari/iOS hardware remains a separate manual test:
(cd apps/web && RUN_BSL_E2E=1 E2E_BROWSER=webkit npx playwright test e2e/bsl.spec.ts)
```

Optional actual microphone/provider + recorded-caption replay extension uses an **original, authorized** speech WAV with the exact known-corpus script. It makes real paid calls only through the existing live transcription adapter:

```sh
# Example on macOS; generated speech is a disclosed test input, not a real lecturer.
say -v Daniel -r 110 -o /tmp/lectureloop-bsl-demo.aiff 'Read a book. Ask a question. Read a book. Ask a question.'
afconvert -f WAVE -d LEI16@24000 /tmp/lectureloop-bsl-demo.aiff /tmp/lectureloop-bsl-demo.wav
(cd apps/web && RUN_BSL_E2E=1 RUN_BSL_SPEECH=1 LIVE_AUDIO_FIXTURE=/tmp/lectureloop-bsl-demo.wav npx playwright test e2e/bsl.spec.ts)
```

## Attribution and licensing

The panel and standalone test link the shipped [full notices](../apps/api/app/bsl_assets/credits.txt). Preserve these in deployments and redistributions:

- Kozha: MIT, © 2026 Zhan Amankeldy and Bogdan Mironov. Wrapper changes are identified; the full MIT notice ships.
- CWASA: © UEA 2005–2026, Virtual Humans Group, University of East Anglia. Underlying engine/resources used unchanged under terms equivalent to CC BY-ND; upstream example pages have CC BY-SA terms. [Official conditions](https://vh.cmp.uea.ac.uk/index.php/CWASA_Conditions_of_Use), [release notes](https://vh.cmp.uea.ac.uk/index.php/CWASA_Release_Notes).
- DictaSign BSL: DictaSign consortium / IDGS, Universität Hamburg; **CC BY-NC-SA 3.0 Unported**. This is a noncommercial demonstration; commercial deployment requires resolving the noncommercial restriction. [Corpus portal](https://www.sign-lang.uni-hamburg.de/dicta-sign/portal/), [license](https://creativecommons.org/licenses/by-nc-sa/3.0/), [Kozha pinned credits/provenance](https://github.com/zhan-a/Kozha/blob/ce93d533b24740879df1e84cbb5341dfa575fc1f/public/credits.html).
- HamNoSys: IDGS, Universität Hamburg, CC BY 4.0. English spaCy / Explosion AI and `en_core_web_sm`: MIT.

Corpus provenance is not independent validation of this planner or avatar. No copyrighted university lecture recording or third-party lecture media is shipped.
