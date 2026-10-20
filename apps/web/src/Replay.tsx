import { useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, useAction } from "./api";
import { SlideView, type Snapshot, type Annotation } from "./Live";
import { Failure, Status } from "./CoursePage";
export type Segment = {
  id: string;
  text: string;
  start_ms: number;
  end_ms: number;
  timing: string;
};
export type TimelineEvent = {
  type: string;
  offset_ms: number;
  payload: {
    index?: number;
    stroke?: number[][];
    coordinates?: "stage" | "slide";
  };
};
export function replayAnnotations(
  timeline: TimelineEvent[],
  time: number,
): Annotation[] {
  return timeline
    .filter(
      (event) =>
        event.type === "annotation.added" &&
        event.offset_ms <= time &&
        typeof event.payload.index === "number",
    )
    .map((event) => ({
      index: event.payload.index!,
      stroke: event.payload.stroke || [],
      coordinates: event.payload.coordinates || "stage",
      offset_ms: event.offset_ms,
    }));
}
export const replaySlide = (
  timeline: { type: string; offset_ms: number; payload: { index?: number } }[],
  time: number,
) =>
  timeline
    .filter((e) => e.type === "slide.changed" && e.offset_ms <= time)
    .at(-1)?.payload.index || 0;
export function timeLabel(ms: number) {
  return `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;
}
export default function Replay() {
  const { id } = useParams(),
    [params] = useSearchParams(),
    [time, setTime] = useState(Number(params.get("t")) || 0),
    [search, setSearch] = useState(""),
    [playbackError, setPlaybackError] = useState(false),
    player = useRef<HTMLAudioElement>(null);
  const snapshot = useQuery({
    queryKey: ["snapshot", id],
    queryFn: () => api<Snapshot>(`/sessions/${id}/snapshot`),
  });
  const transcript = useQuery({
    queryKey: ["transcript", id],
    queryFn: () => api<Segment[]>(`/sessions/${id}/transcript`),
    refetchInterval: 5000,
  });
  const timeline = useQuery({
    queryKey: ["timeline", id],
    queryFn: () => api<TimelineEvent[]>(`/sessions/${id}/timeline`),
    staleTime: 0,
    refetchOnMount: "always",
  });
  const status = useQuery({
    queryKey: ["processing", id],
    queryFn: () =>
      api<{
        recording_state: string;
        transcript_state: string;
        jobs: { type: string; status: string; error: string | null }[];
      }>(`/sessions/${id}/processing-status`),
    refetchInterval: 3000,
  });
  const retry = useAction(() => api(`/sessions/${id}/audio/finalize`, {}));
  const data = snapshot.data,
    index = replaySlide(timeline.data || [], time);
  function seek(ms: number) {
    setTime(ms);
    if (player.current) player.current.currentTime = ms / 1000;
  }
  if (!data) return <Failure error={snapshot.error} />;
  return (
    <>
      <header className="archive-heading">
        <Link
          className="back"
          to={`/courses/${data.session.course_id}/lectures`}
        >
          ← Course lectures
        </Link>
        {data.lecture.banner_url && (
          <img
            className="lecture-banner"
            src={data.lecture.banner_url}
            alt={`${data.lecture.title} banner`}
          />
        )}
        <span className="eyebrow">LECTURE ARCHIVE</span>
        <h1>{data.lecture.title}</h1>
      </header>
      <Failure error={timeline.error} />
      {timeline.isError && (
        <button
          className="secondary spaced-bottom"
          onClick={() => timeline.refetch()}
        >
          Retry slide timeline
        </button>
      )}
      <div className="replay-layout">
        <section className="panel">
          <SlideView
            slide={data.slides[index]}
            index={index}
            annotations={replayAnnotations(timeline.data || [], time)}
          />
          <p className="muted small spaced">
            Slide {index + 1} · {timeLabel(time)}
          </p>
          {status.data?.recording_state === "ready" ? (
            <>
              <audio
                controls
                ref={player}
                src={`/api/v1/sessions/${id}/recording`}
                onTimeUpdate={(e) =>
                  setTime(e.currentTarget.currentTime * 1000)
                }
                onSeeking={(event) =>
                  setTime(event.currentTarget.currentTime * 1000)
                }
                onSeeked={(event) =>
                  setTime(event.currentTarget.currentTime * 1000)
                }
                onLoadedMetadata={() => seek(Number(params.get("t")) || 0)}
                onError={() => setPlaybackError(true)}
              />
              {playbackError && (
                <div className="error" role="alert">
                  Audio could not be loaded. Check your connection or course
                  access.
                  <button
                    className="secondary"
                    onClick={() => {
                      setPlaybackError(false);
                      player.current?.load();
                    }}
                  >
                    Retry playback
                  </button>
                </div>
              )}
              <label className="speed">
                Playback speed
                <select
                  defaultValue="1"
                  onChange={(e) => {
                    if (player.current)
                      player.current.playbackRate = Number(e.target.value);
                  }}
                >
                  {[0.75, 1, 1.25, 1.5, 2].map((v) => (
                    <option key={v} value={v}>
                      {v}×
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : (
            <div className="panel spaced">
              <Status status={status.data?.recording_state || "loading"} />
              <p className="muted">
                {data.session.recording_enabled
                  ? "Recording status reflects saved microphone audio. Transcript and slides are available as processing completes."
                  : "Recording was not enabled for this lecture. Slide timeline and available transcript remain accessible."}
              </p>
              {status.data?.jobs
                .filter((j) => j.error)
                .map((j, i) => (
                  <p className="error" key={i}>
                    {j.error}
                  </p>
                ))}
              {data.membership === "lecturer" &&
                ["failed", "no_audio"].includes(
                  status.data?.recording_state || "",
                ) && (
                  <button
                    className="secondary"
                    disabled={retry.isPending}
                    onClick={() => retry.mutate()}
                  >
                    Retry recording assembly
                  </button>
                )}
            </div>
          )}
          <Failure error={status.error} />
        </section>
        <section className="panel transcript-panel">
          <h2>Lecture transcript</h2>
          <p className="muted small">
            Times locate captured audio windows, rather than individual words.
          </p>
          <label className="spaced">
            Find in transcript
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search this lecture…"
            />
          </label>
          <Failure error={transcript.error} />
          <div className="transcript-list">
            {transcript.data
              ?.filter((t) =>
                t.text.toLowerCase().includes(search.toLowerCase()),
              )
              .map((t) => (
                <button
                  key={t.id}
                  className={`transcript-segment ${time >= t.start_ms && time < t.end_ms ? "current" : ""}`}
                  onClick={() => seek(t.start_ms)}
                >
                  <span>{timeLabel(t.start_ms)}</span>
                  <p>{t.text}</p>
                </button>
              ))}
          </div>
          {transcript.data?.length === 0 && (
            <p className="muted spaced">
              No transcript has been captured. A microphone connection and
              configured transcription provider are required.
            </p>
          )}
        </section>
      </div>
    </>
  );
}
