import { test, expect } from "vitest";
import { replaySlide, timeLabel } from "./Replay";
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
