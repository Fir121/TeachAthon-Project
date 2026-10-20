import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, test, vi } from "vitest";
import { MatchCards, type Match } from "./Questions";
import { Dashboard } from "./App";

function wrap(children: React.ReactNode) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>,
  );
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const documentMatch: Match = {
  source_id: "chunk",
  source_type: "resource",
  title: "Notes.pdf",
  excerpt: "Binary\nsearch     halves\nthe interval.",
  url: "/resources/doc?page=2",
  category: "relevant_material",
  page_number: 2,
  start_ms: null,
  end_ms: null,
  score: 0.9,
};
test("document results show a page and readable source text without a null timestamp", () => {
  wrap(<MatchCards matches={[documentMatch]} />);
  expect(screen.getByText("Page 2")).toBeVisible();
  expect(screen.getByText("Binary search halves the interval.")).toBeVisible();
  expect(screen.queryByText(/0:00/)).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Open source/ })).toHaveAttribute(
    "href",
    "/resources/doc?page=2",
  );
});
test("real recording offset zero remains a valid timestamp and long excerpts can expand", () => {
  wrap(
    <MatchCards
      matches={[
        {
          ...documentMatch,
          source_type: "recording",
          page_number: null,
          start_ms: 0,
          end_ms: 30000,
          excerpt: "A long original source passage. ".repeat(30),
        },
      ]}
    />,
  );
  expect(screen.getByText("0:00 – 0:30")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Read full excerpt" }));
  expect(screen.getByRole("button", { name: "Show less" })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
});
test("lecturer dashboard offers course creation without student discovery or enrolment prompts", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("[]")));
  wrap(
    <Dashboard
      user={{
        id: "teacher",
        name: "Teacher",
        email: "teacher@example.com",
        role: "lecturer",
      }}
    />,
  );
  await screen.findByText(/Create your first course/);
  expect(screen.getByRole("button", { name: "Create course" })).toBeVisible();
  expect(screen.queryByText("Discover courses")).not.toBeInTheDocument();
  expect(
    screen.queryByText(/request access from its teaching team/),
  ).not.toBeInTheDocument();
});
