import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronRight,
  Expand,
  Lightbulb,
  Check,
  LoaderCircle,
} from "lucide-react";
import { api, ApiError, queryClient, useAction } from "./api";
import { Dialog, FormActions } from "./Dialog";
import { Failure } from "./CoursePage";
import DiagramFrame, { type FrameStatus } from "./DiagramFrame";

export type Diagram = {
  id: string;
  slide_index: number;
  title: string;
  summary: string;
  instructions: string;
  accessibility_description: string;
  render_url: string;
};
type Job = { status: string; attempts: number; error: string | null };
export type Revision = Diagram & {
  status: string;
  source_matches: boolean;
  feedback: string;
  created_at?: string;
  job: Job;
};
type Suggestion = {
  slide_index: number;
  title: string;
  learning_benefit: string;
  interaction: string;
  confidence: string;
  rationale: string;
};
export type Preparation = {
  locked: boolean;
  analysis: {
    id: string;
    job: Job;
    completed_pages: number;
    total_pages: number;
    source_matches: boolean;
    input_note: string;
    suggestions: Suggestion[];
  } | null;
  revisions: Revision[];
};
type Slide = { index: number; image_url: string };

export function InteractiveDiagramViewer({
  diagram,
  onClose,
  children,
  sourceImageUrl,
  onRunningChange,
}: {
  diagram: Diagram;
  onClose: () => void;
  children?: ReactNode;
  sourceImageUrl?: string;
  onRunningChange?: (running: boolean) => void;
}) {
  const [reset, setReset] = useState(0);
  const [status, setStatus] = useState<FrameStatus>("loading");
  const [source, setSource] = useState(false);
  useEffect(() => {
    onRunningChange?.(status === "ready");
  }, [status, onRunningChange]);
  useEffect(() => {
    setStatus("loading");
    setSource(false);
  }, [diagram.id]);
  return (
    <Dialog
      title={diagram.title || "Interactive diagram"}
      description={`Slide ${diagram.slide_index + 1} · Optional exploration`}
      onClose={onClose}
      className="diagram-dialog"
      initialFocusSelector="[aria-label='Close dialog']"
    >
      <div className="diagram-viewer">
        <div className="diagram-visual-stage">
          <DiagramFrame
            key={`${diagram.id}:${reset}`}
            diagram={diagram}
            onClose={onClose}
            onStatusChange={setStatus}
          />
          {source && sourceImageUrl && (
            <div className="diagram-source-expanded">
              <img
                src={sourceImageUrl}
                alt={`Original slide ${diagram.slide_index + 1}`}
              />
              <button className="secondary" onClick={() => setSource(false)}>
                Back to diagram
              </button>
            </div>
          )}
        </div>
        <aside
          className="diagram-context"
          aria-label="Diagram instructions and review"
        >
          {sourceImageUrl && (
            <button
              className="diagram-source-reference"
              onClick={() => setSource(!source)}
              aria-label={source ? "Back to diagram" : "Expand original slide"}
            >
              <img
                src={sourceImageUrl}
                alt={`Original slide ${diagram.slide_index + 1}`}
              />
              <span>
                <Expand size={14} /> Original slide {diagram.slide_index + 1}
              </span>
            </button>
          )}
          <div>
            <span className="eyebrow">LEARNING GOAL</span>
            <p>{diagram.summary}</p>
          </div>
          <div>
            <span className="eyebrow">TRY IT</span>
            <p>{diagram.instructions}</p>
          </div>
          {children}
          <details>
            <summary>Text alternative</summary>
            <p>{diagram.accessibility_description}</p>
          </details>
          <div className="diagram-viewer-actions">
            <button
              className="secondary"
              onClick={() => {
                setStatus("loading");
                setReset((r) => r + 1);
              }}
            >
              Reset diagram
            </button>
            <button className="text-button" onClick={onClose}>
              Close exploration
            </button>
          </div>
        </aside>
      </div>
    </Dialog>
  );
}

export function ExploreDiagram({
  diagrams,
  index,
}: {
  diagrams?: Diagram[];
  index: number;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const diagram = diagrams?.find((d) => d.slide_index === index);
  useEffect(() => setOpen(null), [index, diagram?.id]);
  if (!diagram) return null;
  return (
    <div className="diagram-explore spaced">
      <button
        className="secondary"
        onClick={(e) => {
          e.currentTarget.focus();
          setOpen(diagram.id);
        }}
      >
        Explore interactive diagram
      </button>
      {open === diagram.id && (
        <InteractiveDiagramViewer
          diagram={diagram}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}

function active(revision?: Revision) {
  return (
    revision?.status === "pending" &&
    ["queued", "processing"].includes(revision.job.status)
  );
}
export function preparationLabel(
  revision?: Revision,
  submitting = false,
  error?: string,
) {
  if (
    error ||
    revision?.status === "stale" ||
    (revision?.status === "pending" && revision.job.status === "failed")
  )
    return "Needs attention";
  if (submitting || (active(revision) && revision?.job.status === "queued"))
    return "Waiting";
  if (active(revision)) return "Generating";
  if (revision?.status === "preview") return "Ready to review";
  if (revision?.status === "approved") return "Approved";
  return "";
}

export function DiagramPreparation({
  lectureId,
  index,
  onSelect,
  slides,
  children,
}: {
  lectureId: string;
  index: number;
  onSelect: (index: number) => void;
  slides: Slide[];
  children?: ReactNode;
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [submitting, setSubmitting] = useState<Set<number>>(new Set());
  const [errors, setErrors] = useState<Record<number, string>>({});
  const inFlight = useRef(new Set<number>());
  const requestIds = useRef(
    new Map<number, { id: string; feedback: string }>(),
  );
  const [generation, setGeneration] = useState<{
    indices: number[];
    guidance: string;
  } | null>(null);
  const generationTrigger = useRef<HTMLElement | null>(null);
  const [view, setView] = useState<"slide" | "diagram">("slide");
  const [review, setReview] = useState<{
    ids: string[];
    position: number;
  } | null>(null);
  const [running, setRunning] = useState(false);
  const [refining, setRefining] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [decisionPending, setDecisionPending] = useState(false);
  const [decisionError, setDecisionError] = useState<Error | null>(null);
  const workspace = useRef<HTMLElement>(null);
  const reviewTrigger = useRef<HTMLElement | null>(null);
  const q = useQuery({
    queryKey: ["diagram-preparation", lectureId],
    queryFn: () =>
      api<Preparation>(`/lectures/${lectureId}/diagrams/preparation`),
    refetchInterval: 2000,
  });
  const analysis = useAction(() =>
    api(`/lectures/${lectureId}/diagrams/analyse`, {}),
  );
  const revisions = q.data?.revisions || [];
  const locked = q.data?.locked ?? true;
  const forSlide = (i: number) => revisions.filter((r) => r.slide_index === i);
  const latest = (i: number) => forSlide(i)[0];
  const approved = (i: number) =>
    forSlide(i).find((r) => r.status === "approved" && r.source_matches);
  const current = latest(index);
  const currentApproved = approved(index);
  const viewable = current?.status === "preview" ? current : currentApproved;
  const ready = slides
    .map((s) => latest(s.index))
    .filter(
      (r): r is Revision => !!r && r.status === "preview" && r.source_matches,
    );
  const working = slides.filter(
    (s) => active(latest(s.index)) || submitting.has(s.index),
  ).length;
  const failed = slides.filter(
    (s) =>
      preparationLabel(latest(s.index), false, errors[s.index]) ===
      "Needs attention",
  ).length;
  const approvedCount = slides.filter((s) => approved(s.index)).length;
  const a = q.data?.analysis;
  const analysing =
    analysis.isPending ||
    (a?.source_matches && ["queued", "processing"].includes(a.job.status));
  const suggestion = a?.source_matches
    ? a.suggestions.find((s) => s.slide_index === index)
    : undefined;
  const reviewId = review?.ids[review.position];
  const reviewRevision = revisions.find(
    (r) =>
      r.id === reviewId &&
      ["preview", "approved"].includes(r.status) &&
      r.source_matches,
  );
  const reviewLatest = reviewRevision
    ? latest(reviewRevision.slide_index)
    : undefined;

  useEffect(() => {
    setView("slide");
  }, [index]);
  useEffect(() => {
    setRunning(false);
    setRefining(false);
    setFeedback("");
    setDecisionError(null);
  }, [reviewId]);
  // Membership/source changes remove the preview rather than leaving stale JS visible.
  useEffect(() => {
    if (review && q.data && !reviewRevision) setReview(null);
  }, [review, q.data, reviewRevision]);

  function remember(revision: Revision) {
    queryClient.setQueryData<Preparation>(
      ["diagram-preparation", lectureId],
      (old) =>
        old
          ? {
              ...old,
              revisions: [
                revision,
                ...old.revisions.filter((r) => r.id !== revision.id),
              ],
            }
          : old,
    );
  }
  async function enqueue(indices: number[], refinement = "") {
    if (locked) return;
    const targets = indices.filter(
      (i) => !inFlight.current.has(i) && !active(latest(i)),
    );
    targets.forEach((i) => inFlight.current.add(i));
    setSubmitting((old) => new Set([...old, ...targets]));
    setErrors((old) =>
      Object.fromEntries(
        Object.entries(old).filter(([i]) => !targets.includes(Number(i))),
      ),
    );
    for (const i of targets) {
      let request = requestIds.current.get(i);
      if (!request || request.feedback !== refinement) {
        request = { id: crypto.randomUUID(), feedback: refinement };
        requestIds.current.set(i, request);
      }
      try {
        const revision = await api<Revision>(
          `/lectures/${lectureId}/diagrams/generate`,
          { request_id: request.id, slide_index: i, feedback: refinement },
        );
        remember(revision);
        requestIds.current.delete(i);
        setSelected((old) => {
          const next = new Set(old);
          next.delete(i);
          return next;
        });
      } catch (error) {
        setErrors((old) => ({
          ...old,
          [i]:
            error instanceof Error
              ? error.message
              : "Could not submit this slide. Retry generation.",
        }));
        if (
          error instanceof ApiError &&
          [401, 403, 409].includes(error.status)
        ) {
          targets
            .filter((n) => n !== i && inFlight.current.has(n))
            .forEach((n) => {
              inFlight.current.delete(n);
              setErrors((old) => ({
                ...old,
                [n]: "Generation was not submitted. Refresh preparation status before retrying.",
              }));
            });
          inFlight.current.delete(i);
          setSubmitting(
            (old) => new Set([...old].filter((n) => !targets.includes(n))),
          );
          break;
        }
      } finally {
        inFlight.current.delete(i);
        setSubmitting((old) => {
          const next = new Set(old);
          next.delete(i);
          return next;
        });
      }
    }
    void queryClient.invalidateQueries({
      queryKey: ["diagram-preparation", lectureId],
    });
  }
  function openGeneration(indices: number[], trigger: HTMLElement) {
    if (locked || !indices.length) return;
    trigger.focus();
    generationTrigger.current = trigger;
    const notes = indices.map(
      (i) =>
        requestIds.current.get(i)?.feedback ??
        (latest(i)?.job.status === "failed" ? latest(i).feedback : ""),
    );
    setGeneration({
      indices,
      guidance: notes.every((note) => note === notes[0]) ? notes[0] : "",
    });
  }
  function restoreWorkspaceFocus(trigger: HTMLElement | null) {
    window.requestAnimationFrame(() => {
      if (
        trigger?.isConnected &&
        !(trigger instanceof HTMLButtonElement && trigger.disabled)
      )
        trigger.focus();
      else
        workspace.current
          ?.querySelector<HTMLElement>('[aria-current="true"]')
          ?.focus();
    });
  }
  function closeGeneration() {
    setGeneration(null);
    restoreWorkspaceFocus(generationTrigger.current);
  }
  function openReview(ids: string[], trigger: HTMLElement) {
    trigger.focus();
    reviewTrigger.current = trigger;
    setRunning(false);
    setReview({ ids, position: 0 });
  }
  function closeReview() {
    setReview(null);
    restoreWorkspaceFocus(reviewTrigger.current);
  }
  async function decide(action: "approve" | "reject") {
    if (!reviewRevision || decisionPending || locked) return;
    setDecisionPending(true);
    setDecisionError(null);
    try {
      const result = await api<Revision>(
        `/diagrams/${reviewRevision.id}/${action}`,
        {},
      );
      queryClient.setQueryData<Preparation>(
        ["diagram-preparation", lectureId],
        (old) =>
          old
            ? {
                ...old,
                revisions: old.revisions.map((r) =>
                  r.id === result.id
                    ? result
                    : action === "approve" &&
                        r.slide_index === result.slide_index &&
                        r.status === "approved"
                      ? { ...r, status: "superseded" }
                      : r,
                ),
              }
            : old,
      );
      const remaining = review!.ids
        .slice(review!.position + 1)
        .filter((id) =>
          revisions.some(
            (r) => r.id === id && r.status === "preview" && r.source_matches,
          ),
        );
      setRunning(false);
      if (remaining.length) setReview({ ids: remaining, position: 0 });
      else closeReview();
      void queryClient.invalidateQueries({
        queryKey: ["diagram-preparation", lectureId],
      });
    } catch (error) {
      setDecisionError(
        error instanceof Error
          ? error
          : new Error("Could not save your decision. Retry."),
      );
    } finally {
      setDecisionPending(false);
    }
  }
  function choose(i: number) {
    onSelect(i);
  }
  const currentLabel = preparationLabel(
    current,
    submitting.has(index),
    errors[index],
  );
  const selectedTargets = [...selected].filter(
    (i) => !active(latest(i)) && !submitting.has(i),
  );
  return (
    <section
      className="diagram-preparation"
      ref={workspace}
      aria-label="Lecture preparation workspace"
    >
      <div className="preparation-start">
        <div className="preparation-publication">
          <Check size={16} />
          <strong>{approvedCount} approved</strong>
          <span>· {working + ready.length} unfinished</span>
          <span className="muted">
            Only approved diagrams are included when you start.
          </span>
        </div>
        {children}
      </div>
      <div className="diagram-workspace panel">
        <header className="diagram-workspace-heading">
          <div>
            <span className="eyebrow">OPTIONAL PREPARATION</span>
            <h2>Bring your slides to life</h2>
            <p className="muted small">
              Find useful interactions, select slides, then review and approve.
            </p>
          </div>
          <button
            className="secondary"
            disabled={locked || !!analysing}
            onClick={() => analysis.mutate()}
          >
            <Lightbulb size={16} />
            {analysis.isPending
              ? "Starting analysis…"
              : "Find interactive opportunities"}
          </button>
        </header>
        {q.isPending && (
          <p className="preparation-notice" role="status">
            Loading diagram preparation… Your lecture can start as usual.
          </p>
        )}
        {locked && q.data && (
          <p className="preparation-notice">
            This lecture has started. Diagrams are fixed for live teaching and
            replay.
          </p>
        )}
        {(analysis.isPending || a) && (
          <div className="analysis-progress" aria-live="polite">
            {analysis.isPending && !a ? (
              <p>
                <LoaderCircle className="diagram-spinner" size={16} />
                Submitting slide analysis…
              </p>
            ) : (
              a && (
                <>
                  <div className="row-between">
                    <span>
                      {locked && a.completed_pages < a.total_pages
                        ? "Analysis stopped at lecture start"
                        : a.job.status === "queued"
                          ? "Waiting to inspect slides"
                          : a.job.status === "processing"
                            ? "Finding useful interactions"
                            : a.job.status === "failed"
                              ? "Analysis needs attention"
                              : "Analysis complete"}
                    </span>
                    <span>
                      {a.completed_pages} / {a.total_pages} slides inspected
                    </span>
                  </div>
                  <progress
                    value={a.completed_pages}
                    max={Math.max(1, a.total_pages)}
                    aria-label="Slides inspected"
                  />
                  {a.job.status === "ready" &&
                    a.source_matches &&
                    a.suggestions.length === 0 && (
                      <p>
                        No useful interactive opportunities found. You can still
                        generate for any slide.
                      </p>
                    )}
                  {a.job.status === "ready" && a.suggestions.length > 0 && (
                    <p>
                      {a.suggestions.length} suggested slide
                      {a.suggestions.length === 1 ? "" : "s"}. Select the ones
                      you want to generate.
                    </p>
                  )}
                  {!a.source_matches && (
                    <p className="error">
                      Slide images changed. Find opportunities again for this
                      deck.
                    </p>
                  )}
                  {a.job.error && (
                    <p className="error" role="alert">
                      {a.job.error}
                    </p>
                  )}
                  {a.job.status === "failed" && (
                    <button
                      className="secondary"
                      disabled={locked || analysis.isPending}
                      onClick={() => analysis.mutate()}
                    >
                      Retry opportunity analysis
                    </button>
                  )}
                  <details>
                    <summary>Analysis details</summary>
                    <p>{a.input_note}</p>
                  </details>
                </>
              )
            )}
          </div>
        )}
        <div className="diagram-selection-toolbar">
          <div className="actions">
            <strong>{selected.size} selected</strong>
            <button
              className="text-button"
              disabled={!selected.size}
              onClick={() => setSelected(new Set())}
            >
              Clear selection
            </button>
            <button
              className="primary"
              disabled={locked || !selectedTargets.length}
              onClick={(e) => openGeneration(selectedTargets, e.currentTarget)}
            >
              Generate selected · {selectedTargets.length} slide
              {selectedTargets.length === 1 ? "" : "s"}
            </button>
          </div>
          <button
            className="secondary"
            disabled={!ready.length}
            onClick={(e) =>
              openReview(
                ready.map((r) => r.id),
                e.currentTarget,
              )
            }
          >
            Review ready previews{ready.length ? ` · ${ready.length}` : ""}
          </button>
        </div>
        <div className="diagram-activity" role="status">
          <span>{ready.length} ready to review</span>
          <span>{working} processing</span>
          <span>{failed} need attention</span>
          {working > 0 && (
            <span className="muted">
              You can keep browsing. Previews will not open automatically.
            </span>
          )}
        </div>
        <Failure error={analysis.error || q.error} />
        {q.isError && (
          <button className="secondary" onClick={() => q.refetch()}>
            Retry diagram status
          </button>
        )}
        <div className="diagram-workspace-body">
          <nav className="diagram-slide-rail" aria-label="Lecture slides">
            {slides.map((s) => {
              const row = latest(s.index),
                label = preparationLabel(
                  row,
                  submitting.has(s.index),
                  errors[s.index],
                );
              const suggested =
                a?.source_matches &&
                a.suggestions.some((p) => p.slide_index === s.index);
              return (
                <div
                  key={s.index}
                  className={`diagram-slide-item ${s.index === index ? "current" : ""}`}
                >
                  <button
                    className="diagram-slide-thumb"
                    aria-label={`View slide ${s.index + 1}`}
                    aria-current={s.index === index ? "true" : undefined}
                    onClick={() => choose(s.index)}
                  >
                    <img src={s.image_url} loading="lazy" alt="" />
                    <strong>Slide {s.index + 1}</strong>
                  </button>
                  <label className="diagram-slide-select">
                    <input
                      type="checkbox"
                      aria-label={`Select slide ${s.index + 1}`}
                      checked={selected.has(s.index)}
                      disabled={
                        locked || active(row) || submitting.has(s.index)
                      }
                      onChange={(e) =>
                        setSelected((old) => {
                          const next = new Set(old);
                          if (e.target.checked) next.add(s.index);
                          else next.delete(s.index);
                          return next;
                        })
                      }
                    />
                    Select
                  </label>
                  {label && (
                    <span
                      className={`diagram-state state-${label.toLowerCase().replaceAll(" ", "-")}`}
                    >
                      {["Waiting", "Generating"].includes(label) && (
                        <LoaderCircle size={12} className="diagram-spinner" />
                      )}
                      {label}
                    </span>
                  )}
                  {approved(s.index) && label !== "Approved" && (
                    <span className="diagram-state state-approved">
                      Approved version retained
                    </span>
                  )}
                  {suggested && (
                    <span className="diagram-suggested">
                      <Lightbulb size={11} />
                      Suggested
                    </span>
                  )}
                </div>
              );
            })}
          </nav>
          <div className="diagram-selected-slide">
            <div className="diagram-stage-toolbar">
              <div className="actions">
                <h3>Slide {index + 1}</h3>
                <div
                  className="diagram-view-tabs"
                  role="group"
                  aria-label="Preview view"
                >
                  <button
                    aria-pressed={view === "slide"}
                    onClick={() => setView("slide")}
                  >
                    Slide
                  </button>
                  <button
                    disabled={!viewable}
                    aria-pressed={view === "diagram"}
                    onClick={() => setView("diagram")}
                  >
                    Diagram
                  </button>
                </div>
              </div>
              <div className="actions">
                <button
                  className="icon-button"
                  aria-label="Previous slide"
                  disabled={!index}
                  onClick={() => choose(index - 1)}
                >
                  <ChevronLeft size={18} />
                </button>
                <button
                  className="icon-button"
                  aria-label="Next slide"
                  disabled={index + 1 >= slides.length}
                  onClick={() => choose(index + 1)}
                >
                  <ChevronRight size={18} />
                </button>
              </div>
            </div>
            <div className="diagram-inline-stage">
              {view === "diagram" && viewable ? (
                <DiagramFrame
                  key={viewable.id}
                  diagram={viewable}
                  onClose={() => setView("slide")}
                />
              ) : (
                <img
                  src={slides[index]?.image_url}
                  alt={`Slide ${index + 1}`}
                />
              )}
            </div>
            {viewable && (
              <button
                className="secondary diagram-expand"
                onClick={(e) => openReview([viewable.id], e.currentTarget)}
              >
                <Expand size={16} />
                {viewable.status === "preview"
                  ? "Expand preview"
                  : "Open approved diagram"}
              </button>
            )}
          </div>
          <aside
            className="diagram-slide-actions"
            aria-label={`Diagram preparation for slide ${index + 1}`}
          >
            <span className="eyebrow">INTERACTIVE DIAGRAM</span>
            {currentLabel && (
              <strong className="diagram-current-status">{currentLabel}</strong>
            )}
            {suggestion ? (
              <>
                <h3>{suggestion.title}</h3>
                <p>{suggestion.learning_benefit}</p>
                <p className="muted small">{suggestion.interaction}</p>
                <details>
                  <summary>Why this slide?</summary>
                  <p>{suggestion.rationale}</p>
                </details>
              </>
            ) : (
              !current && (
                <p className="muted">
                  Create a hands-on explanation for this slide, or select slides
                  to generate together.
                </p>
              )
            )}
            {current?.status === "preview" && (
              <button
                className="primary"
                onClick={(event) =>
                  openReview([current.id], event.currentTarget)
                }
              >
                Review preview
              </button>
            )}
            {active(current) || submitting.has(index) ? (
              <div className="diagram-generation-message">
                <LoaderCircle className="diagram-spinner" size={20} />
                <p>
                  {submitting.has(index)
                    ? "Submitting your request…"
                    : current?.job.status === "queued"
                      ? "Waiting for the worker. You can browse other slides."
                      : "Creating the interactive preview. You can browse other slides."}
                </p>
              </div>
            ) : (
              <button
                className={
                  current?.status === "preview" ? "secondary" : "primary"
                }
                disabled={locked}
                onClick={(e) => openGeneration([index], e.currentTarget)}
              >
                {current?.job.status === "failed" || errors[index]
                  ? "Retry this slide"
                  : current
                    ? "Generate replacement"
                    : "Generate interactive diagram"}
              </button>
            )}
            {(errors[index] || current?.job.error) && (
              <p className="error" role="alert">
                {errors[index] || current?.job.error}
              </p>
            )}
            {currentApproved && (
              <div className="diagram-approved-note">
                <Check size={15} />
                <span>
                  Approved for this lecture. A replacement needs your approval.
                </span>
              </div>
            )}
            {current?.status === "stale" && (
              <p className="muted small">
                This diagram no longer matches the slide, or finished after
                lecture start. Generate a new preview before a new lecture.
              </p>
            )}
            {forSlide(index).length > 1 && (
              <details>
                <summary>
                  Earlier versions · {forSlide(index).length - 1}
                </summary>
                {forSlide(index)
                  .slice(1)
                  .map((r) => (
                    <div className="diagram-history-item" key={r.id}>
                      <strong>{r.title || "Diagram"}</strong>
                      <span>{r.status}</span>
                      {["preview", "approved"].includes(r.status) &&
                        r.source_matches && (
                          <button
                            className="text-button"
                            onClick={(e) => openReview([r.id], e.currentTarget)}
                          >
                            View earlier preview
                          </button>
                        )}
                    </div>
                  ))}
              </details>
            )}
          </aside>
        </div>
      </div>
      {generation && (
        <Dialog
          title={
            generation.indices.length === 1
              ? "Generate interactive diagram"
              : "Generate interactive diagrams"
          }
          description={
            generation.indices.length === 1
              ? `Slide ${generation.indices[0] + 1} · Add a teaching focus, example or interaction, or leave blank.`
              : `${generation.indices.length} selected slides · Your notes will apply to each slide.`
          }
          onClose={closeGeneration}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (locked) return;
              const { indices, guidance } = generation;
              closeGeneration();
              void enqueue(indices, guidance.trim());
            }}
          >
            <label>
              Teaching notes (optional)
              <textarea
                rows={4}
                maxLength={1500}
                value={generation.guidance}
                onChange={(e) =>
                  setGeneration({ ...generation, guidance: e.target.value })
                }
                placeholder="For example: compare two cases side by side and let students change one parameter."
              />
            </label>
            <p className="muted small">
              These notes are sent to the AI along with the slide. Up to 1,500
              characters. You will review the preview before approving it.
            </p>
            <FormActions onCancel={closeGeneration}>
              <button className="primary" type="submit" disabled={locked}>
                {generation.indices.length === 1
                  ? "Generate preview"
                  : `Generate ${generation.indices.length} previews`}
              </button>
            </FormActions>
          </form>
        </Dialog>
      )}
      {reviewRevision && (
        <InteractiveDiagramViewer
          diagram={reviewRevision}
          sourceImageUrl={slides[reviewRevision.slide_index]?.image_url}
          onRunningChange={setRunning}
          onClose={closeReview}
        >
          <div className="diagram-review-actions">
            <p className="muted small">
              Try the controls and check the explanation before approving.{" "}
              {review!.ids.length - review!.position} in this review.
            </p>
            <button
              className="primary"
              disabled={locked || decisionPending || !running}
              onClick={() => void decide("approve")}
            >
              {decisionPending
                ? "Saving decision…"
                : reviewRevision.status === "approved"
                  ? "Keep approved and next"
                  : "Approve and next"}
            </button>
            <div className="actions">
              <button
                className="secondary"
                disabled={locked || decisionPending}
                onClick={() => void decide("reject")}
              >
                {reviewRevision.status === "approved"
                  ? "Unpublish diagram"
                  : "Reject and next"}
              </button>
              <button
                className="secondary"
                disabled={locked || decisionPending}
                onClick={() => setRefining(!refining)}
              >
                Refine
              </button>
            </div>
            {refining && (
              <div className="diagram-refinement">
                <label>
                  Refinement instructions (optional)
                  <textarea
                    maxLength={1500}
                    value={feedback}
                    onChange={(e) => setFeedback(e.target.value)}
                    placeholder="What should this interaction do differently?"
                  />
                </label>
                <button
                  className="secondary"
                  disabled={
                    locked ||
                    active(reviewLatest) ||
                    submitting.has(reviewRevision.slide_index)
                  }
                  onClick={() =>
                    void enqueue([reviewRevision.slide_index], feedback)
                  }
                >
                  Generate refined preview
                </button>
              </div>
            )}
            {reviewLatest?.id !== reviewRevision.id && (
              <div className="diagram-replacement-status" role="status">
                {active(reviewLatest) ? (
                  preparationLabel(reviewLatest) +
                  " a replacement. This version stays available."
                ) : reviewLatest?.status === "preview" ? (
                  <button
                    className="secondary"
                    onClick={() => {
                      setRunning(false);
                      setReview({
                        ids: [
                          reviewLatest.id,
                          ...review!.ids.slice(review!.position + 1),
                        ],
                        position: 0,
                      });
                    }}
                  >
                    Review replacement
                  </button>
                ) : reviewLatest?.job.status === "failed" ? (
                  <p className="error">{reviewLatest.job.error}</p>
                ) : null}
              </div>
            )}
            {errors[reviewRevision.slide_index] && (
              <p className="error" role="alert">
                {errors[reviewRevision.slide_index]}
              </p>
            )}
            <Failure error={decisionError} />
          </div>
        </InteractiveDiagramViewer>
      )}
    </section>
  );
}
