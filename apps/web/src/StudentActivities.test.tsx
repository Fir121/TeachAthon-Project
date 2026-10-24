import { afterEach, beforeEach, expect, test } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StudentActivityAlerts, type Poll } from "./Live";
const poll: Poll = {
  id: "poll-one",
  prompt: "How is this landing?",
  labels: ["Understood"],
  status: "open",
  my_vote: null,
  opened_at: "",
};
const diagram = {
  id: "diagram-one",
  slide_index: 0,
  title: "Interval stepper",
  summary: "Try halving",
  instructions: "Change a value",
  accessibility_description: "Intervals",
  render_url: "/diagram",
};
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
afterEach(cleanup);
function setup(initial: {
  poll: Poll | null;
  diagram?: typeof diagram;
  live: boolean;
}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const content = (props: typeof initial) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <StudentActivityAlerts
          sessionId="session"
          courseId="course"
          {...props}
        />
      </MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(content(initial));
  return {
    ...view,
    update: (props: typeof initial) => view.rerender(content(props)),
  };
}
test("poll alert queues diagram, dismisses once and remains reopenable", async () => {
  const view = setup({ poll, diagram, live: true });
  expect(
    await screen.findByRole("dialog", { name: "Your lecturer opened a poll" }),
  ).toBeVisible();
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Not now" }));
  expect(
    await screen.findByRole("dialog", { name: "Explore this slide" }),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Not now" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  view.update({ poll: { ...poll }, diagram: { ...diagram }, live: true });
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "Answer understanding poll" }),
  );
  expect(
    await screen.findByRole("dialog", { name: "Your lecturer opened a poll" }),
  ).toBeVisible();
});
test("new poll alerts after dismissal, and closing a poll removes stale voting controls", async () => {
  const view = setup({ poll, live: true });
  await screen.findByRole("dialog");
  fireEvent.click(screen.getByRole("button", { name: "Not now" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  view.update({ poll: { ...poll, id: "poll-two" }, live: true });
  expect(await screen.findByRole("dialog")).toBeVisible();
  view.update({ poll: null, live: true });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.queryByRole("button", { name: "Understood" })).toBeNull();
});
test("diagram alert requires explicit exploration and ends on slide change", async () => {
  const view = setup({ poll: null, diagram, live: true });
  expect(
    await screen.findByRole("dialog", { name: "Explore this slide" }),
  ).toBeVisible();
  expect(view.container.querySelector("iframe")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Explore diagram" }));
  expect(
    await screen.findByRole("dialog", { name: "Interval stepper" }),
  ).toBeVisible();
  view.update({ poll: null, live: true });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(view.container.querySelector("iframe")).toBeNull();
});
test("answered polls and ended lectures do not interrupt students", () => {
  const view = setup({ poll: { ...poll, my_vote: 0 }, live: true });
  expect(screen.queryByRole("dialog")).toBeNull();
  view.update({ poll, diagram, live: false });
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("activity alerts wait until an existing dialog closes", async () => {
  const draft = document.createElement("dialog");
  draft.setAttribute("open", "");
  document.body.append(draft);
  try {
    setup({ poll, diagram, live: true });
    expect(
      screen.queryByRole("dialog", { name: "Your lecturer opened a poll" }),
    ).toBeNull();
    draft.remove();
    expect(
      await screen.findByRole("dialog", {
        name: "Your lecturer opened a poll",
      }),
    ).toBeVisible();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  } finally {
    draft.remove();
  }
});

test("the slide button opens the diagram directly after dismissing its first-time alert", async () => {
  setup({ poll: null, diagram, live: true });
  await screen.findByRole("dialog", { name: "Explore this slide" });
  fireEvent.click(screen.getByRole("button", { name: "Not now" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  for (let attempt = 0; attempt < 2; attempt++) {
    fireEvent.click(
      screen.getByRole("button", { name: "Explore interactive diagram" }),
    );
    expect(
      await screen.findByRole("dialog", { name: "Interval stepper" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("dialog", { name: "Explore this slide" }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close exploration" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  }
});
