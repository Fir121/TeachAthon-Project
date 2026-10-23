import { useState } from "react";
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
  const group = useAction(() =>
    api(`/sessions/${sessionId}/clusters`, { question_ids: selected }),
  );
  const resolve = useAction((id: string) => api(`/clusters/${id}/resolve`, {}));
  const split = useAction(({ id, ids }: { id: string; ids: string[] }) =>
    api(`/clusters/${id}/split`, { question_ids: ids }),
  );
  return (
    <section className="panel">
      <div className="row-between">
        <h2>Question queue</h2>
        {selected.length > 1 && (
          <button
            className="secondary"
            disabled={group.isPending}
            onClick={() =>
              group.mutate(undefined, { onSuccess: () => setSelected([]) })
            }
          >
            Group selected ({selected.length})
          </button>
        )}
      </div>
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
      <Failure error={q.error} />
      {q.data?.groups.map((g, i) => (
        <div className="queue-group" key={g.id || g.questions[0].id}>
          <div className="row-between">
            <strong>{g.canonical_text}</strong>
            {g.questions.length > 1 && (
              <span className="status">{g.questions.length} questions</span>
            )}
          </div>
          {g.id && (
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
              <label className="check small">
                <input
                  type="checkbox"
                  checked={selected.includes(question.id)}
                  onChange={(e) =>
                    setSelected((ids) =>
                      e.target.checked
                        ? [...ids, question.id]
                        : ids.filter((id) => id !== question.id),
                    )
                  }
                />
                Select for grouping
              </label>
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
            <span className="eyebrow">
              {f.classification}
              {f.ai_modified ? " · AI edited" : ""}
            </span>
            <p>{f.text_rewritten || f.text_original}</p>
            {f.ai_modified && (
              <details>
                <summary>Original wording</summary>
                <p>{f.text_original}</p>
              </details>
            )}
          </div>
        ))}
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
