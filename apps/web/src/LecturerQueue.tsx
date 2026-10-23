import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, useAction } from "./api";
import { QuestionCard, type Question } from "./Questions";
import { Failure } from "./CoursePage";
type Group = {
  id: string | null;
  canonical_text: string;
  questions: Question[];
};
type Queue = {
  groups: Group[];
  feedback: {
    id: string;
    author: string;
    text_original: string;
    text_rewritten: string | null;
    classification: string;
    ai_modified: boolean;
    linked_question_id: string | null;
  }[];
  ai_jobs: { type: string; status: string; error: string | null }[];
};
export default function LecturerQueue({ sessionId }: { sessionId: string }) {
  const [sort, setSort] = useState("unanswered");
  const [grouping, setGrouping] = useState(false);
  const groupingHelp =
    "AI automatically groups related questions. Use this mode to manually group questions that should share an answer.";
  const [selected, setSelected] = useState<string[]>([]),
    [open, setOpen] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ["lecturer-queue", sessionId, sort],
    queryFn: () =>
      api<Queue>(`/sessions/${sessionId}/lecturer-queue?sort=${sort}`),
    refetchInterval: 4000,
  });
  const routeFeedback = useAction((id: string) =>
    api(`/feedback/${id}/route`, {}),
  );
  const availableIds = new Set(
    q.data?.groups.flatMap((group) =>
      group.questions.map((question) => question.id),
    ) || [],
  );
  const activeSelection = selected.filter((id) => availableIds.has(id));
  const group = useAction(() =>
    api(`/sessions/${sessionId}/clusters`, { question_ids: activeSelection }),
  );
  useEffect(() => {
    if (!grouping) return;
    function cancel(event: KeyboardEvent) {
      if (event.key === "Escape" && !group.isPending) {
        setGrouping(false);
        setSelected([]);
      }
    }
    window.addEventListener("keydown", cancel);
    return () => window.removeEventListener("keydown", cancel);
  }, [grouping, group.isPending]);
  const resolve = useAction((id: string) => api(`/clusters/${id}/resolve`, {}));
  const split = useAction(({ id, ids }: { id: string; ids: string[] }) =>
    api(`/clusters/${id}/split`, { question_ids: ids }),
  );
  return (
    <section className="panel">
      <div className="row-between queue-heading">
        <h2>Question queue</h2>
        {!grouping ? (
          <button
            className="secondary"
            title={groupingHelp}
            aria-describedby="grouping-help"
            onClick={() => {
              group.reset();
              setSelected([]);
              setGrouping(true);
            }}
          >
            Group questions
          </button>
        ) : (
          <div className="actions">
            <button
              className="secondary"
              disabled={group.isPending || activeSelection.length < 2}
              onClick={() =>
                group.mutate(undefined, {
                  onSuccess: () => {
                    setSelected([]);
                    setGrouping(false);
                  },
                })
              }
            >
              Group selected ({activeSelection.length})
            </button>
            <button
              className="text-button"
              disabled={group.isPending}
              onClick={() => {
                setGrouping(false);
                setSelected([]);
              }}
            >
              Cancel grouping
            </button>
          </div>
        )}
      </div>
      <p
        id="grouping-help"
        className={grouping ? "muted small spaced" : "sr-only"}
      >
        {groupingHelp}
      </p>
      {grouping && (
        <p className="muted small spaced" role="status">
          Select at least two questions. Cancel or press Escape to leave
          grouping mode.
        </p>
      )}
      <p className="muted small spaced">
        This view can combine private and public questions. It is never shown on
        the presenter screen.
      </p>
      <label className="spaced">
        Show questions
        <select value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="unanswered">Unanswered</option>
          <option value="newest">All, newest first</option>
          <option value="votes">Most upvoted</option>
        </select>
      </label>
      <Failure error={q.error || group.error || resolve.error || split.error} />
      {q.data?.groups.map((g, i) => (
        <div className="queue-group" key={g.id || g.questions[0].id}>
          {g.questions.length > 1 && (
            <div className="row-between">
              <strong>{g.canonical_text}</strong>
              {g.questions.length > 1 && (
                <span className="status">{g.questions.length} questions</span>
              )}
            </div>
          )}
          {g.id && g.questions.length > 1 && (
            <div className="actions">
              <button
                className="text-button"
                onClick={() => resolve.mutate(g.id!)}
              >
                Mark group answered
              </button>
              {g.questions.length > 1 && (
                <button
                  className="text-button"
                  onClick={() =>
                    split.mutate({
                      id: g.id!,
                      ids: g.questions.map((q) => q.id),
                    })
                  }
                >
                  Split group
                </button>
              )}
            </div>
          )}
          {g.questions.map((question) => (
            <div key={question.id}>
              {grouping && (
                <label className="check small grouping-selection">
                  <input
                    type="checkbox"
                    disabled={group.isPending}
                    aria-label={`Select question: ${question.text}`}
                    checked={activeSelection.includes(question.id)}
                    onChange={(e) =>
                      setSelected((ids) =>
                        e.target.checked
                          ? [...ids, question.id]
                          : ids.filter((id) => id !== question.id),
                      )
                    }
                  />
                  Include in group
                </label>
              )}
              <QuestionCard
                question={question}
                teacher
                open={open === question.id}
                onOpen={() =>
                  setOpen(open === question.id ? null : question.id)
                }
              />
            </div>
          ))}
        </div>
      ))}
      {q.data?.groups.length === 0 && (
        <p className="muted spaced">No unanswered questions.</p>
      )}
      <details className="spaced">
        <summary>Poll feedback & AI processing</summary>
        {q.data?.feedback.map((f) => (
          <div key={f.id} className="reply spaced">
            <p className="small">
              <strong>{f.author}</strong> · Lecturers only
            </p>
            <p className="feedback-original">{f.text_original}</p>
            <p className="muted small">
              {f.linked_question_id
                ? "Question sent to the private queue"
                : f.classification === "unclassified"
                  ? "Awaiting classification"
                  : "Feedback"}
            </p>
            {!f.linked_question_id && (
              <button
                className="text-button"
                disabled={routeFeedback.isPending}
                onClick={() => routeFeedback.mutate(f.id)}
              >
                Send to private question queue
              </button>
            )}
          </div>
        ))}
        <Failure error={routeFeedback.error} />
        {q.data?.ai_jobs
          .filter((j) => j.status === "failed" || j.status === "queued")
          .map((j, i) => (
            <p key={i} className="muted small">
              {j.type.replaceAll("_", " ")}: {j.status}{" "}
              {j.error && `· ${j.error}`}
            </p>
          ))}
      </details>
    </section>
  );
}
