import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowUp,
  MessageCircle,
  Lock,
  CheckCircle2,
  Send,
  X,
} from "lucide-react";
import { api, useAction, useUI, type User } from "./api";
import { Failure } from "./CoursePage";
import { Dialog, useDialog } from "./Dialog";
export type Match = {
  source_id: string;
  source_type: "document" | "recording" | "discussion";
  question_id?: string | null;
  title: string;
  url: string;
  locations: {
    page_number: number | null;
    start_ms: number | null;
    end_ms: number | null;
    url: string;
  }[];
  audio_available?: boolean | null;
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
  can_delete: boolean;
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
function SourceMatch({
  match: m,
  onVote,
  voting,
}: {
  match: Match;
  onVote: (id: string) => Promise<unknown>;
  voting: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [voted, setVoted] = useState(false);
  const timestamp = (value: number) =>
    `${Math.floor(value / 60000)}:${String(Math.floor(value / 1000) % 60).padStart(2, "0")}`;
  const labels = {
    document: "Course material",
    recording:
      m.audio_available === false ? "Lecture transcript" : "Recorded teaching",
    discussion: "Public discussion",
  };
  return (
    <article className="match-card">
      <div className="source-meta">
        <span>{labels[m.source_type]}</span>
      </div>
      <h3>
        <a href={m.url} target="_blank" rel="noreferrer">
          {m.title}
        </a>
      </h3>
      {m.locations.length > 0 && (
        <nav
          className="source-locations"
          aria-label={`Matching locations in ${m.title}`}
        >
          {(expanded ? m.locations : m.locations.slice(0, 5)).map(
            (location) => (
              <a
                className="source-location"
                key={location.url}
                href={location.url}
                target="_blank"
                rel="noreferrer"
              >
                {location.page_number !== null
                  ? `Page ${location.page_number}`
                  : location.start_ms !== null
                    ? timestamp(location.start_ms)
                    : "Open source"}
              </a>
            ),
          )}
        </nav>
      )}
      <div className="source-actions">
        <a
          className="button secondary"
          href={m.url}
          target="_blank"
          rel="noreferrer"
        >
          Open source ↗
        </a>
        {m.locations.length > 5 && (
          <button
            className="text-button"
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded
              ? "Show fewer locations"
              : `Show ${m.locations.length - 5} more locations`}
          </button>
        )}
        {m.question_id && (
          <button
            className="secondary"
            disabled={voting || voted}
            onClick={async () => {
              try {
                await onVote(m.question_id!);
                setVoted(true);
              } catch {
                /* Shared error state offers retry. */
              }
            }}
          >
            {voted ? "Upvoted" : "Upvote this existing question"}
          </button>
        )}
      </div>
    </article>
  );
}
export function MatchCards({ matches }: { matches: Match[] }) {
  const vote = useAction((id: string) => api(`/questions/${id}/vote`, {}));
  return (
    <div className="match-list">
      <Failure error={vote.error} />
      {matches.map((m) => (
        <SourceMatch
          key={m.source_type + m.source_id}
          match={m}
          onVote={vote.mutateAsync}
          voting={vote.isPending}
        />
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
  onPosted?: (question: Question, noMatches: boolean) => void;
}) {
  const [text, setText] = useState("");
  const [submissionId, setSubmissionId] = useState(() => crypto.randomUUID());
  const [result, setResult] = useState<Preflight | null>(null);
  const [attempted, setAttempted] = useState(false);
  const busy = useRef(false);
  const payload = {
    text,
    session_id: sessionId || null,
    submission_id: submissionId,
  };
  const post = useAction((checked: Preflight) =>
    api<Question>(`/courses/${courseId}/questions`, {
      ...payload,
      preflight_token: checked.preflight_token,
    }),
  );
  async function publish(checked: Preflight, noMatches = false) {
    const question = await post.mutateAsync(checked);
    onPosted?.(question, noMatches);
    onClose();
  }
  const preflight = useAction(() =>
    api<Preflight>(`/courses/${courseId}/questions/preflight`, payload),
  );
  async function check() {
    if (busy.current) return;
    busy.current = true;
    setAttempted(true);
    try {
      const checked = await preflight.mutateAsync();
      setResult(checked);
      if (
        checked.status === "complete" &&
        !checked.error &&
        checked.matches.length === 0
      )
        await publish(checked, true);
    } catch {
      /* Mutation errors remain beside the draft. */
    } finally {
      busy.current = false;
    }
  }
  const pending = preflight.isPending || post.isPending;
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
          disabled={pending}
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void check();
        }}
      >
        <label>
          Your question
          <textarea
            autoFocus
            disabled={pending}
            value={text}
            minLength={3}
            maxLength={8000}
            required
            onChange={(e) => {
              setText(e.target.value);
              setSubmissionId(crypto.randomUUID());
              setResult(null);
              setAttempted(false);
              preflight.reset();
              post.reset();
            }}
            placeholder="Ask about something you’d like to understand…"
          />
        </label>
        <p className="muted small spaced">
          Your name and question are visible to course members. We check
          existing sources before posting.
        </p>
        <button className="primary spaced" disabled={pending}>
          <Send size={16} />
          {post.isPending
            ? "Posting…"
            : preflight.isPending
              ? "Checking course sources…"
              : attempted
                ? "Retry source search"
                : "Post question"}
        </button>
      </form>
      <Failure error={preflight.error} />
      {preflight.isPending && (
        <p role="status" className="muted small spaced">
          Checking course sources. This can take up to 30 seconds.
        </p>
      )}
      {result && (
        <div className="preflight-results">
          <h3>
            {result.matches.length
              ? "Related course sources"
              : "Source check finished"}
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
          <button
            className="primary spaced"
            disabled={pending}
            onClick={() => {
              if (busy.current) return;
              busy.current = true;
              void publish(result)
                .catch(() => {})
                .finally(() => {
                  busy.current = false;
                });
            }}
          >
            {post.isPending
              ? "Posting…"
              : result.status === "failed" || result.error
                ? "Post anyway"
                : "Post my question anyway"}
          </button>
        </div>
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
  const [postNotice, setPostNotice] = useState("");
  const [params] = useSearchParams();
  const dialog = useDialog();
  const [sort, setSort] = useState("newest"),
    [search, setSearch] = useState(""),
    [open, setOpen] = useState<string | null>(params.get("question"));
  const q = useQuery({
    queryKey: ["questions", courseId, sessionId, sort, search],
    queryFn: () =>
      api<Question[]>(
        `/courses/${courseId}/questions?${new URLSearchParams({ ...(sessionId ? { session_id: sessionId } : {}), sort, q: search })}`,
      ),
    refetchInterval: 2000,
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
    enabled: !provided,
  });
  const questions = provided || q.data;
  useEffect(() => {
    // A deep-linked thread may be outside the current filters, so verify deletion directly.
    if (!open || questions?.some((question) => question.id === open)) return;
    let cancelled = false;
    void api(`/questions/${open}`).catch((error) => {
      if (!cancelled && error.status === 404) {
        setOpen(null);
        useUI.getState().setNotice("This discussion is no longer available.");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [open, questions]);
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
        <button
          className="primary"
          onClick={(e) => dialog.open("ask-question", e.currentTarget)}
        >
          <MessageCircle size={16} />
          Ask a question
        </button>
      </div>
      {dialog.active === "ask-question" && (
        <Dialog title="Ask a question" onClose={dialog.close}>
          <AskFlow
            courseId={courseId}
            sessionId={sessionId}
            onPosted={(_, noMatches) =>
              setPostNotice(
                noMatches
                  ? "Question posted to course discussions. No similar course sources were found."
                  : "Question posted to course discussions.",
              )
            }
            onClose={dialog.close}
          />
        </Dialog>
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
      {postNotice && (
        <div className="panel row-between spaced" role="status">
          <p>{postNotice}</p>
          <button
            className="icon-button"
            aria-label="Dismiss confirmation"
            onClick={() => setPostNotice("")}
          >
            <X size={16} />
          </button>
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
              <button onClick={() => setEditing(true)}>Edit</button>
            )}
            {q.can_delete && (
              <button
                onClick={() =>
                  remove.mutate(undefined, { onSuccess: onRemoved })
                }
              >
                Delete
              </button>
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
    refetchInterval: 2000,
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
    queryFn: () =>
      api<
        {
          id: string;
          body: string;
          author: string;
          visibility: string;
          lecturer_authored: boolean;
          can_edit: boolean;
          can_delete: boolean;
        }[]
      >(`/questions/${q.id}/answers`),
  });
  const reply = useAction((data: Record<string, FormDataEntryValue>) =>
    api(`/questions/${q.id}/comments`, {
      body: data.body,
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
          {(a.can_edit || a.can_delete) && (
            <div className="question-actions">
              {a.can_edit && (
                <button
                  onClick={() =>
                    setEditingReply(editingReply === a.id ? null : a.id)
                  }
                >
                  Edit reply
                </button>
              )}
              {a.can_delete && (
                <button onClick={() => removeReply.mutate(a.id)}>
                  Delete reply
                </button>
              )}
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
          <button className="primary" disabled={reply.isPending}>
            {teacher ? "Post answer" : "Post reply"}
          </button>
        </div>
      </form>
    </div>
  );
}
