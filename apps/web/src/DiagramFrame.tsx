import { useEffect, useRef, useState } from "react";
import type { Diagram } from "./InteractiveDiagrams";

export type FrameStatus = "loading" | "ready" | "error" | "expired";

// The opaque child can only report UI readiness/errors/Escape. No privileged RPC.
export default function DiagramFrame({
  diagram,
  onClose,
  onStatusChange,
}: {
  diagram: Diagram;
  onClose: () => void;
  onStatusChange?: (status: FrameStatus) => void;
}) {
  const [run] = useState(() => crypto.randomUUID());
  const [status, setStatus] = useState<FrameStatus>("loading");
  const frame = useRef<HTMLIFrameElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    onStatusChange?.(status);
  }, [status, onStatusChange]);
  useEffect(() => {
    let ready = false;
    const timeout = window.setTimeout(() => {
      if (!ready) setStatus("error");
    }, 15000);
    const lifetime = window.setTimeout(
      () => setStatus("expired"),
      15 * 60 * 1000,
    );
    function message(event: MessageEvent) {
      const value = event.data;
      if (
        event.source !== frame.current?.contentWindow ||
        event.origin !== "null" ||
        !value ||
        typeof value !== "object" ||
        value.viewer !== run ||
        value.artifact_id !== diagram.id ||
        Object.keys(value).length !== 3 ||
        !["diagram.ready", "diagram.error", "diagram.close"].includes(
          value.type,
        )
      )
        return;
      if (value.type === "diagram.close") close.current();
      if (value.type === "diagram.ready") {
        ready = true;
        setStatus("ready");
      }
      if (value.type === "diagram.error") {
        ready = false;
        setStatus("error");
      }
    }
    window.addEventListener("message", message);
    return () => {
      window.clearTimeout(timeout);
      window.clearTimeout(lifetime);
      window.removeEventListener("message", message);
    };
  }, [diagram.id, run]);
  const expected = `/api/v1/diagrams/${diagram.id}/render`;
  const valid = diagram.render_url === expected;
  return (
    <div className="diagram-canvas" aria-busy={status === "loading"}>
      {(status === "loading" || status === "ready") && valid && (
        <iframe
          ref={frame}
          title={`${diagram.title} interactive canvas`}
          className="diagram-frame"
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          src={`${expected}?viewer=${run}`}
          onError={() => setStatus("error")}
        />
      )}
      {status === "loading" && valid && (
        <div className="diagram-stage-message" role="status">
          <span className="diagram-spinner" />
          Opening interactive preview…
        </div>
      )}
      {(!valid || status === "error" || status === "expired") && (
        <div className="diagram-stage-message" role="alert">
          <strong>
            {status === "expired"
              ? "Exploration paused"
              : "The diagram could not run"}
          </strong>
          <p>
            {status === "expired"
              ? "Reset to continue after 15 minutes."
              : "Reset to retry, or close and continue with the slide."}
          </p>
        </div>
      )}
    </div>
  );
}
