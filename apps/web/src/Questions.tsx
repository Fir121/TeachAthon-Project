import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowUp,
  MessageCircle,
  Lock,
  CheckCircle2,
  Search,
  Send,
  X,
} from "lucide-react";
import { api, useAction, type User } from "./api";
import { Failure } from "./CoursePage";
export type Match = {
  source_id: string;
  source_type: string;
  question_id?: string;
  page_number?: number;
  title: string;
  excerpt: string;
  url: string;
  category: string;
  start_ms?: number;
  end_ms?: number;
  score: number;
};
export type Preflight = {
  preflight_token: string;
  status: string;
  error: string | null;
  matches: Match[];
  method: string;
  generated_answer: string | null;
};
export type Question = {
  id: string;
  text: string;
  original: string | null;
  ai_modified: boolean;
  author: string;
  anonymous: boolean;
  visibility: string;
  state: string;
  can_edit: boolean;
  votes: number | null;
  my_vote: boolean;
  session_id: string | null;
  created_at: string;
  match: {
    state: string;
    url?: string;
    start_ms?: number;
    end_ms?: number;
    excerpt?: string;
    possibly_addressed?: boolean;
  };
};
export function MatchCards({ matches }: { matches: Match[] }) {
  const vote = useAction((id: string) => api(`/questions/${id}/vote`, {}));
  return (
    <div className="match-list">
      {matches.map((m) => (
        <article
          className="match-card"
          key={m.source_type + m.source_id + String(m.start_ms)}
        >
          <span className="eyebrow">{m.category.replaceAll("_", " ")}</span>
          <h3>
            {m.title}
            {m.page_number ? ` · page ${m.page_number}` : ""}
          </h3>
          <p>{m.excerpt}</p>
          <a
            className="text-button"
            href={m.url}
            target="_blank"
            rel="noreferrer"
          >
            Open source ↗{" "}
            {m.start_ms !== undefined &&
              `· ${Math.floor(m.start_ms / 60000)}:${String(Math.floor(m.start_ms / 1000) % 60).padStart(2, "0")}`}
          </a>
          {m.question_id && m.category === "similar_public_question" && (
            <button
              className="secondary spaced"
              disabled={vote.isPending}
              onClick={() => vote.mutate(m.question_id!)}
            >
              Upvote this existing question
            </button>
          )}
        </article>
      ))}
    </div>
  );
}
export function AskFlow({
  courseId,
  sessionId,
  onClose,
  onPosted,
}: {
  courseId: string;
  sessionId?: string;
  onClose: () => void;
  onPosted?: (question: Question) => void;
}) {
  const [text, setText] = useState(""),
    [visibility, setVisibility] = useState("public"),
    [anonymous, setAnonymous] = useState(false),
    [result, setResult] = useState<Preflight | null>(null),
    [attempted, setAttempted] = useState(false);
  const payload = {
    text,
    visibility,
    anonymous,
    session_id: sessionId || null,
  };
  const preflight = useAction(() =>
    api<Preflight>(`/courses/${courseId}/questions/preflight`, payload),
  );
  const post = useAction(async () => {
    const checked =
      result ||
      (await api<Preflight>(
        `/courses/${courseId}/questions/preflight`,
        payload,
      ));
    return api<Question>(`/courses/${courseId}/questions`, {
      ...payload,
      preflight_token: checked.preflight_token,
    });
  });
  function reset() {
    setResult(null);
    setAttempted(false);
    preflight.reset();
  }
  return (
    <section className="panel ask-flow" aria-label="Ask a question">
      <div className="row-between">
        <div>
          <span className="eyebrow">THERE’S ROOM FOR YOUR QUESTION</span>
          <h2>What’s on your mind?</h2>
        </div>
        <button
          className="icon-button"
          aria-label="Close question form"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setAttempted(true);
          preflight.mutate(undefined, { onSuccess: setResult });
        }}
      >
        <label>
          Your question
          <textarea
            autoFocus
            disabled={preflight.isPending || post.isPending}
            value={text}
            minLength={3}
            maxLength={8000}
            required
            onChange={(e) => {
              setText(e.target.value);
              reset();
            }}
            placeholder="Ask about something you’d like to understand…"
          />
        </label>
        <div className="ask-options">
          <label>
            Who can see it?
            <select
              disabled={preflight.isPending || post.isPending}
              value={visibility}
              onChange={(e) => {
                setVisibility(e.target.value);
                reset();
              }}
            >
              <option value="public">Everyone in this course</option>
              <option value="private">Lecturers only</option>
            </select>
          </label>
          <label className="check">
            <input
              type="checkbox"
              disabled={preflight.isPending || post.isPending}
              checked={anonymous}
              onChange={(e) => {
                setAnonymous(e.target.checked);
                reset();
              }}
            />
            Ask anonymously
          </label>
        </div>
        {anonymous && (
          <p className="muted small">
            Your identity is not saved with this question. You won’t be able to
            edit or delete it later.
          </p>
        )}
        {visibility === "private" && (
          <p className="muted small">
            Only course lecturers can read your question and its replies.
          </p>
        )}
        <button
          className="primary"
          disabled={preflight.isPending || post.isPending}
        >
          <Search size={16} />
          {preflight.isPending
            ? "Checking course sources…"
            : attempted
              ? "Retry source search"
              : "Check existing explanations"}
        </button>
      </form>
      <Failure error={preflight.error} />
      {result && (
        <div className="preflight-results">
          <h3>
            {result.matches.length
              ? "Related course sources"
              : "No suitable source found"}
          </h3>
          <p className="muted small">
            {result.error ||
              `Checked using ${result.method}. You can still post your original question.`}
          </p>
          {result.generated_answer && (
            <div className="panel">
              <strong>AI summary · verify against the sources</strong>
              <p>{result.generated_answer}</p>
            </div>
          )}
          <MatchCards matches={result.matches} />
        </div>
      )}
      {attempted && !preflight.isPending && (
        <button
          className="primary spaced"
          disabled={post.isPending || text.length < 3}
          onClick={() =>
            post.mutate(undefined, {
              onSuccess: (question) => {
                onPosted?.(question);
                onClose();
              },
            })
          }
        >
          <Send size={16} />
          {post.isPending ? "Posting…" : "Post my question anyway"}
        </button>
      )}
      <Failure error={post.error} />
    </section>
  );
}
export function QuestionFeed({
  courseId,
  sessionId,
  teacher = false,
  questions: provided,
}: {
  courseId: string;
  sessionId?: string;
  teacher?: boolean;
  questions?: Question[];
}) {
  const [receipt, setReceipt] = useState<Question | null>(null);
  const [params] = useSearchParams();
  const [asking, setAsking] = useState(false),
    [sort, setSort] = useState("newest"),
    [search, setSearch] = useState(""),
    [open, setOpen] = useState<string | null>(params.get("question"));
  const q = useQuery({
    queryKey: ["questions", courseId, sessionId, sort, search],
    queryFn: () =>
      api<Question[]>(
        `/courses/${courseId}/questions?${new URLSearchParams({ ...(sessionId ? { session_id: sessionId } : {}), sort, q: search })}`,
      ),
    refetchInterval: 5000,
    enabled: !provided,
  });
  const questions = provided || q.data;
  return (
    <section>
      <div className="row-between">
        <div>
          <h2>{sessionId ? "Class questions" : "Course discussions"}</h2>
          <p className="muted small">
            {teacher
              ? "Hear what your students are thinking."
              : "Good questions belong here."}
          </p>
        </div>
        <button className="primary" onClick={() => setAsking(!asking)}>
          <MessageCircle size={16} />
          Ask a question
        </button>
      </div>
      {asking && (
        <div className="spaced">
          <AskFlow
            courseId={courseId}
            sessionId={sessionId}
            onPosted={(question) => {
              if (question.visibility === "private" && !question.anonymous)
                setReceipt(question);
            }}
            onClose={() => setAsking(false)}
          />
        </div>
      )}
      {!sessionId && (
        <div className="feed-filters">
          <label>
            <span className="sr-only">Search discussions</span>
            <input
              placeholder="Find a discussion…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <label>
            <span className="sr-only">Sort questions</span>
            <select value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="newest">Newest first</option>
              <option value="votes">Most upvoted</option>
              <option value="unanswered">Unanswered</option>
            </select>
          </label>
        </div>
      )}
      {receipt && (
        <div className="panel spaced">
          <h3>Your submission receipt</h3>
          <p className="muted small">
            This is the question you just sent. It stays out of the class feed.
            You can edit or delete this named submission here; private replies
            are lecturer-only.
          </p>
          <QuestionCard
            question={receipt}
            teacher={false}
            open={false}
            onOpen={() => {}}
            onEdited={setReceipt}
            onRemoved={() => setReceipt(null)}
          />
        </div>
      )}
      <Failure error={q.error} />
      <div className="question-feed">
        {questions?.map((question) => (
          <QuestionCard
            key={question.id}
            question={question}
            teacher={teacher}
            open={open === question.id}
            onOpen={() => setOpen(open === question.id ? null : question.id)}
          />
        ))}
      </div>
      {questions?.length === 0 && (
        <div className="empty panel spaced">
          <MessageCircle />
          <p>
            {teacher
              ? "Questions will appear here as students ask."
              : "Something unclear? Be the first to ask."}
          </p>
        </div>
      )}
    </section>
  );
}
export function QuestionCard({
  question: q,
  teacher,
  open,
  onOpen,
  onEdited,
  onRemoved,
}: {
  question: Question;
  teacher: boolean;
  open: boolean;
  onOpen: () => void;
  onEdited?: (question: Question) => void;
  onRemoved?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const vote = useAction(() =>
    api(
      `/questions/${q.id}/vote`,
      q.my_vote ? undefined : {},
      q.my_vote ? "DELETE" : "POST",
    ),
  );
  const resolve = useAction(() => api(`/questions/${q.id}/resolve`, {}));
  const remove = useAction(() =>
    api(`/questions/${q.id}`, undefined, "DELETE"),
  );
  const dismiss = useAction(() => api(`/questions/${q.id}/dismiss`, {}));
  const edit = useAction((text: string) =>
    api<Question>(`/questions/${q.id}`, { text }, "PATCH"),
  );
  const editMatch = useAction((data: { start_ms: number; end_ms: number }) =>
    api(`/answer-sources/${q.id}`, data, "PATCH"),
  );
  const removeMatch = useAction(() =>
    api(`/answer-sources/${q.id}`, undefined, "DELETE"),
  );
  return (
    <article
      className={`question-card ${q.visibility === "private" ? "private" : ""}`}
    >
      <div className="question-main">
        {q.visibility === "public" && (
          <button
            className={`vote-button ${q.my_vote ? "voted" : ""}`}
            disabled={vote.isPending}
            aria-label={`Upvote question: ${q.text}`}
            aria-pressed={q.my_vote}
            onClick={() => vote.mutate()}
          >
            <ArrowUp size={16} />
            <span>{q.votes}</span>
          </button>
        )}
        <div className="grow">
          <div className="question-meta">
            <span>{q.author}</span>
            {q.visibility === "private" && (
              <span>
                <Lock size={12} />
                Lecturers only
              </span>
            )}
            {q.state === "answered" && (
              <span className="answered">
                <CheckCircle2 size={13} />
                Answered by lecturer
              </span>
            )}
            {q.ai_modified && <span>AI edited</span>}
          </div>
          {editing ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                edit.mutate(String(new FormData(e.currentTarget).get("text")), {
                  onSuccess: (updated) => {
                    setEditing(false);
                    onEdited?.(updated);
                  },
                });
              }}
            >
              <label>
                Edit question
                <textarea
                  name="text"
                  defaultValue={q.text}
                  required
                  minLength={3}
                />
              </label>
              <div className="actions">
                <button className="primary">Save</button>
                <button type="button" onClick={() => setEditing(false)}>
                  Cancel
                </button>
              </div>
            </form>
          ) : q.visibility === "private" && !teacher ? (
            <p className="question-body">{q.text}</p>
          ) : (
            <button className="question-body" onClick={onOpen}>
              {q.text}
            </button>
          )}
          {teacher && q.ai_modified && (
            <details>
              <summary>Original wording</summary>
              <p>{q.original}</p>
            </details>
          )}
          {q.match.state === "ready" && q.match.url && (
            <div>
              <a href={q.match.url} className="text-button">
                Suggested recording excerpt ↗
              </a>
              {teacher && (
                <>
                  <p className="muted small">
                    {q.match.possibly_addressed
                      ? "Possibly addressed · review before marking answered"
                      : "Suggested match to actual recorded speech"}
                  </p>
                  <button
                    className="danger"
                    onClick={() => removeMatch.mutate()}
                  >
                    Remove excerpt link
                  </button>
                  <details>
                    <summary>Adjust excerpt time</summary>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const d = new FormData(e.currentTarget);
                        editMatch.mutate({
                          start_ms: Number(d.get("start")),
                          end_ms: Number(d.get("end")),
                        });
                      }}
                    >
                      <label>
                        Start offset (milliseconds)
                        <input
                          name="start"
                          type="number"
                          min={0}
                          defaultValue={q.match.start_ms}
                          required
                        />
                      </label>
                      <label>
                        End offset (milliseconds)
                        <input
                          name="end"
                          type="number"
                          min={1}
                          defaultValue={q.match.end_ms}
                          required
                        />
                      </label>
                      <button
                        className="secondary"
                        disabled={editMatch.isPending}
                      >
                        Save excerpt range
                      </button>
                    </form>
                  </details>
                </>
              )}
            </div>
          )}
          {q.state === "answered" && q.match.state === "pending" && (
            <p className="muted small">Answered · recording excerpt pending</p>
          )}
          <div className="question-actions">
            {(teacher || q.visibility === "public") && (
              <button onClick={onOpen}>
                {open ? "Hide discussion" : "View discussion"}
              </button>
            )}
            {teacher && q.state !== "answered" && (
              <button onClick={() => resolve.mutate()}>Mark answered</button>
            )}
            {teacher && (
              <button onClick={() => dismiss.mutate()}>Dismiss</button>
            )}
            {q.can_edit && (
              <>
                <button onClick={() => setEditing(true)}>Edit</button>
                <button
                  onClick={() =>
                    remove.mutate(undefined, { onSuccess: onRemoved })
                  }
                >
                  Delete
                </button>
              </>
            )}
          </div>
        </div>
      </div>
      {open && <Thread question={q} teacher={teacher} />}
    </article>
  );
}
function Thread({
  question: q,
  teacher,
}: {
  question: Question;
  teacher: boolean;
}) {
  const [editingReply, setEditingReply] = useState<string | null>(null);
  const editReply = useAction(({ id, body }: { id: string; body: string }) =>
    api(`/answers/${id}`, { body }, "PATCH"),
  );
  const removeReply = useAction((id: string) =>
    api(`/answers/${id}`, undefined, "DELETE"),
  );
  const answers = useQuery({
    queryKey: ["answers", q.id],
    queryFn: () =>
      api<
        {
          id: string;
          body: string;
          author: string;
          visibility: string;
          lecturer_authored: boolean;
          can_edit: boolean;
        }[]
      >(`/questions/${q.id}/answers`),
  });
  const reply = useAction((data: Record<string, FormDataEntryValue>) =>
    api(`/questions/${q.id}/comments`, {
      body: data.body,
      visibility:
        q.visibility === "private" ? "private" : data.visibility || "public",
      anonymous: data.anonymous === "on",
    }),
  );
  return (
    <div className="thread">
      <Failure error={answers.error} />
      {answers.data?.map((a) => (
        <article className="reply" key={a.id}>
          <div className="question-meta">
            <strong>{a.author}</strong>
            {a.lecturer_authored && <span className="answered">Lecturer</span>}
            {a.visibility === "private" && <span>Private reply</span>}
          </div>
          <p>{a.body}</p>
          {a.can_edit && (
            <div className="question-actions">
              <button
                onClick={() =>
                  setEditingReply(editingReply === a.id ? null : a.id)
                }
              >
                Edit reply
              </button>
              <button onClick={() => removeReply.mutate(a.id)}>
                Delete reply
              </button>
            </div>
          )}
          {editingReply === a.id && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                editReply.mutate(
                  {
                    id: a.id,
                    body: String(new FormData(e.currentTarget).get("body")),
                  },
                  { onSuccess: () => setEditingReply(null) },
                );
              }}
            >
              <label>
                Edit reply
                <textarea name="body" defaultValue={a.body} required />
              </label>
              <button className="secondary" disabled={editReply.isPending}>
                Save reply
              </button>
            </form>
          )}
        </article>
      ))}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          reply.mutate(Object.fromEntries(new FormData(form)), {
            onSuccess: () => form.reset(),
          });
        }}
      >
        <label>
          {teacher ? "Write an answer" : "Add to the discussion"}
          <textarea name="body" required maxLength={8000} />
        </label>
        <div className="actions">
          {teacher && q.visibility === "public" && (
            <label>
              Visibility
              <select name="visibility">
                <option value="public">Course members</option>
                <option value="private">Lecturers only</option>
              </select>
            </label>
          )}
          <label className="check">
            <input name="anonymous" type="checkbox" />
            Anonymous
          </label>
          <button className="primary" disabled={reply.isPending}>
            {teacher ? "Post answer" : "Post reply"}
          </button>
        </div>
      </form>
    </div>
  );
}
