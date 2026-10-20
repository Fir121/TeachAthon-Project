import { useCallback, useEffect, useRef, useState } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import {
  ChevronLeft,
  ChevronRight,
  Expand,
  ExternalLink,
  Radio,
  Pencil,
  Eraser,
  CheckCircle2,
} from "lucide-react";
import { api, queryClient, useAction, useUI } from "./api";
import { QuestionFeed, type Question } from "./Questions";
import { Failure, type Lecture } from "./CoursePage";
import { AudioControls } from "./AudioCapture";
import LecturerQueue from "./LecturerQueue";
import FeedbackNote from "./FeedbackNote";
export type Session = {
  id: string;
  lecture_id: string;
  course_id: string;
  state: string;
  started_at: string;
  ended_at: string | null;
  active_slide_index: number;
  seq: number;
  recording_enabled: boolean;
  recording_state: string;
  transcript_state: string;
  context_paused: boolean;
  topic?: { topic: string; checkpoint?: boolean; error?: string };
  poll_config?: { poll_mode: string };
};
export type Poll = {
  id: string;
  prompt: string;
  status: string;
  labels: string[];
  my_vote: number | null;
  counts?: number[];
  opened_at: string;
};
export type Slide = { index: number; image_url: string };
export type Annotation = {
  index: number;
  stroke: number[][];
  offset_ms: number;
};
export type Snapshot = {
  participants?: number;
  session: Session;
  lecture: { id: string; title: string };
  membership: string;
  slides: Slide[];
  poll: Poll | null;
  questions: Question[];
  annotations: Annotation[];
  latest_caption?: string;
};
export function LectureSetup() {
  const { id } = useParams(),
    navigate = useNavigate(),
    [record, setRecord] = useState(false),
    [index, setIndex] = useState(0);
  const lecture = useQuery({
    queryKey: ["lecture", id],
    queryFn: () => api<Lecture & { course_id: string }>(`/lectures/${id}`),
  });
  const course = useQuery({
    queryKey: ["course", lecture.data?.course_id],
    queryFn: () =>
      api<{ membership: string }>(`/courses/${lecture.data!.course_id}`),
    enabled: !!lecture.data,
  });
  const slides = useQuery({
    queryKey: ["slides", id],
    queryFn: () => api<Slide[]>(`/lectures/${id}/slides`),
  });
  const outline = useQuery({
    queryKey: ["outline", id],
    queryFn: () =>
      api<{
        outline: { topics: string[] } | null;
        jobs: { status: string; error: string | null }[];
      }>(`/lectures/${id}/outline`),
    enabled: course.data?.membership === "lecturer",
    refetchInterval: 5000,
  });
  const generateOutline = useAction(() => api(`/lectures/${id}/outline`, {}));
  const start = useAction(() =>
    api<Session>(`/lectures/${id}/sessions/start`, {
      recording_enabled: record,
    }),
  );
  if (!lecture.data) return <Failure error={lecture.error} />;
  return (
    <>
      <Link className="back" to={`/courses/${lecture.data.course_id}/lectures`}>
        ← Course lectures
      </Link>
      <div className="row-between">
        <div>
          <span className="eyebrow">READY FOR THE ROOM</span>
          <h1>{lecture.data.title}</h1>
        </div>
      </div>
      <div className="lecture-setup">
        <section className="panel">
          <img
            className="slide"
            src={slides.data?.[index]?.image_url}
            alt={`Slide ${index + 1}`}
          />
          <div className="row-between">
            <button
              className="secondary"
              disabled={!index}
              onClick={() => setIndex(index - 1)}
            >
              Previous
            </button>
            <span>
              {index + 1} / {slides.data?.length || 0}
            </span>
            <button
              className="secondary"
              disabled={index + 1 >= (slides.data?.length || 0)}
              onClick={() => setIndex(index + 1)}
            >
              Next
            </button>
          </div>
        </section>
        {course.data?.membership === "lecturer" && (
          <section className="panel">
            <h2>Start a live lecture</h2>
            <p className="muted spaced">
              Students follow your slides, respond to understanding checks, and
              ask questions in their course space.
            </p>
            <label className="check spaced">
              <input
                type="checkbox"
                checked={record}
                onChange={(e) => setRecord(e.target.checked)}
              />
              Record microphone audio for course replay
            </label>
            <p className="muted small spaced">
              Let your class know before recording. Audio and transcripts are
              available only to enrolled course members. Microphone capture
              starts when you choose it in the control room.
            </p>
            <button
              className="primary spaced"
              disabled={start.isPending || !slides.data?.length}
              onClick={() =>
                start.mutate(undefined, {
                  onSuccess: (s) => navigate(`/sessions/${s.id}`),
                })
              }
            >
              <Radio size={16} />
              Start lecture
            </button>
            <Failure error={start.error} />
            <details className="spaced">
              <summary>Optional teaching outline</summary>
              <button
                className="secondary spaced"
                disabled={
                  generateOutline.isPending ||
                  outline.data?.jobs.some((j) =>
                    ["queued", "processing"].includes(j.status),
                  )
                }
                onClick={() => generateOutline.mutate()}
              >
                Generate outline from slides
              </button>
              {outline.data?.outline?.topics.map((topic) => (
                <p className="muted small spaced" key={topic}>
                  {topic}
                </p>
              ))}
              {outline.data?.jobs.map((j, i) => (
                <p className="muted small" key={i}>
                  {j.status} {j.error}
                </p>
              ))}
            </details>
          </section>
        )}
      </div>
    </>
  );
}
export function useSessionSocket(
  id: string,
  onCaption?: (text: string) => void,
) {
  const [state, setState] = useState("Connecting");
  const callback = useRef(onCaption);
  callback.current = onCaption;
  useEffect(() => {
    let closed = false,
      ws: WebSocket,
      timer: ReturnType<typeof setTimeout>,
      attempt = 0;
    function connect() {
      ws = new WebSocket(
        `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws/sessions/${id}`,
      );
      ws.onopen = () => {
        setState("Connected");
        attempt = 0;
        void queryClient.invalidateQueries({ queryKey: ["snapshot", id] });
      };
      ws.onmessage = (e) => {
        const event = JSON.parse(e.data);
        if (event.type === "transcript.delta") {
          callback.current?.(event.payload.text);
          return;
        }
        if (event.type === "question.answered")
          useUI.getState().setNotice("A class question has been answered.");
        void queryClient.invalidateQueries({ queryKey: ["snapshot", id] });
        void queryClient.invalidateQueries({ queryKey: ["poll-history", id] });
        void queryClient.invalidateQueries({
          queryKey: ["lecturer-queue", id],
        });
        if (event.type === "transcript.final") {
          callback.current?.(event.payload.text);
        }
        if (event.type === "transcript.final")
          void queryClient.invalidateQueries({ queryKey: ["transcript", id] });
      };
      ws.onclose = () => {
        if (!closed) {
          setState("Reconnecting");
          timer = setTimeout(connect, Math.min(15000, 1000 * 2 ** attempt++));
        }
      };
      ws.onerror = () => ws.close();
    }
    connect();
    return () => {
      closed = true;
      clearTimeout(timer);
      ws?.close();
    };
  }, [id]);
  return state;
}
export function PollCard({
  poll,
  teacher,
  courseId,
  sessionId,
}: {
  poll: Poll;
  teacher: boolean;
  courseId?: string;
  sessionId?: string;
}) {
  const vote = useAction((option_index: number) =>
    api(`/polls/${poll.id}/vote`, { option_index }),
  );
  const close = useAction(() => api(`/polls/${poll.id}/close`, {}));

  const total = poll.counts?.reduce((a, b) => a + b, 0) || 0;
  return (
    <section className="panel poll-card">
      <div className="row-between">
        <span className="eyebrow">UNDERSTANDING CHECK</span>
        <span className="status live">
          {poll.status === "open" ? "Open now" : poll.status}
        </span>
      </div>
      <h2>{poll.prompt}</h2>
      <div className="poll-options">
        {poll.labels.map((label, i) => (
          <button
            key={label}
            disabled={teacher || poll.status !== "open" || vote.isPending}
            aria-pressed={poll.my_vote === i}
            className={`poll-option option-${i} ${poll.my_vote === i ? "selected" : ""}`}
            onClick={() => vote.mutate(i)}
          >
            <span className="poll-dot">{i + 1}</span>
            <span>{label}</span>
            {teacher && (
              <strong>
                {poll.counts?.[i] || 0}{" "}
                {total > 0 &&
                  `· ${Math.round(((poll.counts?.[i] || 0) / total) * 100)}%`}
              </strong>
            )}
            {poll.my_vote === i && <CheckCircle2 size={17} />}
          </button>
        ))}
      </div>
      {!teacher && poll.my_vote !== null && (
        <p className="muted small" role="status">
          Response saved. You can change it while the poll is open.
        </p>
      )}
      {teacher && (
        <div className="row-between">
          <span className="muted small">
            {total} response{total !== 1 ? "s" : ""} · aggregate only
          </span>
          {poll.status === "open" && (
            <button className="text-button" onClick={() => close.mutate()}>
              Close poll
            </button>
          )}
        </div>
      )}
      <Failure error={vote.error} />
      {!teacher && poll.status === "open" && courseId && sessionId && (
        <FeedbackNote
          courseId={courseId}
          sessionId={sessionId}
          pollId={poll.id}
        />
      )}
    </section>
  );
}
export function SlideView({
  slide,
  index,
  annotations,
  onStroke,
}: {
  slide: Slide | undefined;
  index: number;
  annotations: Annotation[];
  latest_caption?: string;
  onStroke?: (stroke: number[][]) => void;
}) {
  const [drawing, setDrawing] = useState(false),
    [points, setPoints] = useState<number[][]>([]),
    svg = useRef<SVGSVGElement>(null);
  const strokes: number[][][] = [];
  for (const a of annotations.filter((a) => a.index === index)) {
    if (a.stroke.length === 0) strokes.length = 0;
    else strokes.push(a.stroke);
  }
  function point(e: React.PointerEvent) {
    const rect = svg.current!.getBoundingClientRect();
    return [
      Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
    ];
  }
  return (
    <>
      <div className="slide-stage">
        <img src={slide?.image_url} alt={`Lecture slide ${index + 1}`} />
        <svg
          ref={svg}
          viewBox="0 0 1000 1000"
          preserveAspectRatio="none"
          className={drawing ? "drawing" : ""}
          onPointerDown={(e) => {
            if (drawing) {
              e.currentTarget.setPointerCapture(e.pointerId);
              setPoints([point(e)]);
            }
          }}
          onPointerMove={(e) => {
            if (drawing && e.buttons === 1)
              setPoints((p) => (p.length < 1900 ? [...p, point(e)] : p));
          }}
          onPointerUp={() => {
            if (points.length) {
              onStroke?.(points);
              setPoints([]);
            }
          }}
        >
          {[...strokes, points].map((stroke, i) => (
            <polyline
              key={i}
              points={stroke
                .map((p) => `${p[0] * 1000},${p[1] * 1000}`)
                .join(" ")}
              fill="none"
              stroke="#dc673b"
              strokeWidth={4}
              vectorEffect="non-scaling-stroke"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
        </svg>
      </div>
      {onStroke && (
        <div className="annotation-tools">
          <button
            className={`secondary ${drawing ? "active" : ""}`}
            aria-pressed={drawing}
            onClick={() => setDrawing(!drawing)}
          >
            <Pencil size={15} />
            Annotate
          </button>
          <button className="secondary" onClick={() => onStroke([])}>
            <Eraser size={15} />
            Clear slide ink
          </button>
        </div>
      )}
    </>
  );
}
export default function Live() {
  const { id } = useParams(),
    [params] = useSearchParams(),
    projector = params.get("mode") === "presenter",
    navigate = useNavigate();
  const [caption, setCaption] = useState(""),
    [captions, setCaptions] = useState(false);
  const connection = useSessionSocket(id!, setCaption);
  const q = useQuery({
    queryKey: ["snapshot", id],
    queryFn: () => api<Snapshot>(`/sessions/${id}/snapshot`),
    refetchInterval: 5000,
  });
  const join = useQuery({
    queryKey: ["join-info", id],
    queryFn: () =>
      api<{ code: string; url: string }>(`/sessions/${id}/join-info`),
  });
  const teacher = q.data?.membership === "lecturer";
  const slide = useAction((index: number) =>
    api(`/sessions/${id}/slides/change`, { index }),
  );
  const annotation = useAction((stroke: number[][]) =>
    api(`/sessions/${id}/annotations`, {
      index: q.data?.session.active_slide_index,
      stroke,
    }),
  );
  const poll = useAction(() => api(`/sessions/${id}/polls`, {}));
  const end = useAction(async () => {
    await stopAudio.current?.();
    return api(`/sessions/${id}/end`, {});
  });
  const context = useAction(() =>
    api(
      `/sessions/${id}/context/${q.data?.session.context_paused ? "resume" : "pause"}`,
      {},
    ),
  );
  const [confirmEnd, setConfirmEnd] = useState(false);
  const stopAudio = useRef<(() => Promise<void>) | null>(null);
  const history = useQuery({
    queryKey: ["poll-history", id],
    queryFn: () => api<Poll[]>(`/sessions/${id}/polls`),
    enabled: teacher,
  });
  const index = q.data?.session.active_slide_index || 0;
  const change = useCallback(
    (delta: number) => {
      if (teacher && q.data?.session.state === "live" && !slide.isPending) {
        const n = index + delta;
        if (n >= 0 && n < q.data.slides.length) slide.mutate(n);
      }
    },
    [teacher, index, q.data, slide],
  );
  useEffect(() => {
    function key(e: KeyboardEvent) {
      if (
        e.target instanceof HTMLElement &&
        ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(e.target.tagName)
      )
        return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        change(1);
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        change(-1);
      }
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [change]);
  if (q.isPending) return <p role="status">Joining the classroom…</p>;
  if (!q.data) return <Failure error={q.error} />;
  const data = q.data,
    s = data.session;
  if (s.state === "ended")
    return (
      <section className="panel">
        <span className="eyebrow">LECTURE COMPLETE</span>
        <h1>{data.lecture.title}</h1>
        <p>
          The live session has ended. Questions remain in your course
          discussions.
        </p>
        <div className="actions spaced">
          <Link className="button primary" to={`/recordings/${id}`}>
            Open lecture archive
          </Link>
          <Link
            className="button secondary"
            to={`/courses/${s.course_id}/discussions`}
          >
            Course discussions
          </Link>
        </div>
      </section>
    );
  const slides = (
    <>
      <SlideView
        slide={data.slides[index]}
        index={index}
        annotations={data.annotations}
        onStroke={teacher ? (stroke) => annotation.mutate(stroke) : undefined}
      />
      <div className="slide-controls">
        <span className="muted small">
          Slide {index + 1} / {data.slides.length}
        </span>
        {teacher && (
          <div className="actions">
            <button
              className="icon-button"
              aria-label="Previous slide"
              disabled={!index || slide.isPending}
              onClick={() => change(-1)}
            >
              <ChevronLeft size={20} />
            </button>
            <button
              className="icon-button"
              aria-label="Next slide"
              disabled={index + 1 >= data.slides.length || slide.isPending}
              onClick={() => change(1)}
            >
              <ChevronRight size={20} />
            </button>
            <button
              className="icon-button"
              aria-label="Fullscreen slides"
              onClick={() =>
                document
                  .querySelector(".presenter-surface")
                  ?.requestFullscreen()
                  .catch(() =>
                    useUI
                      .getState()
                      .setNotice("Fullscreen could not be opened."),
                  )
              }
            >
              <Expand size={18} />
            </button>
          </div>
        )}
      </div>
    </>
  );
  if (projector && teacher)
    return (
      <div className="projection-layout">
        <div className="row-between">
          <h2>{data.lecture.title}</h2>
          <Link to={`/sessions/${id}`} className="button secondary">
            Control room
          </Link>
        </div>
        <div className="presenter-surface">{slides}</div>
        <div className="join-banner">
          <QRCodeSVG value={join.data?.url || location.href} size={85} />
          <div>
            <strong>Join the lecture</strong>
            <p>{join.data?.code}</p>
            <span className="small">Course membership required</span>
          </div>
        </div>
      </div>
    );
  return (
    <>
      <div className="live-heading">
        <div>
          <Link to={`/courses/${s.course_id}/lectures`} className="back">
            ← Course lectures
          </Link>
          <div className="actions">
            <span className="live-indicator">LIVE</span>
            <span className="muted small" role="status">
              {connection}
            </span>
          </div>
          <h1>{data.lecture.title}</h1>
        </div>
        {teacher && (
          <div className="actions">
            <a
              className="button secondary"
              href={`/sessions/${id}?mode=presenter`}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink size={15} />
              Presenter window
            </a>
            <button
              className="secondary"
              onClick={() => setConfirmEnd(!confirmEnd)}
            >
              End lecture
            </button>
          </div>
        )}
      </div>
      {confirmEnd && (
        <div className="panel spaced">
          <p>
            End this lecture? It cannot be restarted. Recording processing will
            continue in the archive.
          </p>
          <div className="actions spaced">
            <button
              className="primary"
              disabled={end.isPending}
              onClick={() => end.mutate()}
            >
              End lecture now
            </button>
            <button className="secondary" onClick={() => setConfirmEnd(false)}>
              Keep teaching
            </button>
          </div>
        </div>
      )}
      <div className={`live-layout ${teacher ? "instructor" : ""}`}>
        <div>
          <section className="panel presenter-surface">{slides}</section>
          {teacher && (
            <section className="panel spaced">
              <div className="row-between">
                <div>
                  <span className="eyebrow">CLASSROOM CONTROLS</span>
                  <p className="small muted">
                    {data.participants || 0} connected member(s) · Join code:{" "}
                    <strong>{join.data?.code}</strong>
                  </p>
                </div>
                <button
                  className="primary"
                  disabled={poll.isPending}
                  onClick={() => poll.mutate()}
                >
                  Open understanding poll
                </button>
              </div>
              <div className="actions spaced">
                <button className="secondary" onClick={() => context.mutate()}>
                  {s.context_paused ? "Resume topic AI" : "Pause topic AI"}
                </button>
                <span className="muted small">
                  {s.topic?.topic
                    ? `Current topic: ${s.topic.topic}`
                    : "Topic inference awaiting microphone context"}
                </span>
              </div>
              {s.topic?.error && (
                <p className="error spaced">{s.topic.error}</p>
              )}
              {s.topic?.checkpoint && (
                <p className="muted spaced">
                  Suggested checkpoint: consider an understanding poll.
                </p>
              )}
              <AudioControls
                sid={id!}
                registerStop={(stop) => {
                  stopAudio.current = stop;
                }}
              />
            </section>
          )}
          <div className="caption-toggle">
            <label className="check">
              <input
                type="checkbox"
                checked={captions}
                onChange={(e) => setCaptions(e.target.checked)}
              />
              Show live captions
            </label>
            {s.recording_enabled && (
              <span className="small muted">
                Recording consent enabled · {s.recording_state}
              </span>
            )}
          </div>
          {captions && (
            <div className="captions" aria-live="polite">
              {caption ||
                data.latest_caption ||
                `Transcription ${s.transcript_state}. Captions appear when microphone transcription is active.`}
            </div>
          )}
          {data.poll && (
            <PollCard
              poll={data.poll}
              teacher={teacher}
              courseId={s.course_id}
              sessionId={id}
            />
          )}
        </div>
        <aside>
          {teacher ? (
            <LecturerQueue sessionId={id!} />
          ) : (
            <QuestionFeed
              courseId={s.course_id}
              sessionId={id}
              teacher={false}
              questions={data.questions}
            />
          )}
          {teacher && (
            <details className="panel spaced">
              <summary>Poll history</summary>
              {history.data
                ?.filter((p) => p.status !== "open")
                .map((p) => (
                  <PollCard key={p.id} poll={p} teacher />
                ))}
            </details>
          )}
        </aside>
      </div>
    </>
  );
}
export function Join() {
  const { code } = useParams(),
    navigate = useNavigate(),
    [value, setValue] = useState(code || "");
  const join = useAction((code: string) =>
    api<{ session_id: string }>("/sessions/join", { code }),
  );
  return (
    <form
      className="panel narrow"
      onSubmit={(e) => {
        e.preventDefault();
        join.mutate(value, {
          onSuccess: (r) => navigate(`/sessions/${r.session_id}`),
        });
      }}
    >
      <h1>Join your lecture</h1>
      <label>
        Join code
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          required
          maxLength={20}
        />
      </label>
      <button className="primary" disabled={join.isPending}>
        Join lecture
      </button>
      <p className="muted small">
        You must already be enrolled in this course.
      </p>
      <Failure error={join.error} />
    </form>
  );
}
export function Invite() {
  const { token } = useParams(),
    navigate = useNavigate();
  const accept = useAction(() =>
    api<{ course_id: string }>("/invitations/accept", { token }),
  );
  return (
    <section className="panel narrow">
      <h1>You’re invited.</h1>
      <p>
        Accept this invitation to join the course with your signed-in account.
      </p>
      <button
        className="primary spaced"
        disabled={accept.isPending}
        onClick={() =>
          accept.mutate(undefined, {
            onSuccess: (r) => navigate(`/courses/${r.course_id}`),
          })
        }
      >
        Accept invitation
      </button>
      <Failure error={accept.error} />
    </section>
  );
}
