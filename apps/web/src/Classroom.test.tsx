import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { test, expect, vi, afterEach } from "vitest";
import { PollCard } from "./Live";
import { AskFlow } from "./Questions";
function wrap(ui: React.ReactNode) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
test("student poll renders saved vote without aggregates", () => {
  wrap(
    <PollCard
      teacher={false}
      poll={{
        id: "p",
        prompt: "How is this landing?",
        status: "open",
        labels: [
          "Understood",
          "Somewhat understood",
          "Unsure or confused",
          "Completely lost",
        ],
        my_vote: 2,
        opened_at: "",
      }}
    />,
  );
  expect(
    screen.getByRole("button", { name: /Unsure or confused/ }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByText(/Response saved/)).toBeVisible();
  expect(screen.queryByText(/aggregate only/)).not.toBeInTheDocument();
});
test("failed preflight allows explicit post and never silently posts", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          preflight_token: "proof",
          status: "failed",
          error: "Source search is unavailable.",
          matches: [],
          method: "keyword retrieval",
        }),
        { status: 200 },
      ),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "q" }), { status: 201 }),
    );
  vi.stubGlobal("fetch", fetcher);
  const closed = vi.fn();
  wrap(<AskFlow courseId="course" onClose={closed} />);
  fireEvent.change(screen.getByLabelText("Your question"), {
    target: { value: "Why is search logarithmic?" },
  });
  expect(screen.queryByText("Post my question anyway")).not.toBeInTheDocument();
  fireEvent.click(screen.getByText("Post question"));
  await screen.findByText("Source search is unavailable.");
  expect(fetcher).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByText("Post anyway"));
  await waitFor(() => expect(closed).toHaveBeenCalled());
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toMatchObject({
    preflight_token: "proof",
    text: "Why is search logarithmic?",
  });
});

test("successful empty retrieval posts once and preserves the submission identifier", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          preflight_token: "proof",
          status: "complete",
          error: null,
          matches: [],
          method: "keyword retrieval",
        }),
      ),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "new-question" }), { status: 201 }),
    );
  vi.stubGlobal("fetch", fetcher);
  const closed = vi.fn();
  wrap(<AskFlow courseId="course" onClose={closed} />);
  fireEvent.change(screen.getByLabelText("Your question"), {
    target: { value: "A new question without a match" },
  });
  const form = screen.getByText("Post question").closest("form")!;
  fireEvent.submit(form);
  fireEvent.submit(form);
  await waitFor(() => expect(closed).toHaveBeenCalledTimes(1));
  expect(fetcher).toHaveBeenCalledTimes(2);
  const checked = JSON.parse(fetcher.mock.calls[0][1].body);
  expect(JSON.parse(fetcher.mock.calls[1][1].body).submission_id).toBe(
    checked.submission_id,
  );
  expect(screen.queryByLabelText("Ask anonymously")).not.toBeInTheDocument();
});

test.each(["matches", "degraded"])(
  "%s retrieval requires explicit confirmation",
  async (mode) => {
    const fetcher = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          preflight_token: "proof",
          status: mode === "degraded" ? "failed" : "complete",
          error:
            mode === "degraded"
              ? "Semantic retrieval unavailable; keyword fallback used."
              : null,
          matches:
            mode === "matches"
              ? [
                  {
                    source_id: "r",
                    source_type: "document",
                    title: "Lecture slides",
                    url: "/resources/r",
                    locations: [],
                    score: 0.9,
                  },
                ]
              : [],
          method: "course search",
        }),
      ),
    );
    vi.stubGlobal("fetch", fetcher);
    const closed = vi.fn();
    wrap(<AskFlow courseId="course" onClose={closed} />);
    fireEvent.change(screen.getByLabelText("Your question"), {
      target: { value: "A course question" },
    });
    fireEvent.click(screen.getByText("Post question"));
    await screen.findByText(
      mode === "degraded" ? "Post anyway" : "Post my question anyway",
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(closed).not.toHaveBeenCalled();
  },
);

test("post failure retains draft and retries the same submission", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          preflight_token: "proof",
          status: "complete",
          error: null,
          matches: [],
          method: "course search",
        }),
      ),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ message: "Temporary posting failure" }), {
        status: 503,
      }),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "q" }), { status: 201 }),
    );
  vi.stubGlobal("fetch", fetcher);
  const closed = vi.fn();
  wrap(<AskFlow courseId="course" onClose={closed} />);
  fireEvent.change(screen.getByLabelText("Your question"), {
    target: { value: "Keep this draft" },
  });
  fireEvent.click(screen.getByText("Post question"));
  await screen.findByText("Temporary posting failure");
  expect(screen.getByLabelText("Your question")).toHaveValue("Keep this draft");
  expect(closed).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Post my question anyway"));
  await waitFor(() => expect(closed).toHaveBeenCalledOnce());
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual(
    JSON.parse(fetcher.mock.calls[2][1].body),
  );
});
