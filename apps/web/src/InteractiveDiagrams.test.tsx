import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./api";
import {
  DiagramPreparation,
  ExploreDiagram,
  type Diagram,
} from "./InteractiveDiagrams";

const diagram: Diagram = {
  id: "ab",
  slide_index: 0,
  title: "Interval stepper",
  summary: "Understand halving",
  instructions: "Change the steps",
  accessibility_description: "Numbers show the interval",
  render_url: "/api/v1/diagrams/ab/render",
};
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.unstubAllGlobals();
});
function wrap(children: React.ReactNode) {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>,
  );
}
test("optional exploration uses only scripts sandbox and unmounts on slide changes", () => {
  const view = wrap(<ExploreDiagram diagrams={[diagram]} index={0} />);
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByText("Explore interactive diagram"));
  const iframe = view.container.querySelector("iframe")!;
  expect(iframe).toHaveAttribute("sandbox", "allow-scripts");
  expect(iframe).not.toHaveAttribute("srcdoc");
  const original = iframe.getAttribute("src");
  fireEvent.click(screen.getByText("Reset diagram"));
  expect(view.container.querySelector("iframe")!.getAttribute("src")).not.toBe(
    original,
  );
  view.rerender(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ExploreDiagram diagrams={[diagram]} index={1} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(view.container.querySelector("iframe")).toBeNull();
  expect(screen.queryByText("Explore interactive diagram")).toBeNull();
});
test("untrusted messages cannot dismiss or mark the viewer ready", () => {
  const view = wrap(<ExploreDiagram diagrams={[diagram]} index={0} />);
  fireEvent.click(screen.getByText("Explore interactive diagram"));
  const frame = view.container.querySelector("iframe")!;
  const run = new URL(frame.src).searchParams.get("viewer");
  fireEvent(
    window,
    new MessageEvent("message", {
      origin: "null",
      source: window,
      data: { type: "diagram.close", viewer: run, artifact_id: "ab" },
    }),
  );
  expect(screen.getByRole("dialog")).toBeVisible();
  fireEvent(
    window,
    new MessageEvent("message", {
      origin: "http://localhost",
      source: frame.contentWindow,
      data: { type: "diagram.ready", viewer: run, artifact_id: "ab" },
    }),
  );
  expect(screen.getByText("Opening interactive preview…")).toBeVisible();
  fireEvent(
    window,
    new MessageEvent("message", {
      origin: "null",
      source: frame.contentWindow,
      data: { type: "diagram.error", viewer: run, artifact_id: "ab" },
    }),
  );
  expect(screen.getByRole("alert")).toHaveTextContent("could not run");
  expect(view.container.querySelector("iframe")).toBeNull();
});
test("zero opportunity result is valid and manual generation targets the selected unsuggested slide", async () => {
  const fetcher = vi.fn().mockImplementation((_url, options) =>
    Promise.resolve(
      new Response(
        JSON.stringify(
          options?.method === "POST"
            ? { id: "new" }
            : {
                locked: false,
                analysis: {
                  id: "a",
                  job: { status: "ready", error: null },
                  completed_pages: 3,
                  total_pages: 3,
                  source_matches: true,
                  input_note: "Rendered images",
                  suggestions: [],
                },
                revisions: [],
              },
        ),
      ),
    ),
  );
  vi.stubGlobal("fetch", fetcher);
  wrap(
    <DiagramPreparation
      lectureId="lecture"
      index={2}
      slides={[0, 1, 2].map((index) => ({ index, image_url: "/slide.png" }))}
      onSelect={() => {}}
    />,
  );
  await screen.findByText(/No useful interactive opportunities found/);
  fireEvent.click(screen.getByText("Generate interactive diagram"));
  expect(screen.getByLabelText("Teaching notes (optional)")).toHaveValue("");
  expect(
    fetcher.mock.calls.some(([, options]) => options?.method === "POST"),
  ).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Generate preview" }));
  await vi.waitFor(() =>
    expect(
      fetcher.mock.calls.some(
        ([url, options]) =>
          String(url).endsWith("/generate") &&
          JSON.parse(options.body).slide_index === 2 &&
          JSON.parse(options.body).feedback === "",
      ),
    ).toBe(true),
  );
});

test("optional teaching notes require explicit generation and cancel does not submit", async () => {
  const sent: any[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((_url, options) => {
      if (options?.method === "POST") {
        sent.push(JSON.parse(options.body));
        return Promise.resolve(
          new Response(
            JSON.stringify(revision("new", 1, "pending", "queued")),
            { status: 202 },
          ),
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({ locked: false, analysis: null, revisions: [] }),
        ),
      );
    }),
  );
  wrap(
    <DiagramPreparation
      lectureId="lecture"
      index={1}
      slides={slides}
      onSelect={() => {}}
    />,
  );
  const generate = await screen.findByRole("button", {
    name: "Generate interactive diagram",
  });
  await vi.waitFor(() => expect(generate).toBeEnabled());
  fireEvent.click(generate);
  expect(screen.getByText(/Slide 2 · Add a teaching focus/)).toBeVisible();
  const notes = screen.getByLabelText("Teaching notes (optional)");
  expect(notes).toHaveAttribute("maxlength", "1500");
  expect(notes).toHaveFocus();
  fireEvent.change(notes, { target: { value: "Compare two algorithms" } });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(sent).toHaveLength(0);
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(generate);
  fireEvent.change(screen.getByLabelText("Teaching notes (optional)"), {
    target: { value: "  Compare two algorithms  " },
  });
  const form = screen
    .getByRole("button", { name: "Generate preview" })
    .closest("form")!;
  fireEvent.submit(form);
  fireEvent.submit(form);
  await vi.waitFor(() => expect(sent).toHaveLength(1));
  expect(sent[0]).toMatchObject({
    slide_index: 1,
    feedback: "Compare two algorithms",
  });
  expect(screen.queryByRole("dialog")).toBeNull();
});
test("locked preparation prevents all changes", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ locked: true, analysis: null, revisions: [] }),
        ),
      ),
  );
  wrap(
    <DiagramPreparation
      lectureId="lecture"
      index={0}
      slides={[{ index: 0, image_url: "/slide.png" }]}
      onSelect={() => {}}
    />,
  );
  await screen.findByText(/Diagrams are fixed/);
  expect(screen.getByText("Generate interactive diagram")).toBeDisabled();
  expect(screen.getByText("Find interactive opportunities")).toBeDisabled();
});

function revision(
  id: string,
  index: number,
  status = "preview",
  job = "ready",
) {
  return {
    ...diagram,
    id,
    slide_index: index,
    title: `Experiment ${index + 1}`,
    status,
    source_matches: true,
    feedback: "",
    job: { status: job, attempts: 1, error: null },
    render_url: `/api/v1/diagrams/${id}/render`,
  };
}
const slides = [0, 1, 2].map((index) => ({
  index,
  image_url: `/slide-${index}.png`,
}));
function signalReady() {
  const frame = document.querySelector("iframe")!;
  const viewer = new URL(frame.src).searchParams.get("viewer");
  fireEvent(
    window,
    new MessageEvent("message", {
      origin: "null",
      source: frame.contentWindow,
      data: {
        type: "diagram.ready",
        viewer,
        artifact_id: new URL(frame.src).pathname.split("/").at(-2),
      },
    }),
  );
}

test("selection batches preserve partial failures and retry the same unacknowledged request", async () => {
  let state = {
    locked: false,
    analysis: null,
    revisions: [] as ReturnType<typeof revision>[],
  };
  let fail = true;
  const sent: { slide_index: number; request_id: string; feedback: string }[] =
    [];
  const fetcher = vi.fn().mockImplementation((_url, options) => {
    if (options?.method !== "POST")
      return Promise.resolve(new Response(JSON.stringify(state)));
    const request = JSON.parse(options.body);
    sent.push(request);
    if (request.slide_index === 1 && fail) {
      fail = false;
      return Promise.resolve(
        new Response(
          JSON.stringify({ message: "Temporary submission failure" }),
          { status: 503 },
        ),
      );
    }
    const result = revision(
      `generated-${request.slide_index}`,
      request.slide_index,
      "pending",
      "queued",
    );
    state = { ...state, revisions: [result, ...state.revisions] };
    return Promise.resolve(
      new Response(JSON.stringify(result), { status: 202 }),
    );
  });
  vi.stubGlobal("fetch", fetcher);
  wrap(
    <DiagramPreparation
      lectureId="lecture"
      index={0}
      slides={slides}
      onSelect={() => {}}
    />,
  );
  await vi.waitFor(() =>
    expect(
      screen.getByRole("button", { name: /Generate interactive diagram/ }),
    ).toBeEnabled(),
  );
  expect(
    screen.getByRole("button", { name: /Generate selected/ }),
  ).toBeDisabled();
  for (const n of [1, 2, 3])
    fireEvent.click(screen.getByLabelText(`Select slide ${n}`));
  fireEvent.click(
    screen.getByRole("button", { name: "Generate selected · 3 slides" }),
  );
  fireEvent.change(screen.getByLabelText("Teaching notes (optional)"), {
    target: { value: "Compare two cases" },
  });
  expect(sent).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Generate 3 previews" }));
  await vi.waitFor(() => expect(sent).toHaveLength(3));
  expect(sent.map((request) => request.feedback)).toEqual(
    Array(3).fill("Compare two cases"),
  );
  await screen.findByText("1 need attention");
  expect(document.querySelector("dialog")).toBeNull();
  expect(screen.getByLabelText("Select slide 2")).toBeChecked();
  expect(screen.getByLabelText("Select slide 1")).not.toBeChecked();
  fireEvent.click(
    screen.getByRole("button", { name: "Generate selected · 1 slide" }),
  );
  expect(screen.getByLabelText("Teaching notes (optional)")).toHaveValue(
    "Compare two cases",
  );
  fireEvent.click(screen.getByRole("button", { name: "Generate preview" }));
  await vi.waitFor(() => expect(sent).toHaveLength(4));
  expect(sent[3].request_id).toBe(sent[1].request_id);
});

test("review approval waits for running iframe, advances in slide order and rejects the next draft", async () => {
  let state = {
    locked: false,
    analysis: null,
    revisions: [revision("second", 1), revision("first", 0)],
  };
  const sent: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url, options) => {
      if (options?.method === "POST") {
        sent.push(url);
        const id = String(url).split("/").at(-2)!;
        const status = String(url).endsWith("approve")
          ? "approved"
          : "rejected";
        state = {
          ...state,
          revisions: state.revisions.map((r) =>
            r.id === id ? { ...r, status } : r,
          ),
        };
        return Promise.resolve(
          new Response(
            JSON.stringify(state.revisions.find((r) => r.id === id)),
          ),
        );
      }
      return Promise.resolve(new Response(JSON.stringify(state)));
    }),
  );
  wrap(
    <DiagramPreparation
      lectureId="lecture"
      index={0}
      slides={slides}
      onSelect={() => {}}
    />,
  );
  const review = await screen.findByRole("button", {
    name: "Review ready previews · 2",
  });
  fireEvent.click(review);
  expect(screen.getByRole("dialog")).toHaveAccessibleName("Experiment 1");
  expect(screen.getByText("Approve and next")).toBeDisabled();
  expect(
    screen.queryByRole("checkbox", { name: /tried the controls/ }),
  ).toBeNull();
  signalReady();
  await vi.waitFor(() =>
    expect(screen.getByText("Approve and next")).toBeEnabled(),
  );
  fireEvent.click(screen.getByText("Approve and next"));
  await vi.waitFor(() =>
    expect(screen.getByRole("dialog")).toHaveAccessibleName("Experiment 2"),
  );
  expect(screen.getByText("Approve and next")).toBeDisabled();
  signalReady();
  fireEvent.click(screen.getByText("Reject and next"));
  await vi.waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(sent).toEqual([
    "/api/v1/diagrams/first/approve",
    "/api/v1/diagrams/second/reject",
  ]);
});

test("refinement stays in review and retains approval until a replacement is reviewed", async () => {
  let state = {
    locked: false,
    analysis: null,
    revisions: [revision("approved", 0, "approved")],
  };
  const sent: any[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url, options) => {
      if (options?.method === "POST") {
        sent.push(JSON.parse(options.body));
        const r = revision("replacement", 0, "pending", "queued");
        state = { ...state, revisions: [r, ...state.revisions] };
        return Promise.resolve(
          new Response(JSON.stringify(r), { status: 202 }),
        );
      }
      return Promise.resolve(new Response(JSON.stringify(state)));
    }),
  );
  wrap(
    <DiagramPreparation
      lectureId="lecture"
      index={0}
      slides={slides}
      onSelect={() => {}}
    />,
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Open approved diagram" }),
  );
  signalReady();
  fireEvent.click(screen.getByRole("button", { name: "Refine" }));
  fireEvent.change(
    screen.getByLabelText("Refinement instructions (optional)"),
    { target: { value: "Compare two intervals" } },
  );
  fireEvent.click(screen.getByText("Generate refined preview"));
  await vi.waitFor(() => expect(sent).toHaveLength(1));
  expect(sent[0].feedback).toBe("Compare two intervals");
  expect(screen.getByRole("dialog")).toBeVisible();
  expect(await screen.findByText(/This version stays available/)).toBeVisible();
  expect(state.revisions.find((r) => r.id === "approved")?.status).toBe(
    "approved",
  );
  state = {
    ...state,
    revisions: [
      revision("replacement", 0),
      revision("approved", 0, "approved"),
    ],
  };
  queryClient.setQueryData(["diagram-preparation", "lecture"], state);
  fireEvent.click(await screen.findByText("Review replacement"));
  expect(document.querySelector("iframe")!.getAttribute("src")).toContain(
    "/replacement/render",
  );
});

test("analysis uses actual page progress while generation leaves slide browsing available", async () => {
  const onSelect = vi.fn();
  const state = {
    locked: false,
    analysis: {
      id: "analysis",
      job: { status: "processing", attempts: 1, error: null },
      completed_pages: 6,
      total_pages: 12,
      source_matches: true,
      input_note: "Rendered images",
      suggestions: [],
    },
    revisions: [
      revision("waiting", 0, "pending", "queued"),
      revision("working", 1, "pending", "processing"),
    ],
  };
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify(state))),
      ),
  );
  wrap(
    <DiagramPreparation
      lectureId="lecture"
      index={0}
      slides={slides}
      onSelect={onSelect}
    />,
  );
  const progress = await screen.findByRole("progressbar", {
    name: "Slides inspected",
  });
  expect(progress).toHaveAttribute("value", "6");
  expect(progress).toHaveAttribute("max", "12");
  expect(screen.getAllByText("Waiting").length).toBeGreaterThan(0);
  expect(screen.getByText("Generating")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "View slide 3" }));
  expect(onSelect).toHaveBeenCalledWith(2);
  expect(document.querySelector("dialog")).toBeNull();
});
