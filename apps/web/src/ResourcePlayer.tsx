import { lazy, Suspense, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { Failure, Status, type Resource } from "./CoursePage";
import { timeLabel, type Segment } from "./Replay";

const PdfViewer = lazy(() => import("./PdfViewer"));

export default function ResourcePlayer() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const [mediaError, setMediaError] = useState("");
  const [pageError, setPageError] = useState(false);
  const [pageView, setPageView] = useState(params.get("view") === "pages");
  const player = useRef<HTMLMediaElement | null>(null);
  const resource = useQuery({
    queryKey: ["resource", id],
    queryFn: () => api<Resource & { course_id: string }>(`/resources/${id}`),
    refetchInterval: (q) =>
      q.state.data?.process_status === "ready" ? false : 3000,
  });
  const isMedia =
    resource.data && ["audio", "video"].includes(resource.data.kind);
  const transcript = useQuery({
    queryKey: ["resource-transcript", id],
    queryFn: () => api<Segment[]>(`/resources/${id}/transcript`),
    enabled: !!isMedia,
    refetchInterval: 5000,
  });
  const isText = resource.data && ["txt", "json"].includes(resource.data.kind);
  const text = useQuery({
    queryKey: ["resource-text", id],
    enabled: !!isText,
    queryFn: async () => {
      const response = await fetch(`/api/v1/resources/${id}/download`, {
        credentials: "same-origin",
      });
      if (!response.ok)
        throw new Error("The source could not be loaded. Please retry.");
      return response.text();
    },
  });
  if (resource.isPending)
    return (
      <p role="status" className="muted">
        Loading source…
      </p>
    );
  if (!resource.data) return <Failure error={resource.error} />;
  const r = resource.data;
  const document = ["pdf", "pptx", "docx"].includes(r.kind);
  const page = Math.max(
    1,
    Math.min(r.page_count || 1, Math.trunc(Number(params.get("page"))) || 1),
  );
  function navigatePage(value: number) {
    setPageError(false);
    const next = new URLSearchParams(params);
    next.set("page", String(value));
    setParams(next);
  }
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
        "This browser cannot play the original codec. Download the source or try another browser.",
      ),
  };
  return (
    <>
      <Link className="back" to={`/courses/${r.course_id}/resources`}>
        ← Course resources
      </Link>
      <div className="source-heading">
        <div>
          <span className="eyebrow">{r.kind.toUpperCase()} SOURCE</span>
          <h1>{r.original_filename}</h1>
        </div>
        <a
          className="button secondary"
          href={`/api/v1/resources/${id}/download`}
        >
          Download original
        </a>
      </div>
      {r.error_message && <p className="error">{r.error_message}</p>}
      {document ? (
        <section className="document-viewer" aria-label="Document viewer">
          <div className="document-toolbar">
            <div className="actions">
              <button
                className="secondary"
                disabled={page <= 1}
                onClick={() => navigatePage(page - 1)}
              >
                Previous
              </button>
              <label className="page-picker">
                Page
                <select
                  aria-label="Document page"
                  value={page}
                  onChange={(e) => navigatePage(Number(e.target.value))}
                >
                  {Array.from({ length: r.page_count || 1 }, (_, i) => (
                    <option key={i} value={i + 1}>
                      {i + 1}
                    </option>
                  ))}
                </select>
                <span>of {r.page_count || "…"}</span>
              </label>
              <button
                className="secondary"
                disabled={page >= r.page_count}
                onClick={() => navigatePage(page + 1)}
              >
                Next
              </button>
            </div>
            <button
              className="secondary"
              onClick={() => {
                setPageError(false);
                setPageView(!pageView);
              }}
            >
              {pageView ? "Use PDF viewer" : "Use page images"}
            </button>
          </div>
          {(r.kind === "pdf" || r.process_status === "ready") && !pageView ? (
            <Suspense
              fallback={
                <p className="pdf-loading muted" role="status">
                  Loading PDF viewer…
                </p>
              }
            >
              <PdfViewer
                url={`/api/v1/resources/${id}/preview`}
                page={page}
                title={r.original_filename}
              />
            </Suspense>
          ) : pageView && r.page_count > 0 ? (
            <div className="document-page">
              {pageError ? (
                <p className="error" role="alert">
                  This page could not load.{" "}
                  <button
                    className="text-button"
                    onClick={() => setPageError(false)}
                  >
                    Retry
                  </button>
                </p>
              ) : (
                <img
                  key={`${id}-${page}`}
                  alt={`Page ${page} of ${r.original_filename}`}
                  src={`/api/v1/resources/${id}/pages/${page - 1}`}
                  onError={() => setPageError(true)}
                />
              )}
            </div>
          ) : (
            <div className="empty panel">
              <Status status={r.process_status} />
              <p>
                Page previews are available after document processing completes.
              </p>
              <button
                className="secondary spaced"
                onClick={() => resource.refetch()}
              >
                Refresh status
              </button>
            </div>
          )}
          <p className="viewer-help muted small">
            If the PDF cannot be rendered, choose “Use page images”. Search
            excerpts refer to the page shown here.
          </p>
        </section>
      ) : isMedia ? (
        <div className="replay-layout">
          <section className="panel">
            {r.kind === "video" ? (
              <video {...media} style={{ width: "100%" }} />
            ) : (
              <audio {...media} />
            )}
            {mediaError && <p className="error">{mediaError}</p>}
            <p className="muted small spaced">
              Processing: {r.process_status}. Transcript times locate 30-second
              input windows. Imported recordings have no assumed slide
              alignment.
            </p>
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
      ) : (
        <section className="panel spaced">
          <h2>Source text</h2>
          {text.isPending && (
            <p className="muted" role="status">
              Loading text…
            </p>
          )}
          <Failure error={text.error} />
          {text.data !== undefined && (
            <pre className="source-text">{text.data}</pre>
          )}
        </section>
      )}
    </>
  );
}
