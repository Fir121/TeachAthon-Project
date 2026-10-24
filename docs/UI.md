# UI / UX baseline: practical, polished, low-friction

## Design tone
Clean modern education SaaS inspired by EdStem and University of Edinburgh generally, but **not** branded as Edinburgh or copied pixel-for-pixel. Neutral academic palette, readable type, restrained accent, nonintrusive AI, mobile-first student UI. Every async action clearly exposes pending/success/failure/retry, and access denial explains the action to take.

## Navigation
**Unauthenticated:** landing with student/lecturer sign-in/signup, join-by-link redirect through auth.
**Student dashboard:** enrolled courses, active sessions highlighted, requests, recent Q&A/notifications; course sidebar/tabs `Overview | Lectures | Resources | Discussions | Search`.
**Lecturer dashboard:** own/shared courses, join requests, recent unanswered questions, upload statuses, create course/lecture quick actions. Course additionally `Members | Settings | Manage Resources`.

## Essential screens
1. **Course resource manager:** folder tree, breadcrumbs, upload/dropzone, resource type/status/retry, move/rename/delete; file preview/player for owned resources. Lecturer indexing toggle.
2. **Lecture setup:** choose prepared PDF/PPT deck; auto process until slide images ready; mic and recording controls, optional outline, create and start. Refuse to start without valid deck; explain why.
3. **Projected presenter:** slide fills screen, keyboard navigation, annotation toggle/eraser, minimal controls/status. QR code shown at session join screen. Presenter should not display private questions on publicly projected slide.
4. **Lecturer live control room:** responsive separate tab/window or expandable sidebar, current slide/topic, participants, transcript/recording indicator, aggregated poll results and history, sortable grouped question queue with public/private markers, resolve/dismiss and clear AI recommendations, manual poll control, end session. No required interaction during explanation.
5. **Student live mobile companion:** current slide preview, compact active understanding poll and optional free text, question feed and Ask action, public upvote, discreet toast when question answered, caption panel toggle/scroll, connection status. No independent slide paging during live teaching.
6. **Question preflight:** after writing a named course-public question, show bounded retrieval loading; cards for existing human explanation (play timestamp), relevant course resource, public matching question (upvote), and clearly visible 'Post my question anyway'. No chat bubbles or turn-by-turn bot interface. Failed preflight -> error+retry+post-anyway.
7. **Post-lecture discussion:** EdStem-style list with search, sort, filters, thread detail with replies and lecturer indicators, named course-public composition with protected legacy and feedback threads; same preflight on create. Resource/course search with mixed result types and source labels.
8. **Lecture replay page:** audio player (MP3 etc. as applicable) with scrub and speed, synced visual slide, timestamped transcript panel, click search result jumps to timestamp, relevant question/answer. If recording processing unfinished, show status and available transcript parts.

## Accessibility and affordances
- ARIA label and keyboard support; no color-only distinction; focus states; captions opt-in; readable mobile touch targets. Use transient toasts and local simple notification drawer; browser push/email not MVP.
- Participant counts and polls only to lecturer in aggregate. On public student feed never leak private counts/suggestions/identities.
- Browser permission/AI timeout states need explicit humane language. No artificial spinner that hides successful question submission.
- Feature controls must be functional, even if minimalist. A long complicated settings UI is unnecessary; course options can be a small form.

## Visual acceptance
- Works at ~360px mobile width and wide lecturer desktop; presenter can fullscreen and lecturer can open separate window.
- Core task should require few steps; keyboard arrows advance slides; students can answer poll and post question with minimal taps.
- Loading states for indexing, retrieval, transcription and recording reflect real backend state.

## Current refinements — 2026-10-20

Profile avatar opens a browser-history-backed profile dialog with picture preview/upload/remove. Course settings manage a course banner; lecture setup has a banner dialog. Actual images appear on course cards/headers and lecture cards/setup/archive, with neutral icon fallbacks when absent. Upload help and errors remain next to the controls.

Course Search asks for **Search words**, supports a single word or technical acronym and uses shared semantic source assessment with question preflight. Synonymous definitions can qualify; merely related sources and wrong technical constraints are rejected. Degraded keyword fallback is labelled. Notes send directly without any preflight.

Archive navigation, eyebrow and title occupy separate rows. Saved annotation/clear events are replayed at audio time, including when seeking backward. New ink coordinates refer to the slide image instead of its surrounding letterboxed frame; older events retain their original format.

## Classroom simplification — 2026-10-22

Create lecture includes Upload slides, preparation status/retry and automatic selection when rendering is ready, preserving the title. Fullscreen uses visible contrasting control/annotation toolbars and an Exit fullscreen action. Post question runs retrieval and automatically posts only on a complete warning-free empty result; matches require continuation, failures offer retry/explicit Post anyway. No new anonymity/visibility options. Notes disclose sender identity to lecturers and remain lecturer-only. Only authors see Edit; lecturers can delete others’ content. Deleted threads close with a notice; lists/open replies update within two seconds or through live events. A competing lecture start shows the existing session and Open live lecture, with no automatic termination.

## Follow-up corrections — 2026-10-23

Move to discussions replaces Dismiss and hides a question only from live queues; the course forum retains it and its answered state. Answered questions without a precise excerpt show Answered in [lecture title] linking the full recording, with live/processing availability text and no invented timestamp. Send note to lecturer is a single direct action without source checking. Poll feedback & AI processing always shows exact original feedback; useful question rewrites appear separately in the private queue, and punctuation-only changes receive no AI-edited label.

Manual queue grouping starts with **Group questions**; selection checkboxes appear only in that mode. Hover/help explains that automatic AI grouping already runs and this control allows manual grouping. Save requires two questions; Cancel/Escape clears selection. Poll feedback has no redundant “Original feedback” tag. Multiple requests in one note remain visible as separate paragraphs in its single private queue entry; the full original stays inspectable.

Split group restores ordinary question cards with their individual Mark answered action, without group headings or Mark group answered. A lone visible question never shows bulk group controls, including when the other members are hidden by the queue filter. Split decisions remain respected by automatic grouping; lecturers can explicitly regroup questions later.

## Semantic processing — 2026-10-23

Feedback accounts for the entire note in one model pass; requests appear together in one private question, with unchanged original feedback always readable. An uncertain extraction retains the original and offers explicit retry. Grouping keeps every card visible, verifies every member/request and leaves uncertain/different teaching needs separate. Older auto groups awaiting review cannot be bulk-answered; individual answer actions remain available. Complete multi-request recording coverage can link several passages. Partial matches are lecturer-only review material, with the whole-recording answer fallback retained. Earlier unchecked suggestions have review/recheck/adjust/remove controls; human-selected ranges remain protected. Outlines show actual all-section processing/partial status and saved progress.


## Optional interactive diagrams — 2026-10-23

Lecture setup retains the prominent normal Start action and adds optional preparation below the slide/start panels. Find interactive opportunities reports actual batch progress/errors, input caveats and zero-or-more suggestions. Any current slide can be generated; cards distinguish queued/processing/failed/preview/approved/rejected/superseded/stale states. Preview uses the shared student renderer with original-slide comparison, text alternative and reset; the owner-approved review action is Approve and next, enabled only after the preview runs, without an extra checkbox. Refinement/regeneration preserves the previous approval until replacement approval. Once started, preparation is read-only.

Live companion/control-room users can opt into the current published diagram; projector mode never renders the exploration control. The modal has scrollable phone layout, labelled frame, instructions, text alternative, visible retry/reset/close, native focus containment and Escape/focus restoration across Chromium/WebKit. Ready/error messages are validated against the current opaque frame instance. Slide changes unmount stale JS, with local state reset on reopen. Archive uses historical timeline index; actual slide-event buttons support navigation when audio/transcript is absent. Student live activities now announce themselves as described below; lecturer/archive exploration stays manual and students’ exploration state is never synchronized.


## Integrated diagram workspace — 2026-10-23

Lecture setup now combines source-slide browsing and optional diagram preparation. Thumbnail checkboxes start unselected; suggested slides are visibly marked but never automatically generated. Select any slides, Generate selected, and keep browsing while each reports Waiting/Generating/Ready to review/Needs attention. Actual inspected-page counts drive analysis progress; no generation percentage or ETA is fabricated. A compact activity summary and approved/unfinished counts accompany the normal Start action. Partial submission failures stay selected and offer individual retry. Ready previews never open automatically.

Review ready previews follows slide order in a viewport-filling canvas with a narrow context sidebar, compact expandable source reference, instructions, Approve and next, Reject and next and in-place Refine. No checkbox or close-to-refine detour. New drafts retain earlier approval until deliberately replaced; history is collapsed. The same spacious viewer serves live/replay with a short header, visible controls, reserved loading stage, reset and native modal focus/Escape behavior. Laptop dimensions are tested at 1280×720 / 1440×900; phones stack stage then context. No scrollbar is hidden to conceal clipped controls; long context or controls may scroll purposefully. Legacy generated content stays intact and can need regeneration for its internal layout.

Clicking Generate interactive diagram (or replacement/retry/Generate selected) opens an optional Teaching notes field before submission. Lecturers can describe a focus, example or desired interaction in up to 1,500 characters, or leave it blank. Batch notes apply to every selected slide. Only Generate preview(s) starts generation; Cancel/Escape does not queue work. Submission retries prefill the original notes. The notes go to the model with the slide; approval still requires preview review.

Source-assessment alerts remain visible. The confidence alert appears only when every assessed candidate is uncertain; mixed results keep confidently matched sources without a global uncertainty alert. Empty assessments do not trigger it. Technical assessment failures retain the visible keyword-fallback warning and retry/explicit posting actions, with source-free details recorded in server logs.


## Student activity popups — 2026-10-24

An unanswered live poll automatically opens a focused popup with the real voting controls and optional feedback note. A current approved diagram opens an invitation with Explore diagram and Not now; generated code does not execute until the student chooses Explore. Each activity alerts once per classroom visit, including when joining an already active activity. Polls take priority when both arrive together. Alerts wait behind existing dialogs and never stack over a draft; dismissing one allows the next pending activity. Buttons remain below the slide for reopening, changing a poll response or exploring later. Already-answered polls do not automatically prompt again. Closing/replacing a poll, changing away from a diagram slide or ending the session removes obsolete activity UI. Escape, browser Back and close controls dismiss; focus returns to the activity button. Snapshot refresh/reconnect does not repeat a dismissed alert while the view stays mounted. Returning after a full page reload is a new visit. Lecturers/projectors and archive replay keep their existing manual behavior.


## Poll note composer — 2026-10-24

Successful submission clears and collapses the form, returning focus to Add a note for the lecturer. A sent confirmation remains visible outside the collapsed section and explains how to reopen it for a new note. Sent text is not left in an editable-looking field. The button shows Sending only during the request; disabled empty input does not show a loading cursor. Failed sends retain the draft for retry, and rapid repeated submits cannot create concurrent sends.


Diagram reopening refinement (2026-10-24): the automatic first-time activity invitation still offers Explore diagram / Not now. The persistent Explore interactive diagram button under the live slide opens the authenticated sandboxed viewer directly in one click, including after dismissal or a prior exploration; it does not repeat the invitation. Choosing this button counts as noticing the activity. Browser Back/Escape, focus restoration and stale-slide cleanup remain in effect. No generation, approval, provider input or sandbox permission changes.
