import { afterEach, expect, test, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import BslAvatar, {
  SigningQueue,
  validBslMessage,
  type FinalCaption,
} from "./BslAvatar";
import * as apiModule from "./api";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const caption = (id: string, end_ms = 10000): FinalCaption => ({
  id,
  text: "Read a book.",
  start_ms: end_ms - 2000,
  end_ms,
});

test("duplicate final captions and reconnect snapshots enqueue once; baseline skips historical speech", () => {
  const q = new SigningQueue();
  q.baseline([caption("old")]);
  q.ingest([caption("old"), caption("new"), caption("new")], 11000);
  expect(q.pending.map((c) => c.id)).toEqual(["new"]);
  expect(q.take(12000)?.id).toBe("new");
  q.ingest([caption("new")], 13000);
  expect(q.pending).toHaveLength(0);
});

test("queue bounds latency, drops oldest backlog and counts stale segments", () => {
  const q = new SigningQueue();
  q.ingest(
    Array.from({ length: 8 }, (_, i) => caption(String(i))),
    12000,
  );
  expect(q.pending).toHaveLength(3);
  expect(q.missed).toBe(5);
  expect(q.take(30000)).toBeUndefined();
  expect(q.missed).toBe(8);
  q.ingest([caption("late", 1000)], 30000);
  expect(q.missed).toBe(9);
});

test("parent rejects wrong-origin, wrong-window, stale-instance and malformed messages", () => {
  const source = window;
  const event = (
    data: unknown,
    origin = location.origin,
    sender: Window = source,
  ) => new MessageEvent("message", { origin, source: sender, data });
  const data = { v: 1, viewer: "one", type: "cwasa_ready" };
  expect(validBslMessage(event(data), source, "one")).toBe(true);
  expect(
    validBslMessage(event(data, "https://untrusted.test"), source, "one"),
  ).toBe(false);
  expect(validBslMessage(event(data), {} as Window, "one")).toBe(false);
  expect(validBslMessage(event(data), source, "two")).toBe(false);
  expect(
    validBslMessage(event({ ...data, type: "signing_done" }), source, "one"),
  ).toBe(false);
  expect(
    validBslMessage(event({ ...data, type: "play_sigml" }), source, "one"),
  ).toBe(false);
});

function mount(sid = "session-one") {
  vi.spyOn(apiModule, "api").mockImplementation(async (path) =>
    path.endsWith("/bsl/config")
      ? ({ enabled: true } as never)
      : ([caption("persisted")] as never),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <BslAvatar
        sid={sid}
        startedAt={new Date().toISOString()}
        caption="Read a book."
      />
    </QueryClientProvider>,
  );
  return { client, view };
}
function message(frame: HTMLIFrameElement, type: string) {
  const viewer = new URL(frame.src).searchParams.get("viewer");
  fireEvent(
    window,
    new MessageEvent("message", {
      origin: location.origin,
      source: frame.contentWindow,
      data: { v: 1, viewer, type },
    }),
  );
}

test("avatar stays opt-in; unavailable renderer removes frame and keeps captions plus retry", async () => {
  mount();
  expect(screen.queryByTitle("Experimental BSL signing avatar")).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "BSL Avatar (Experimental)" }),
  );
  const frame = (await screen.findByTitle(
    "Experimental BSL signing avatar",
  )) as HTMLIFrameElement;
  await waitFor(() => expect(frame.src).toContain("panel.html?viewer="));
  message(frame, "cwasa_ready");
  expect(screen.getByRole("button", { name: "Pause signing" })).toBeEnabled();
  message(frame, "cwasa_failed");
  expect(screen.queryByTitle("Experimental BSL signing avatar")).toBeNull();
  expect(screen.getByText("Read a book.")).toBeVisible();
  expect(screen.getByRole("button", { name: "Retry renderer" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Close BSL avatar" }));
  expect(
    screen.getByRole("button", { name: "BSL Avatar (Experimental)" }),
  ).toBeVisible();
});

test("session transitions replace iframe and ignore messages from the prior session", async () => {
  const { view, client } = mount();
  fireEvent.click(
    screen.getByRole("button", { name: "BSL Avatar (Experimental)" }),
  );
  const old = (await screen.findByTitle(
    "Experimental BSL signing avatar",
  )) as HTMLIFrameElement;
  await waitFor(() => expect(old.src).toContain("session-one"));
  const oldSource = old.contentWindow;
  const oldViewer = new URL(old.src).searchParams.get("viewer");
  view.rerender(
    <QueryClientProvider client={client}>
      <BslAvatar
        sid="session-two"
        startedAt={new Date().toISOString()}
        caption="New session caption"
      />
    </QueryClientProvider>,
  );
  const next = (await screen.findByTitle(
    "Experimental BSL signing avatar",
  )) as HTMLIFrameElement;
  await waitFor(() => expect(next.src).toContain("session-two"));
  expect(next).not.toBe(old);
  fireEvent(
    window,
    new MessageEvent("message", {
      origin: location.origin,
      source: oldSource,
      data: { v: 1, viewer: oldViewer, type: "cwasa_ready" },
    }),
  );
  expect(screen.getByRole("button", { name: "Pause signing" })).toBeDisabled();
  expect(screen.getByText("New session caption")).toBeVisible();
});

test("replay uses real stored windows, flushes on seeks, pauses with audio and aborts on close", async () => {
  vi.spyOn(apiModule, "api").mockImplementation(async (path) =>
    path.endsWith("/bsl/config")
      ? ({ enabled: true } as never)
      : ([caption("saved", 4000)] as never),
  );
  const fetcher = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      supported: true,
      glosses: ["book(n)#1"],
      missing: [],
      text: "Read a book.",
      parts: 1,
    }),
  });
  vi.stubGlobal("fetch", fetcher);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const startedAt = new Date().toISOString();
  const element = (time: number, playing = true, seekToken = 0) => (
    <QueryClientProvider client={client}>
      <BslAvatar
        sid="replay"
        startedAt={startedAt}
        replay={{ time, playing, seekToken }}
      />
    </QueryClientProvider>
  );
  const view = render(element(500));
  fireEvent.click(
    screen.getByRole("button", { name: "BSL Avatar (Experimental)" }),
  );
  const frame = (await screen.findByTitle(
    "Experimental BSL signing avatar",
  )) as HTMLIFrameElement;
  const post = vi.spyOn(frame.contentWindow!, "postMessage");
  message(frame, "cwasa_ready");
  expect(fetcher).not.toHaveBeenCalled();
  view.rerender(element(2500));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  await waitFor(() =>
    expect(post.mock.calls.some((c) => c[0].type === "play_glosses")).toBe(
      true,
    ),
  );
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
    caption_id: "saved",
    part: 0,
  });
  view.rerender(element(2600, false));
  await waitFor(() =>
    expect(post.mock.calls.some((c) => c[0].type === "pause")).toBe(true),
  );
  view.rerender(element(2500, true, 1));
  await waitFor(() =>
    expect(post.mock.calls.some((c) => c[0].type === "stop")).toBe(true),
  );
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  fireEvent.click(screen.getByRole("button", { name: "Close BSL avatar" }));
  expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
  expect(screen.queryByTitle("Experimental BSL signing avatar")).toBeNull();
});
