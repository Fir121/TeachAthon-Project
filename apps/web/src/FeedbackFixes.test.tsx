import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, test, vi } from "vitest";
import FeedbackNote from "./FeedbackNote";
import LecturerQueue from "./LecturerQueue";
import { QuestionCard, type Question } from "./Questions";

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

test("send note bypasses source search and keeps the student's exact text", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ status: "received" }), { status: 202 }),
    );
  vi.stubGlobal("fetch", fetcher);
  wrap(<FeedbackNote pollId="poll" />);
  fireEvent.click(screen.getByText("Add a note for the lecturer"));
  fireEvent.change(screen.getByLabelText("What would help?"), {
    target: { value: "I like this course" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Send note to lecturer" }),
  );
  await screen.findByText(/Note sent/);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][0]).toBe("/api/v1/polls/poll/feedback");
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
    text: "I like this course",
  });
  expect(screen.queryByText("Check course sources")).not.toBeInTheDocument();
});

test("failed direct note retains the draft for retry", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ message: "Try sending again" }), {
        status: 503,
      }),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ status: "received" }), { status: 202 }),
    );
  vi.stubGlobal("fetch", fetcher);
  wrap(<FeedbackNote pollId="p" />);
  fireEvent.click(screen.getByText("Add a note for the lecturer"));
  fireEvent.change(screen.getByLabelText("What would help?"), {
    target: { value: "Please slow down" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Send note to lecturer" }),
  );
  await screen.findByText("Try sending again");
  expect(screen.getByLabelText("What would help?")).toHaveValue(
    "Please slow down",
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Send note to lecturer" }),
  );
  await screen.findByText(/Note sent/);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

test("feedback panel always shows the original, separately from the derived question", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          groups: [],
          feedback: [
            {
              id: "f",
              author: "Learner",
              text_original:
                "I like the course but I am confused about halving",
              text_rewritten: "Why does binary search halve the interval?",
              classification: "question",
              ai_modified: true,
              linked_question_id: "q",
            },
          ],
          ai_jobs: [],
        }),
      ),
    ),
  );
  wrap(<LecturerQueue sessionId="session" />);
  fireEvent.click(screen.getByText("Poll feedback & AI processing"));
  expect(
    await screen.findByText(
      "I like the course but I am confused about halving",
    ),
  ).toBeVisible();
  expect(
    screen.queryByText("Why does binary search halve the interval?"),
  ).not.toBeInTheDocument();
  expect(screen.queryByText(/AI edited/)).not.toBeInTheDocument();
  expect(screen.getByText("Question sent to the private queue")).toBeVisible();
  expect(
    screen.queryByText("Original feedback", { exact: true }),
  ).not.toBeInTheDocument();
});

const question: Question = {
  id: "q",
  text: "Why is search logarithmic?",
  original: null,
  ai_modified: false,
  author: "Student",
  anonymous: false,
  visibility: "public",
  state: "answered",
  can_edit: false,
  can_delete: false,
  votes: 0,
  my_vote: false,
  session_id: "session",
  created_at: "",
  match: { state: "unavailable" },
  recording_answer: {
    title: "Search lecture",
    url: "/recordings/session",
    state: "ready",
  },
};

test("answered questions offer the whole recording without inventing an exact timestamp", () => {
  wrap(
    <QuestionCard
      question={question}
      teacher={false}
      open={false}
      onOpen={() => {}}
    />,
  );
  expect(screen.getByRole("link", { name: "Search lecture" })).toHaveAttribute(
    "href",
    "/recordings/session",
  );
  expect(
    screen.getByText(/an exact answer timestamp is not available/),
  ).toBeVisible();
  expect(
    screen.queryByRole("link", { name: /Suggested recording excerpt/ }),
  ).not.toBeInTheDocument();
});

test("a precise excerpt takes precedence over the whole-lecture fallback", () => {
  wrap(
    <QuestionCard
      question={{
        ...question,
        match: { state: "ready", url: "/recordings/session?t=5000" },
      }}
      teacher={false}
      open={false}
      onOpen={() => {}}
    />,
  );
  expect(
    screen.getByRole("link", { name: /Suggested recording excerpt/ }),
  ).toHaveAttribute("href", "/recordings/session?t=5000");
  expect(
    screen.queryByRole("link", { name: "Search lecture" }),
  ).not.toBeInTheDocument();
});

test("an answered question without recording does not promise a pending excerpt", () => {
  wrap(
    <QuestionCard
      question={{
        ...question,
        recording_answer: null,
        match: { state: "pending" },
      }}
      teacher={false}
      open={false}
      onOpen={() => {}}
    />,
  );
  expect(screen.getByText("Answered by lecturer")).toBeVisible();
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
  expect(screen.queryByText(/excerpt pending/)).not.toBeInTheDocument();
});

test("manual grouping is opt-in, cancel clears selection, and saving leaves selection mode", async () => {
  const queue = {
    groups: [
      {
        id: null,
        canonical_text: "First question",
        questions: [
          { ...question, id: "q1", text: "First question", state: "open" },
        ],
      },
      {
        id: null,
        canonical_text: "Second question",
        questions: [
          { ...question, id: "q2", text: "Second question", state: "open" },
        ],
      },
    ],
    feedback: [],
    ai_jobs: [],
  };
  const fetcher = vi
    .fn()
    .mockImplementation((path: string) =>
      Promise.resolve(
        new Response(
          JSON.stringify(path.endsWith("/clusters") ? { id: "g" } : queue),
        ),
      ),
    );
  vi.stubGlobal("fetch", fetcher);
  wrap(<LecturerQueue sessionId="s" />);
  await screen.findByRole("button", { name: "First question" });
  expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  expect(
    screen.getByRole("button", { name: "Group questions" }),
  ).toHaveAttribute("title", expect.stringContaining("AI automatically"));
  fireEvent.click(screen.getByRole("button", { name: "Group questions" }));
  fireEvent.click(
    screen.getByRole("checkbox", { name: "Select question: First question" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Cancel grouping" }));
  expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Group questions" }));
  expect(
    screen.getByRole("checkbox", { name: "Select question: First question" }),
  ).not.toBeChecked();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Group questions" }));
  fireEvent.click(
    screen.getByRole("checkbox", { name: "Select question: First question" }),
  );
  fireEvent.click(
    screen.getByRole("checkbox", { name: "Select question: Second question" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Group selected (2)" }));
  await screen.findByRole("button", { name: "Group questions" });
  const request = fetcher.mock.calls.find(
    (call) => call[0] === "/api/v1/sessions/s/clusters",
  );
  expect(JSON.parse(request![1].body)).toEqual({ question_ids: ["q1", "q2"] });
  expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
});

test("a lone question is an ordinary card even if a stale response still has a group ID", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          groups: [
            {
              id: "legacy-singleton",
              canonical_text: "Old group heading",
              questions: [{ ...question, state: "open" }],
            },
          ],
          feedback: [],
          ai_jobs: [],
        }),
      ),
    ),
  );
  wrap(<LecturerQueue sessionId="s" />);
  await screen.findByRole("button", { name: question.text });
  expect(screen.getByRole("button", { name: "Mark answered" })).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Mark group answered" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Split group" }),
  ).not.toBeInTheDocument();
  expect(screen.queryByText("Old group heading")).not.toBeInTheDocument();
});

test("partial answer coverage stays a lecturer review and keeps the whole recording link", () => {
  const partial: Question = {
    ...question,
    match: {
      state: "partial",
      coverage: "partial",
      excerpts: [
        {
          url: "/recordings/session?t=1000",
          start_ms: 1000,
          end_ms: 4000,
          request_ids: ["a"],
        },
      ],
    },
  };
  const view = wrap(
    <QuestionCard question={partial} teacher open={false} onOpen={() => {}} />,
  );
  expect(screen.getByText(/A complete answer was not verified/)).toBeVisible();
  expect(
    screen.getByRole("link", { name: /Review related passage 1/ }),
  ).toHaveAttribute("href", "/recordings/session?t=1000");
  expect(screen.getByRole("link", { name: "Search lecture" })).toBeVisible();
  view.unmount();
  wrap(
    <QuestionCard
      question={partial}
      teacher={false}
      open={false}
      onOpen={() => {}}
    />,
  );
  expect(
    screen.queryByRole("link", { name: /Review related passage/ }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Search lecture" })).toBeVisible();
});

test("a complete multi-request answer offers all actual recording passages", () => {
  wrap(
    <QuestionCard
      question={{
        ...question,
        match: {
          state: "ready",
          url: "/recordings/session?t=1000",
          coverage: "complete",
          excerpts: [
            {
              url: "/recordings/session?t=1000",
              start_ms: 1000,
              end_ms: 4000,
              request_ids: ["a"],
            },
            {
              url: "/recordings/session?t=5000",
              start_ms: 5000,
              end_ms: 8000,
              request_ids: ["b"],
            },
          ],
        },
      }}
      teacher={false}
      open={false}
      onOpen={() => {}}
    />,
  );
  expect(
    screen.getByRole("link", { name: /Suggested recording excerpt 1/ }),
  ).toHaveAttribute("href", "/recordings/session?t=1000");
  expect(
    screen.getByRole("link", { name: /Suggested recording excerpt 2/ }),
  ).toHaveAttribute("href", "/recordings/session?t=5000");
  expect(
    screen.queryByRole("link", { name: "Search lecture" }),
  ).not.toBeInTheDocument();
});

test("retained original feedback offers explicit single-attempt retry", async () => {
  const fetcher = vi.fn().mockImplementation((path: string) =>
    Promise.resolve(
      new Response(
        JSON.stringify(
          path.endsWith("/reprocess")
            ? { status: "queued" }
            : {
                groups: [],
                ai_jobs: [],
                feedback: [
                  {
                    id: "f",
                    author: "Student",
                    text_original: "More detail would help",
                    text_rewritten: null,
                    classification: "unclassified",
                    ai_modified: false,
                    linked_question_id: null,
                    processing_status: "original_retained",
                  },
                ],
              },
        ),
      ),
    ),
  );
  vi.stubGlobal("fetch", fetcher);
  wrap(<LecturerQueue sessionId="s" />);
  fireEvent.click(screen.getByText("Poll feedback & AI processing"));
  fireEvent.click(
    await screen.findByRole("button", { name: "Retry note processing" }),
  );
  await waitFor(() =>
    expect(
      fetcher.mock.calls.some(
        (call) => call[0] === "/api/v1/feedback/f/reprocess",
      ),
    ).toBe(true),
  );
  expect(screen.getByText("More detail would help")).toBeVisible();
});
