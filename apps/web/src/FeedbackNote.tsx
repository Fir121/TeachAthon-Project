import { useRef, useState } from "react";
import { api, useAction } from "./api";
import { Failure } from "./CoursePage";

export default function FeedbackNote({ pollId }: { pollId: string }) {
  const [text, setText] = useState("");
  const busy = useRef(false);
  const send = useAction(() => api(`/polls/${pollId}/feedback`, { text }));
  return (
    <details className="spaced">
      <summary>Add a note for the lecturer</summary>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (busy.current || send.isSuccess) return;
          busy.current = true;
          void send
            .mutateAsync()
            .catch(() => {})
            .finally(() => {
              busy.current = false;
            });
        }}
      >
        <label>
          What would help?
          <textarea
            disabled={send.isPending}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              send.reset();
            }}
            minLength={3}
            maxLength={8000}
            required
          />
        </label>
        <p className="muted small">
          Lecturers can see your name and original note. Notes and any questions
          inferred from them stay lecturer-only.
        </p>
        <button
          className="primary spaced"
          disabled={send.isPending || send.isSuccess}
        >
          {send.isPending ? "Sending…" : "Send note to lecturer"}
        </button>
      </form>
      {send.isSuccess && (
        <p className="muted small spaced" role="status">
          Note sent. Your original feedback is saved; if it contains a question,
          that question enters the lecturer’s private queue.
        </p>
      )}
      <Failure error={send.error} />
    </details>
  );
}
