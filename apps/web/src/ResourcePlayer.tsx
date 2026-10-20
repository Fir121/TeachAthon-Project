import { useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { Failure, type Resource } from "./CoursePage";
import { timeLabel, type Segment } from "./Replay";
export default function ResourcePlayer() {
  const { id } = useParams(),
    [params] = useSearchParams(),
    [mediaError, setMediaError] = useState(""),
    player = useRef<HTMLMediaElement | null>(null);
  const resource = useQuery({
    queryKey: ["resource", id],
    queryFn: () => api<Resource & { course_id: string }>(`/resources/${id}`),
  });
  const transcript = useQuery({
    queryKey: ["resource-transcript", id],
    queryFn: () => api<Segment[]>(`/resources/${id}/transcript`),
    refetchInterval: 5000,
  });
  if (!resource.data) return <Failure error={resource.error} />;
  const r = resource.data;
  const media = {
    controls: true,
    src: `/api/v1/resources/${id}/download?inline=true`,
    ref: (element: HTMLMediaElement | null) => {
      player.current = element;
    },
    onLoadedMetadata: () => {
      if (player.current)
        player.current.currentTime = (Number(params.get("t")) || 0) / 1000;
    },
    onError: () =>
      setMediaError(
        "This browser cannot play the original media codec. Download the source or try a current browser.",
      ),
  };
  return (
    <>
      <Link className="back" to={`/courses/${r.course_id}/resources`}>
        ← Course resources
      </Link>
      <h1>{r.original_filename}</h1>
      <div className="replay-layout">
        <section className="panel">
          {r.kind === "video" ? (
            <video {...media} style={{ width: "100%" }} />
          ) : r.kind === "audio" ? (
            <audio {...media} />
          ) : (
            <p>This resource is available as a download.</p>
          )}
          <a
            className="button secondary spaced"
            href={`/api/v1/resources/${id}/download`}
          >
            Download source
          </a>
          {mediaError && <p className="error spaced">{mediaError}</p>}
          <p className="muted small spaced">
            Processing: {r.process_status}. Transcript times locate 30-second
            input windows. Imported recordings have no assumed slide alignment.
          </p>
          {r.error_message && <p className="error">{r.error_message}</p>}
        </section>
        <section className="panel transcript-panel">
          <h2>Source transcript</h2>
          <div className="transcript-list">
            {transcript.data?.map((t) => (
              <button
                className="transcript-segment"
                key={t.id}
                onClick={() => {
                  if (player.current)
                    player.current.currentTime = t.start_ms / 1000;
                }}
              >
                <span>{timeLabel(t.start_ms)}</span>
                <p>{t.text}</p>
              </button>
            ))}
          </div>
          {transcript.data?.length === 0 && (
            <p className="muted spaced">
              No transcript is available yet. Check processing status in
              Resources.
            </p>
          )}
          <Failure error={transcript.error} />
        </section>
      </div>
    </>
  );
}
