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
  fireEvent.click(screen.getByText("Check existing explanations"));
  await screen.findByText("Source search is unavailable.");
  expect(fetcher).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByText("Post my question anyway"));
  await waitFor(() => expect(closed).toHaveBeenCalled());
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toMatchObject({
    preflight_token: "proof",
    text: "Why is search logarithmic?",
  });
});
