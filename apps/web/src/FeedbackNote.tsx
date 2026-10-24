import { useRef, useState } from "react";
import { api, useAction } from "./api";
import { Failure } from "./CoursePage";

export default function FeedbackNote({ pollId }: { pollId: string }) {
  const [text, setText] = useState("");
  const [sent, setSent] = useState(false);
  const busy = useRef(false);
  const composer = useRef<HTMLDetailsElement>(null);
  const send = useAction((submittedText: string) =>
    api(`/polls/${pollId}/feedback`, { text: submittedText }),
  );
  return (
    <>
      <details className="spaced" ref={composer}>
        <summary>Add a note for the lecturer</summary>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (busy.current || text.trim().length < 3) return;
            busy.current = true;
            setSent(false);
            void send
              .mutateAsync(text)
              .then(() => {
                setText("");
                setSent(true);
                send.reset();
                if (composer.current) {
                  composer.current.open = false;
                  composer.current.querySelector("summary")?.focus();
                }
              })
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
            Lecturers can see your name and original note. Notes and any
            questions inferred from them stay lecturer-only.
          </p>
          <button
            className="primary spaced note-submit"
            aria-busy={send.isPending}
            disabled={send.isPending || text.trim().length < 3}
          >
            {send.isPending ? "Sending…" : "Send note to lecturer"}
          </button>
        </form>
        <Failure error={send.error} />
      </details>
      {sent && (
        <p className="muted small spaced" role="status">
          Note sent.
        </p>
      )}
    </>
  );
}
