import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, RotateCcw } from "lucide-react";
import { api, queryClient, useUI } from "./api";
export interface AudioSource {
  start(): Promise<MediaStream>;
  stop(): void;
}
export class MicrophoneSource implements AudioSource {
  private stream: MediaStream | null = null;
  async start() {
    if (!navigator.mediaDevices?.getUserMedia)
      throw new Error(
        "Microphone capture requires HTTPS or localhost and a supported browser.",
      );
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });
    return this.stream;
  }
  stop() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }
}
type PendingChunk = { data: FormData; index: number };
export class Capture {
  source: AudioSource;
  context: AudioContext | null = null;
  worklet: AudioWorkletNode | null = null;
  recorder: MediaRecorder | null = null;
  socket: WebSocket | null = null;
  pending: PendingChunk[] = [];
  uploadChain: Promise<void> = Promise.resolve();
  stopResolver: (() => void) | null = null;
  stream: MediaStream | null = null;
  sent = 0;
  windowStart = 0;
  total = 0;
  base = 0;
  recordBase = 0;
  recordStart = 0;
  previousEnd = 0;
  index = 0;
  group = crypto.randomUUID();
  stopped = false;
  flushResolver: (() => void) | null = null;
  constructor(
    public sid: string,
    public report: (status: string) => void,
    source: AudioSource = new MicrophoneSource(),
  ) {
    this.source = source;
  }
  async start() {
    this.stream = await this.source.start();
    const config = await api<{
      offset_ms: number;
      recording_enabled: boolean;
      live_stt_configured: boolean;
    }>(`/sessions/${this.sid}/audio/config`);
    this.base = config.offset_ms;
    this.recordBase = config.offset_ms;
    this.previousEnd = this.base;
    this.recordStart = performance.now();
    if (config.recording_enabled) {
      const codec = [
        "audio/webm;codecs=opus",
        "audio/mp4",
        "audio/ogg;codecs=opus",
      ].find((c) => MediaRecorder.isTypeSupported(c));
      if (!codec) {
        this.source.stop();
        throw new Error(
          "This browser does not support a recording codec. Use current Chrome or Safari.",
        );
      }
      this.recorder = new MediaRecorder(this.stream, {
        mimeType: codec,
        audioBitsPerSecond: 64000,
      });
      this.recorder.ondataavailable = (e) => {
        if (!e.data.size) return;
        const end = Math.max(
          this.previousEnd + 1,
          Math.round(this.recordBase + performance.now() - this.recordStart),
        );
        const data = new FormData();
        data.set(
          "file",
          new File([e.data], `chunk-${this.index}`, { type: codec }),
        );
        data.set("group_id", this.group);
        data.set("chunk_index", String(this.index));
        data.set("start_ms", String(this.previousEnd));
        data.set("end_ms", String(end));
        this.previousEnd = end;
        const chunk = { data, index: this.index++ };
        this.pending.push(chunk);
        this.uploadChain = this.uploadChain.then(() => this.upload(chunk));
      };
      this.recorder.onstop = () => this.stopResolver?.();
      this.recorder.start(4000);
    }
    if (!config.live_stt_configured) {
      this.report(
        config.recording_enabled
          ? "Recording · captions unavailable (server API key missing)"
          : "Microphone open · captions unavailable (server API key missing)",
      );
      return;
    }
    this.context = new AudioContext({ sampleRate: 24000 });
    if (this.context.sampleRate !== 24000)
      throw new Error(
        "This browser cannot resample microphone audio to 24 kHz. Recording may continue; use a supported browser for captions.",
      );
    await this.context.audioWorklet.addModule("/pcm-worklet.js");
    this.worklet = new AudioWorkletNode(this.context, "pcm-recorder");
    const silence = this.context.createGain();
    silence.gain.value = 0;
    this.context
      .createMediaStreamSource(this.stream)
      .connect(this.worklet)
      .connect(silence)
      .connect(this.context.destination);
    this.socket = new WebSocket(
      `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws/sessions/${this.sid}/audio`,
    );
    const socket = this.socket;
    let ready = false;
    socket.onmessage = (e) => {
      const event = JSON.parse(e.data);
      if (event.type === "ready") {
        ready = true;
        this.base = config.offset_ms + performance.now() - this.recordStart;
        this.windowStart = Math.round(this.base);
        this.report(
          config.recording_enabled
            ? "Recording · live captions on"
            : "Live captions on · recording off",
        );
      }
      if (event.type === "error") this.report(event.message);
    };
    socket.onclose = () => {
      if (!this.stopped)
        this.report(
          config.recording_enabled
            ? "Recording · caption connection lost; pause and retry microphone"
            : "Caption connection lost; pause and retry microphone",
        );
    };
    this.worklet.port.onmessage = (e) => {
      if (e.data === "flushed") {
        this.flushResolver?.();
        return;
      }
      if (!ready || socket.readyState !== WebSocket.OPEN) return;
      if (socket.bufferedAmount > 2_000_000) {
        this.report(
          "Caption network is too slow. Recording continues; pause and retry microphone transcription.",
        );
        socket.close();
        return;
      }
      const buffer = e.data as ArrayBuffer;
      socket.send(buffer);
      this.total += buffer.byteLength / 2;
      this.sent += buffer.byteLength / 2;
      if (this.sent >= 120000) {
        const end = Math.round(this.base + this.total / 24);
        socket.send(
          JSON.stringify({
            type: "window",
            start_ms: this.windowStart,
            end_ms: end,
          }),
        );
        this.windowStart = end;
        this.sent = 0;
      }
    };
    await this.context.resume();
    this.report(
      config.recording_enabled
        ? "Recording · connecting captions…"
        : "Connecting live captions…",
    );
  }
  async upload(chunk: PendingChunk) {
    try {
      await api(`/sessions/${this.sid}/audio/chunks`, chunk.data);
      this.pending = this.pending.filter((c) => c !== chunk);
    } catch (e) {
      this.report(
        `Recording upload failed. ${this.pending.length} chunk(s) await retry. ${e instanceof Error ? e.message : ""}`,
      );
    }
  }
  async retry() {
    for (const chunk of [...this.pending]) await this.upload(chunk);
  }
  async stop() {
    this.stopped = true;
    if (this.worklet) {
      await new Promise<void>((resolve) => {
        this.flushResolver = resolve;
        this.worklet!.port.postMessage("flush");
        setTimeout(resolve, 250);
      });
    }
    if (this.socket?.readyState === WebSocket.OPEN) {
      if (this.sent) {
        const end = Math.round(this.base + this.total / 24);
        this.socket.send(
          JSON.stringify({
            type: "window",
            start_ms: this.windowStart,
            end_ms: end,
          }),
        );
      }
      this.socket.send(JSON.stringify({ type: "stop" }));
    }
    if (this.recorder?.state === "recording")
      await new Promise<void>((resolve) => {
        this.stopResolver = resolve;
        this.recorder!.stop();
      });
    await this.context?.close();
    this.context = null;
    this.source.stop();
    await this.uploadChain;
    this.report(
      this.pending.length
        ? `${this.pending.length} recording chunk(s) await retry.`
        : "Microphone paused · audio uploads saved",
    );
    await queryClient.invalidateQueries();
  }
}
export function AudioControls({
  sid,
  registerStop,
}: {
  sid: string;
  registerStop: (stop: (() => Promise<void>) | null) => void;
}) {
  const [status, setStatus] = useState("Microphone off"),
    [active, setActive] = useState(false),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState(0),
    capture = useRef<Capture | null>(null);
  useEffect(
    () => () => {
      void capture.current?.stop();
    },
    [],
  );
  async function stop() {
    setBusy(true);
    try {
      await capture.current?.stop();
      setPending(capture.current?.pending.length || 0);
      setActive(false);
      registerStop(async () => {
        await capture.current?.retry();
        if (capture.current?.pending.length)
          throw new Error(
            "Retry the unsaved audio uploads before ending the lecture.",
          );
      });
    } finally {
      setBusy(false);
    }
  }
  async function start() {
    setBusy(true);
    try {
      if (capture.current?.pending.length) {
        setStatus(
          "Retry the unsaved recording chunks before starting another capture.",
        );
        return;
      }
      const c = new Capture(sid, setStatus);
      capture.current = c;
      await c.start();
      setActive(true);
      registerStop(async () => {
        await c.stop();
        setPending(c.pending.length);
        setActive(false);
        if (c.pending.length)
          throw new Error(
            "Recording uploads are incomplete. Retry them before ending the lecture.",
          );
      });
    } catch (e) {
      await capture.current?.stop();
      setStatus(
        e instanceof Error ? e.message : "Microphone permission was denied.",
      );
      setActive(false);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="audio-controls">
      <div className="actions">
        <button
          className={active ? "secondary" : "primary"}
          disabled={busy}
          onClick={() => void (active ? stop() : start())}
        >
          {active ? <MicOff size={16} /> : <Mic size={16} />}{" "}
          {busy
            ? "Please wait…"
            : active
              ? "Pause microphone"
              : "Start microphone"}
        </button>
        {pending > 0 && (
          <button
            className="secondary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await capture.current?.retry();
              setPending(capture.current?.pending.length || 0);
              setBusy(false);
            }}
          >
            <RotateCcw size={15} />
            Retry audio uploads
          </button>
        )}
      </div>
      <p className="muted small" role="status">
        {status}
      </p>
    </div>
  );
}
