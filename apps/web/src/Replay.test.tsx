import { test, expect } from "vitest";
import { render } from "@testing-library/react";
import { SlideView } from "./Live";
import {
  replaySlide,
  timeLabel,
  replayAnnotations,
  type TimelineEvent,
} from "./Replay";
test("replay seek selects last slide transition at or before audio time", () => {
  const events = [
    { type: "slide.changed", offset_ms: 0, payload: { index: 0 } },
    { type: "slide.changed", offset_ms: 5000, payload: { index: 1 } },
    { type: "slide.changed", offset_ms: 12000, payload: { index: 2 } },
  ];
  expect(replaySlide(events, 4999)).toBe(0);
  expect(replaySlide(events, 5000)).toBe(1);
  expect(replaySlide(events, 15000)).toBe(2);
  expect(timeLabel(65000)).toBe("1:05");
});

test("rewinding restores saved ink and clear events erase only their slide", () => {
  const events: TimelineEvent[] = [
    {
      type: "annotation.added",
      offset_ms: 8353,
      payload: {
        index: 0,
        stroke: [
          [0.2, 0.2],
          [0.3, 0.3],
        ],
        coordinates: "slide",
      },
    },
    {
      type: "annotation.added",
      offset_ms: 9133,
      payload: { index: 0, stroke: [] },
    },
    {
      type: "annotation.added",
      offset_ms: 10000,
      payload: {
        index: 1,
        stroke: [
          [0.4, 0.4],
          [0.5, 0.5],
        ],
      },
    },
  ];
  const slide = { index: 0, image_url: "/slide.png" };
  const view = render(
    <SlideView
      slide={slide}
      index={0}
      annotations={replayAnnotations(events, 8500)}
    />,
  );
  expect(
    view.container.querySelectorAll('polyline[points="200,200 300,300"]'),
  ).toHaveLength(1);
  view.rerender(
    <SlideView
      slide={slide}
      index={0}
      annotations={replayAnnotations(events, 11000)}
    />,
  );
  expect(view.container.querySelectorAll("polyline")).toHaveLength(0);
  view.rerender(
    <SlideView
      slide={slide}
      index={0}
      annotations={replayAnnotations(events, 8500)}
    />,
  );
  expect(view.container.querySelectorAll("polyline")).toHaveLength(1);
  view.rerender(
    <SlideView
      slide={{ index: 1, image_url: "/slide2.png" }}
      index={1}
      annotations={replayAnnotations(events, 11000)}
    />,
  );
  expect(
    view.container.querySelectorAll('polyline[points="400,400 500,500"]'),
  ).toHaveLength(1);
  view.unmount();
});
