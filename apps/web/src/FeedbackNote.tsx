import { useState } from "react";
import { api, useAction } from "./api";
import { MatchCards, type Preflight } from "./Questions";
import { Failure } from "./CoursePage";
export default function FeedbackNote({
  courseId,
  sessionId,
  pollId,
}: {
  courseId: string;
  sessionId: string;
  pollId: string;
}) {
  const [text, setText] = useState(""),
    [result, setResult] = useState<Preflight | null>(null),
    [attempted, setAttempted] = useState(false);
  const payload = {
    text,
    visibility: "private",
    anonymous: true,
    session_id: sessionId,
  };
  const search = useAction(() =>
    api<Preflight>(`/courses/${courseId}/questions/preflight`, payload),
  );
  const send = useAction(async () => {
    const proof =
      result ||
      (await api<Preflight>(
        `/courses/${courseId}/questions/preflight`,
        payload,
      ));
    return api(`/polls/${pollId}/feedback`, {
      text,
      preflight_token: proof.preflight_token,
    });
  });
  return (
    <details className="spaced">
      <summary>Add an anonymous note for the lecturer</summary>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setAttempted(true);
          search.mutate(undefined, { onSuccess: setResult });
        }}
      >
        <label>
          What would help?
          <textarea
            disabled={search.isPending || send.isPending}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setResult(null);
              setAttempted(false);
              send.reset();
            }}
            minLength={3}
            maxLength={8000}
            required
          />
        </label>
        <p className="muted small">
          Lecturers only. We check course sources first in case your note is a
          question.
        </p>
        <button className="secondary" disabled={search.isPending}>
          {search.isPending ? "Checking sources…" : "Check course sources"}
        </button>
      </form>
      <Failure error={search.error} />
      {search.isPending && (
        <p role="status" className="muted small spaced">
          Checking course sources. This can take up to 30 seconds.
        </p>
      )}
      {result && (
        <>
          <p className="muted small spaced">
            {result.error ||
              "You can send your note even if a source is relevant."}
          </p>
          <MatchCards matches={result.matches} />
        </>
      )}
      {attempted && !search.isPending && (
        <button
          className="primary spaced"
          disabled={send.isPending || send.isSuccess}
          onClick={() => send.mutate()}
        >
          {send.isPending ? "Sending…" : "Send note to lecturer anyway"}
        </button>
      )}
      {send.isSuccess && (
        <p className="muted small" role="status">
          Note sent. If classified as a question, it enters the lecturer’s
          private queue.
        </p>
      )}
      <Failure error={send.error} />
    </details>
  );
}
