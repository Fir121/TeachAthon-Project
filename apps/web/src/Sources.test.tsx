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
  source_id: "document",
  source_type: "document",
  title: "Notes.pdf",
  url: "/resources/doc?page=2",
  locations: [
    {
      page_number: 2,
      start_ms: null,
      end_ms: null,
      url: "/resources/doc?page=2",
    },
  ],
  score: 0.9,
};
test("document results show source links without chunk text or a null timestamp", () => {
  wrap(<MatchCards matches={[documentMatch]} />);
  expect(screen.getByText("Page 2")).toBeVisible();
  expect(screen.queryByText(/Source excerpt/)).not.toBeInTheDocument();
  expect(screen.queryByText(/0:00/)).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Open source/ })).toHaveAttribute(
    "href",
    "/resources/doc?page=2",
  );
});
test("real recording offset zero remains valid and additional locations can expand", () => {
  wrap(
    <MatchCards
      matches={[
        {
          ...documentMatch,
          source_type: "recording",
          locations: Array.from({ length: 6 }, (_, i) => ({
            page_number: null,
            start_ms: i * 30000,
            end_ms: (i + 1) * 30000,
            url: `/recordings/session?t=${i * 30000}`,
          })),
        },
      ]}
    />,
  );
  expect(screen.getByText("0:00")).toBeVisible();
  fireEvent.click(
    screen.getByRole("button", { name: "Show 1 more locations" }),
  );
  expect(
    screen.getByRole("button", { name: "Show fewer locations" }),
  ).toHaveAttribute("aria-expanded", "true");
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
