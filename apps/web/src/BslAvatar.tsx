import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api";

export type FinalCaption = {
  id: string;
  item_id?: string;
  text: string;
  start_ms: number;
  end_ms: number;
};
type Entry = FinalCaption & { part: number };
type Plan = {
  glosses: string[];
  supported: boolean;
  missing: string[];
  text: string;
  parts: number;
};
type Cue = { text: string; glosses: string[] };
type Replay = { time: number; playing: boolean; seekToken?: number };

// Local bounded queue. Persisted final IDs survive transport duplicates/reconnects.
export class SigningQueue {
  seen = new Set<string>();
  pending: Entry[] = [];
  missed = 0;
  baseline(captions: FinalCaption[]) {
    captions.forEach((c) => this.remember(c.id));
  }
  remember(id: string) {
    this.seen.add(id);
    if (this.seen.size > 2048)
      this.seen.delete(this.seen.values().next().value!);
  }
  ingest(captions: FinalCaption[], now: number) {
    for (const c of captions) {
      if (this.seen.has(c.id)) continue;
      this.remember(c.id);
      if (now - c.end_ms > 15000) {
        this.missed++;
        continue;
      }
      this.pending.push({ ...c, part: 0 });
      while (this.pending.length > 3) {
        this.pending.shift();
        this.missed++;
      }
    }
  }
  take(now: number) {
    while (this.pending.length) {
      const entry = this.pending.shift()!;
      if (now - entry.end_ms <= 15000) return entry;
      this.missed++;
    }
  }
}

export function validBslMessage(
  e: MessageEvent,
  source: Window | null,
  viewer: string,
) {
  const d = e.data;
  return (
    e.origin === location.origin &&
    e.source === source &&
    !!source &&
    d &&
    typeof d === "object" &&
    d.v === 1 &&
    d.viewer === viewer &&
    ["cwasa_ready", "cwasa_failed", "signing_started", "signing_done"].includes(
      d.type,
    ) &&
    (!["signing_started", "signing_done"].includes(d.type) ||
      (typeof d.request_id === "string" && d.request_id.length <= 120))
  );
}

export default function BslAvatar(props: {
  sid: string;
  startedAt: string;
  caption?: string;
  replay?: Replay;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section className="bsl-opt-in spaced">
      {!open ? (
        <button className="secondary" onClick={() => setOpen(true)}>
          BSL Avatar (Experimental)
        </button>
      ) : (
        <SigningPanel
          key={props.sid}
          {...props}
          onClose={() => setOpen(false)}
        />
      )}
    </section>
  );
}

function SigningPanel({
  sid,
  startedAt,
  caption,
  replay,
  onClose,
}: {
  sid: string;
  startedAt: string;
  caption?: string;
  replay?: Replay;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"captions" | "demo">("captions");
  const [attempt, setAttempt] = useState(0);
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState("Loading corpus and avatar…");
  const [missed, setMissed] = useState(0);
  const [lag, setLag] = useState(0);
  const [signingText, setSigningText] = useState("");
  const [backlog, setBacklog] = useState(0);
  const frame = useRef<HTMLIFrameElement>(null);
  const config = useQuery({
    queryKey: ["bsl-config", sid],
    queryFn: () => api<{ enabled: boolean }>(`/sessions/${sid}/bsl/config`),
  });
  const transcript = useQuery({
    queryKey: replay ? ["transcript", sid] : ["transcript", sid, "bsl"],
    queryFn: () =>
      api<FinalCaption[]>(
        `/sessions/${sid}/transcript${replay ? "" : "?recent=12"}`,
      ),
    refetchInterval: replay ? false : 2000,
  });
  const latest = useRef({ captions: transcript.data, paused, speed, replay });
  latest.current = { captions: transcript.data, paused, speed, replay };
  const base = `/api/v1/sessions/${sid}/bsl/assets/`;
  const enabled = config.data?.enabled === true;
  const viewer = useMemo(
    () => crypto.randomUUID(),
    [sid, mode, attempt, enabled],
  );
  useEffect(() => {
    if (!enabled) return;
    const instance = viewer;
    const queue = new SigningQueue();
    const controller = new AbortController();
    let disposed = false,
      available = false,
      baseline = false,
      current: Entry | null = null;
    let requestId = "",
      waitingSince = 0,
      wasPaused = false,
      lastSpeed = 0;
    let cues: Cue[] = [],
      cueIndex = 0,
      priorTime = -1;
    let priorSeek = latest.current.replay?.seekToken;
    let held: { glosses: string[]; text: string } | null = null;
    setFailed(false);
    setReady(false);
    setMissed(0);
    setLag(0);
    setBacklog(0);
    setSigningText("");
    setStatus("Loading corpus and avatar…");
    function send(type: string, extra: object = {}) {
      frame.current?.contentWindow?.postMessage(
        { v: 1, viewer: instance, type, ...extra },
        location.origin,
      );
    }
    function fail() {
      available = false;
      setFailed(true);
      setReady(false);
      setStatus("Avatar unavailable. Continue with the captions below.");
      if (current) {
        queue.missed++;
        current = null;
      }
      queue.missed += queue.pending.length;
      queue.pending = [];
      setMissed(queue.missed);
    }
    async function get<T>(path: string, body?: object): Promise<T> {
      const r = await fetch(`/api/v1/sessions/${sid}/bsl/${path}`, {
        credentials: "same-origin",
        signal: controller.signal,
        method: body ? "POST" : "GET",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!r.ok) throw Error("Signing unavailable");
      return r.json();
    }
    function message(e: MessageEvent) {
      if (!validBslMessage(e, frame.current?.contentWindow || null, instance))
        return;
      const d = e.data;
      if (d.type === "cwasa_failed") {
        fail();
        return;
      }
      if (d.type === "cwasa_ready") {
        if (available) return;
        available = true;
        clearTimeout(initTimer);
        setReady(true);
        setStatus(
          mode === "demo"
            ? "Prepared corpus script ready."
            : latest.current.replay
              ? "Ready to sign stored caption windows during audio replay."
              : "Following new final captions; earlier speech is not signed.",
        );
      }
      if (d.request_id !== requestId || !current) return;
      if (d.type === "signing_started")
        setStatus(
          mode === "demo"
            ? "Signing prepared corpus vocabulary."
            : "Signing an experimental corpus sequence; grammar is unvalidated.",
        );
      if (d.type === "signing_done") {
        current = null;
        setStatus(
          mode === "demo"
            ? "Prepared cue completed."
            : "Sequence completed. Coverage and grammar are not guaranteed.",
        );
      }
    }
    window.addEventListener("message", message);
    const initTimer = setTimeout(fail, 30000);
    if (mode === "demo") {
      get<{ cues: Cue[] }>("demo")
        .then((data) => {
          if (!disposed) cues = data.cues;
        })
        .catch(() => {
          if (!disposed) {
            setStatus("Prepared script unavailable. Use captions.");
            fail();
          }
        });
    }
    function pump() {
      if (disposed) return;
      const input = latest.current;
      const now =
        input.replay?.time ??
        Math.max(0, Date.now() - new Date(startedAt).getTime());
      // Seek flushes in-flight work and its frame messages; no fabricated word alignment.
      if (
        input.replay &&
        priorTime >= 0 &&
        (input.replay.seekToken !== priorSeek ||
          now < priorTime ||
          now - priorTime > 2500)
      ) {
        send("stop");
        requestId = "";
        current = null;
        held = null;
        queue.pending = [];
        queue.seen.clear();
      }
      priorTime = now;
      priorSeek = input.replay?.seekToken;
      if (mode === "captions" && input.captions) {
        if (input.replay) {
          const cue = input.captions.find(
            (c) => c.start_ms <= now && now < c.end_ms,
          );
          if (cue && input.replay.playing) queue.ingest([cue], now);
        } else if (!baseline) {
          queue.baseline(input.captions);
          baseline = true;
        } else queue.ingest(input.captions, now);
      }
      setMissed(queue.missed);
      setBacklog(queue.pending.length);
      if (current && mode !== "demo")
        setLag(Math.max(0, Math.round((now - current.end_ms) / 1000)));
      const pause =
        input.paused ||
        (!!input.replay && !input.replay.playing && mode !== "demo");
      if (!available) return;
      if (lastSpeed !== input.speed) {
        send("set_speed", { speed: input.speed });
        lastSpeed = input.speed;
      }
      if (pause !== wasPaused) {
        send(pause ? "pause" : "resume");
        wasPaused = pause;
        waitingSince = Date.now();
      }
      if (pause) return;
      if (current) {
        if (held) {
          if (now - current.end_ms > 15000) {
            queue.missed++;
            held = null;
            current = null;
            setStatus(
              "A paused segment became too old to sign. Continue with captions.",
            );
            return;
          }
          setSigningText(held.text);
          send("play_glosses", {
            request_id: requestId,
            glosses: held.glosses,
          });
          held = null;
        }
        if (Date.now() - waitingSince > 90000) fail();
        return;
      }
      const entry =
        mode === "demo"
          ? cueIndex < cues.length
            ? {
                id: `demo-${cueIndex}`,
                text: cues[cueIndex].text,
                start_ms: 0,
                end_ms: 0,
                part: 0,
              }
            : undefined
          : queue.take(now);
      if (!entry) {
        setMissed(queue.missed);
        if (mode === "demo" && cues.length)
          setStatus(
            "Prepared corpus script completed. This was not live translation.",
          );
        return;
      }
      current = entry;
      waitingSince = Date.now();
      requestId = `${entry.id}:${entry.part}:${crypto.randomUUID()}`;
      const requested = requestId;
      const dispatch = (glosses: string[], text: string) => {
        if (disposed || requested !== requestId || !current || !available)
          return;
        setSigningText(text);
        send("play_glosses", { request_id: requested, glosses });
        // Planning may finish after Pause. The engine has not started yet, so apply
        // suspend once animactive arrives as well as on the next pump.
        if (latest.current.paused) wasPaused = false;
      };
      if (mode === "demo") {
        const cue = cues[cueIndex++];
        dispatch(cue.glosses, cue.text);
        return;
      }
      setStatus("Planning final caption…");
      get<Plan>("plan", { caption_id: entry.id, part: entry.part })
        .then((plan) => {
          if (disposed || requested !== requestId || !current) return;
          if (plan.parts > entry.part + 1) {
            queue.pending.unshift({ ...entry, part: entry.part + 1 });
            while (queue.pending.length > 3) {
              queue.pending.pop();
              queue.missed++;
            }
          }
          if (!plan.supported || !plan.glosses.length) {
            queue.missed++;
            current = null;
            setStatus(
              "Caption not signed: corpus vocabulary is incomplete. Read captions.",
            );
            return;
          }
          const clock =
            latest.current.replay?.time ??
            Math.max(0, Date.now() - new Date(startedAt).getTime());
          if (clock - entry.end_ms > 15000) {
            queue.missed++;
            current = null;
            setStatus(
              "Signing arrived too late; this segment was missed. Read captions.",
            );
            return;
          }
          if (
            latest.current.replay?.playing === false ||
            latest.current.paused
          ) {
            // Hold ready plan until resume instead of starting behind a paused control.
            held = { glosses: plan.glosses, text: plan.text };
            return;
          }
          dispatch(plan.glosses, plan.text);
        })
        .catch(() => {
          if (!disposed && requested === requestId) {
            queue.missed++;
            current = null;
            setStatus(
              "Signing planner unavailable; this segment was missed. Read captions.",
            );
          }
        });
    }
    const timer = setInterval(pump, 250);
    return () => {
      disposed = true;
      controller.abort();
      clearInterval(timer);
      clearTimeout(initTimer);
      window.removeEventListener("message", message);
      send("stop");
    };
  }, [sid, startedAt, mode, attempt, enabled, base, viewer]);

  const fallback = replay
    ? transcript.data?.find(
        (c) => c.start_ms <= replay.time && replay.time < c.end_ms,
      )?.text
    : caption || transcript.data?.at(-1)?.text;
  return (
    <div className="panel bsl-panel" aria-label="BSL Avatar (Experimental)">
      <div className="row-between">
        <h2>
          BSL Avatar <span className="small">(Experimental)</span>
        </h2>
        <button
          className="secondary"
          onClick={onClose}
          aria-label="Close BSL avatar"
        >
          Close
        </button>
      </div>
      <p className="muted small">
        Corpus-sign experiment with unvalidated BSL grammar and limited
        vocabulary. Keep captions available; this does not replace a qualified
        interpreter.
      </p>
      {config.error || config.data?.enabled === false ? (
        <p role="status">
          BSL service is not available. Continue with captions.
        </p>
      ) : (
        <p role="status">
          {paused
            ? "Paused. Incoming speech may be missed; use captions. "
            : ""}
          {status}
        </p>
      )}
      {enabled && !failed && (
        <iframe
          key={viewer}
          ref={frame}
          src={`${base}panel.html?viewer=${viewer}`}
          title="Experimental BSL signing avatar"
          className="bsl-frame"
          sandbox="allow-scripts allow-same-origin"
          allow="camera 'none'; microphone 'none'"
        />
      )}
      <div className="bsl-controls actions">
        <button
          className="secondary"
          disabled={!ready}
          aria-pressed={paused}
          onClick={() => setPaused(!paused)}
        >
          {paused ? "Resume signing" : "Pause signing"}
        </button>
        <label>
          Signing speed{" "}
          <select
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
          >
            <option value="0.5">0.5×</option>
            <option value="1">1×</option>
            <option value="2">2×</option>
          </select>
        </label>
        <button
          className="secondary"
          onClick={() => {
            setMode(mode === "demo" ? "captions" : "demo");
            setPaused(false);
          }}
          disabled={!enabled}
        >
          {mode === "demo" ? "Follow captions" : "Play prepared script"}
        </button>
        {failed && (
          <button className="secondary" onClick={() => setAttempt(attempt + 1)}>
            Retry renderer
          </button>
        )}
      </div>
      {mode === "demo" && (
        <p className="small">
          Prepared vocabulary script: “Today: school, teacher, student.” “Read a
          book.” “Ask a question.” This is separate from the lecturer’s speech.
        </p>
      )}
      <p className="small" aria-live="polite">
        {missed} segment(s) missed or unsupported · {backlog} queued · {lag}s
        behind the caption window. Captions and signing can omit speech before
        joining or during disconnection.
      </p>
      {signingText && (
        <p className="small">
          {mode === "demo" ? "Prepared script cue" : "Signing source caption"}:{" "}
          {signingText}
        </p>
      )}
      <div className="captions bsl-captions">
        <strong>Captions fallback</strong>
        <p>
          {fallback ||
            (replay
              ? "No stored caption at this playback time."
              : "Waiting for final captions. Microphone transcription must be active.")}
        </p>
        {transcript.error && (
          <p>
            Caption refresh failed. The classroom connection may still provide
            live captions.
          </p>
        )}
      </div>
      {enabled && (
        <p className="small">
          <a href={`${base}test.html`} target="_blank" rel="noreferrer">
            Standalone corpus rendering test
          </a>{" "}
          ·{" "}
          <a href={`${base}credits.txt`} target="_blank" rel="noreferrer">
            Kozha / CWASA / DictaSign attribution and licenses
          </a>
        </p>
      )}
    </div>
  );
}
