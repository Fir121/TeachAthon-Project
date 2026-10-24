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
  Minimize,
  ExternalLink,
  Radio,
  Pencil,
  Eraser,
  CheckCircle2,
} from "lucide-react";
import { api, ApiError, queryClient, useAction, useUI } from "./api";
import { QuestionFeed, type Question } from "./Questions";
import { Failure, type Lecture } from "./CoursePage";
import { AudioControls } from "./AudioCapture";
import LecturerQueue from "./LecturerQueue";
import FeedbackNote from "./FeedbackNote";
import { Dialog, useDialog } from "./Dialog";
import ImageUpload from "./ImageUpload";
import {
  DiagramPreparation,
  ExploreDiagram,
  InteractiveDiagramViewer,
  type Diagram,
} from "./InteractiveDiagrams";
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
  coordinates?: "stage" | "slide";
};
export type Snapshot = {
  diagrams?: Diagram[];
  participants?: number;
  session: Session;
  lecture: { id: string; title: string; banner_url?: string | null };
  membership: string;
  slides: Slide[];
  poll: Poll | null;
  questions: Question[];
  annotations: Annotation[];
  latest_caption?: string;
};
export function LectureSetup() {
  const bannerDialog = useDialog();
  const { id } = useParams(),
    navigate = useNavigate(),
    [record, setRecord] = useState(false),
    [index, setIndex] = useState(0);
  const lecture = useQuery({
    queryKey: ["lecture", id],
    queryFn: () => api<Lecture & { course_id: string }>(`/lectures/${id}`),
  });
  const courseLectures = useQuery({
    queryKey: ["lectures", lecture.data?.course_id],
    queryFn: () =>
      api<Lecture[]>(`/courses/${lecture.data!.course_id}/lectures`),
    enabled: !!lecture.data,
    refetchInterval: 2000,
  });
  const activeLecture = courseLectures.data?.find(
    (l) => l.session?.state === "live" && l.id !== id,
  );
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
        outline: {
          topics: string[];
          status?: string;
          total_sections?: number;
          completed_sections?: number;
          showing_previous?: boolean;
          error?: string | null;
        } | null;
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
      {lecture.data.banner_url && (
        <img
          className="lecture-banner"
          src={lecture.data.banner_url}
          alt={`${lecture.data.title} banner`}
        />
      )}
      <div className="row-between">
        <div>
          <span className="eyebrow">READY FOR THE ROOM</span>
          <h1>{lecture.data.title}</h1>
        </div>
      </div>
      {course.data?.membership === "lecturer" && (
        <div className="actions spaced-bottom">
          <button
            className="secondary"
            onClick={(event) =>
              bannerDialog.open("lecture-banner", event.currentTarget)
            }
          >
            {lecture.data.banner_url
              ? "Change lecture banner"
              : "Add lecture banner"}
          </button>
        </div>
      )}
      {course.data?.membership === "lecturer" &&
        bannerDialog.active === "lecture-banner" && (
          <Dialog title="Lecture banner" onClose={bannerDialog.close}>
            <ImageUpload
              label="Lecture banner"
              showTitle={false}
              endpoint={`/lectures/${id}/banner`}
              url={lecture.data.banner_url}
            />
          </Dialog>
        )}
      {course.data?.membership === "lecturer" ? (
        <DiagramPreparation
          lectureId={id!}
          index={index}
          onSelect={setIndex}
          slides={slides.data || []}
        >
          {course.data?.membership === "lecturer" && (
            <section className="lecture-startbar">
              <h2>Start a live lecture</h2>
              <p className="muted spaced">
                Students follow your slides, respond to understanding checks,
                and ask questions in their course space.
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
              {(activeLecture ||
                (start.error instanceof ApiError &&
                  start.error.activeSession)) && (
                <div className="error spaced" role="alert">
                  <p>
                    {activeLecture
                      ? `${activeLecture.title} is already live in this course.`
                      : start.error?.message}
                  </p>
                  <Link
                    className="button secondary spaced"
                    to={
                      activeLecture
                        ? `/sessions/${activeLecture.session!.id}`
                        : (start.error as ApiError).activeSession!.url
                    }
                  >
                    Open live lecture
                  </Link>
                </div>
              )}
              <button
                className="primary spaced"
                disabled={
                  start.isPending || !slides.data?.length || !!activeLecture
                }
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
                {outline.data?.outline?.status && (
                  <p className="muted small spaced" role="status">
                    {outline.data.outline.status === "ready"
                      ? "All extracted slide sections processed."
                      : `${outline.data.outline.status === "partial" ? "Partial outline" : "Processing outline"}: ${outline.data.outline.completed_sections || 0} of ${outline.data.outline.total_sections || 0} sections processed.`}
                    {outline.data.outline.showing_previous &&
                      " The previous outline is shown while the replacement is prepared."}
                    {outline.data.outline.error &&
                      ` ${outline.data.outline.error}`}
                  </p>
                )}
                {outline.data?.jobs.map((j, i) => (
                  <p className="muted small" key={i}>
                    {j.status} {j.error}
                  </p>
                ))}
              </details>
            </section>
          )}
        </DiagramPreparation>
      ) : (
        <img
          className="slide"
          src={slides.data?.[index]?.image_url}
          alt={`Slide ${index + 1}`}
        />
      )}
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
        void queryClient.invalidateQueries({ queryKey: ["questions"] });
        void queryClient.invalidateQueries({ queryKey: ["answers"] });
      };
      ws.onmessage = (e) => {
        const event = JSON.parse(e.data);
        if (event.type === "transcript.delta") {
          callback.current?.(event.payload.text);
          return;
        }
        if (
          event.type.startsWith("question.") ||
          event.type.startsWith("reply.")
        ) {
          void queryClient.invalidateQueries({ queryKey: ["questions"] });
          void queryClient.invalidateQueries({ queryKey: ["answers"] });
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
        <FeedbackNote pollId={poll.id} />
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
  onStroke?: (stroke: number[][]) => void;
}) {
  const [drawing, setDrawing] = useState(false);
  const [points, setPoints] = useState<number[][]>([]);
  const [natural, setNatural] = useState({ width: 0, height: 0 });
  const [bounds, setBounds] = useState<React.CSSProperties>({});
  const stage = useRef<HTMLDivElement>(null),
    svg = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const element = stage.current;
    if (!element || !natural.width || !natural.height) return;
    function measure() {
      const width = element!.clientWidth,
        height = element!.clientHeight;
      const scale = Math.min(width / natural.width, height / natural.height);
      setBounds({
        inset: "auto",
        left: (width - natural.width * scale) / 2,
        top: (height - natural.height * scale) / 2,
        width: natural.width * scale,
        height: natural.height * scale,
      });
    }
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [natural]);
  const strokes: Annotation[] = [];
  for (const annotation of annotations.filter((a) => a.index === index)) {
    if (annotation.stroke.length === 0) strokes.length = 0;
    else strokes.push(annotation);
  }
  function point(event: React.PointerEvent) {
    const rect = svg.current!.getBoundingClientRect();
    return [
      Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    ];
  }
  function line(stroke: number[][], key: number) {
    return (
      <polyline
        key={key}
        points={stroke.map((p) => `${p[0] * 1000},${p[1] * 1000}`).join(" ")}
        fill="none"
        stroke="#dc673b"
        strokeWidth={4}
        vectorEffect="non-scaling-stroke"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    );
  }
  return (
    <>
      <div className="slide-stage" ref={stage}>
        <img
          src={slide?.image_url}
          alt={`Lecture slide ${index + 1}`}
          onLoad={(event) =>
            setNatural({
              width: event.currentTarget.naturalWidth,
              height: event.currentTarget.naturalHeight,
            })
          }
        />
        <svg
          viewBox="0 0 1000 1000"
          preserveAspectRatio="none"
          aria-label="Legacy slide annotations"
          role="img"
        >
          {strokes
            .filter((a) => a.coordinates !== "slide")
            .map((a, i) => line(a.stroke, i))}
        </svg>
        <svg
          ref={svg}
          style={bounds}
          viewBox="0 0 1000 1000"
          preserveAspectRatio="none"
          aria-label="Slide annotations"
          role="img"
          className={drawing ? "drawing" : ""}
          onPointerDown={(event) => {
            if (drawing) {
              event.currentTarget.setPointerCapture(event.pointerId);
              setPoints([point(event)]);
            }
          }}
          onPointerMove={(event) => {
            if (drawing && event.buttons === 1)
              setPoints((previous) =>
                previous.length < 1900 ? [...previous, point(event)] : previous,
              );
          }}
          onPointerUp={() => {
            if (points.length) {
              onStroke?.(points);
              setPoints([]);
            }
          }}
          onPointerCancel={() => setPoints([])}
        >
          {strokes
            .filter((a) => a.coordinates === "slide")
            .map((a, i) => line(a.stroke, i))}
          {points.length > 0 && line(points, -1)}
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
export function StudentActivityAlerts({
  sessionId,
  courseId,
  poll,
  diagram,
  live,
}: {
  sessionId: string;
  courseId: string;
  poll: Poll | null;
  diagram?: Diagram;
  live: boolean;
}) {
  const dialog = useDialog();
  const seen = useRef(new Set<string>());
  const pollTrigger = useRef<HTMLButtonElement>(null);
  const diagramTrigger = useRef<HTMLButtonElement>(null);
  const [exploring, setExploring] = useState<string | null>(null);
  const pollName = poll?.status === "open" ? `student-poll-${poll.id}` : null;
  const diagramName = diagram ? `student-diagram-${diagram.id}` : null;
  useEffect(() => {
    if (!dialog.active) setExploring(null);
  }, [dialog.active]);
  useEffect(() => {
    function notify() {
      if (dialog.active) {
        if (
          (dialog.active.startsWith("student-poll-") &&
            (!live || dialog.active !== pollName)) ||
          (dialog.active.startsWith("student-diagram-") &&
            (!live || dialog.active !== diagramName))
        )
          dialog.close();
        return;
      }
      // Let an existing question/note dialog finish; never stack activity modals.
      if (!live || document.querySelector("dialog[open]")) return;
      const next =
        pollName && poll?.my_vote === null && !seen.current.has(pollName)
          ? pollName
          : diagramName && !seen.current.has(diagramName)
            ? diagramName
            : null;
      if (next) {
        seen.current.add(next);
        dialog.open(
          next,
          (next === pollName ? pollTrigger.current : diagramTrigger.current) ||
            undefined,
        );
      }
    }
    notify();
    const timer = window.setInterval(notify, 500);
    return () => window.clearInterval(timer);
  }, [dialog.active, pollName, diagramName, live, poll?.my_vote, sessionId]);
  if (!live) return null;
  return (
    <>
      <div className="actions spaced" aria-label="Classroom activities">
        {pollName && (
          <button
            ref={pollTrigger}
            className="primary"
            onClick={(e) => dialog.open(pollName, e.currentTarget)}
          >
            {poll?.my_vote === null
              ? "Answer understanding poll"
              : "View your poll response"}
          </button>
        )}
        {diagramName && (
          <button
            ref={diagramTrigger}
            className="secondary"
            onClick={(e) => {
              seen.current.add(diagramName);
              setExploring(diagramName);
              dialog.open(diagramName, e.currentTarget);
            }}
          >
            Explore interactive diagram
          </button>
        )}
      </div>
      {poll && pollName && dialog.active === pollName && (
        <Dialog
          title="Your lecturer opened a poll"
          description="Take a moment to share how the lesson is landing."
          onClose={dialog.close}
        >
          <PollCard
            poll={poll}
            teacher={false}
            courseId={courseId}
            sessionId={sessionId}
          />
          <button className="secondary spaced" onClick={dialog.close}>
            {poll.my_vote === null ? "Not now" : "Done"}
          </button>
        </Dialog>
      )}
      {diagram &&
        diagramName &&
        dialog.active === diagramName &&
        (exploring === diagramName ? (
          <InteractiveDiagramViewer diagram={diagram} onClose={dialog.close} />
        ) : (
          <Dialog
            title="Explore this slide"
            description="An interactive diagram is available for you to try."
            onClose={dialog.close}
          >
            <h3>{diagram.title}</h3>
            <p className="spaced">{diagram.summary}</p>
            <div className="actions spaced">
              <button
                className="primary"
                onClick={() => setExploring(diagramName)}
              >
                Explore diagram
              </button>
              <button className="secondary" onClick={dialog.close}>
                Not now
              </button>
            </div>
          </Dialog>
        ))}
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
    refetchInterval: 2000,
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
      coordinates: "slide",
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
  const [fullscreen, setFullscreen] = useState(false);
  const presenter = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const changed = () =>
      setFullscreen(document.fullscreenElement === presenter.current);
    document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, []);
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
      if (document.querySelector("dialog[open]")) return;
      if (
        e.target instanceof HTMLElement &&
        (["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName) ||
          e.target.isContentEditable)
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
              aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen slides"}
              onClick={() => {
                const operation = document.fullscreenElement
                  ? document.exitFullscreen()
                  : presenter.current?.requestFullscreen();
                operation?.catch(() =>
                  useUI.getState().setNotice("Fullscreen could not be opened."),
                );
              }}
            >
              {fullscreen ? <Minimize size={18} /> : <Expand size={18} />}
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
        <div className="presenter-surface" ref={presenter}>
          {slides}
        </div>
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
          <section className="panel presenter-surface" ref={presenter}>
            {slides}
          </section>
          {teacher ? (
            <ExploreDiagram
              key={`${id}:${index}`}
              diagrams={data.diagrams}
              index={index}
            />
          ) : (
            <StudentActivityAlerts
              sessionId={id!}
              courseId={s.course_id}
              poll={data.poll}
              diagram={data.diagrams?.find(
                (diagram) => diagram.slide_index === index,
              )}
              live={s.state === "live"}
            />
          )}
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
          {teacher && data.poll && (
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
