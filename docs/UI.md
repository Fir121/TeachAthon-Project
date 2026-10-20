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
6. **Question preflight:** after writing and selecting visibility/anonymity, show bounded retrieval loading; cards for existing human explanation (play timestamp), relevant course resource, public matching question (upvote), and clearly visible 'Post my question anyway'. No chat bubbles or turn-by-turn bot interface. Failed preflight -> error+retry+post-anyway.
7. **Post-lecture discussion:** EdStem-style list with search, sort, filters, thread detail with replies and lecturer indicators, named/anonymous and public/private composition; same preflight on create. Resource/course search with mixed result types and source labels.
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
