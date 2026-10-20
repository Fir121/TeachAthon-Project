import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

function silentWav() {
  // Authored silence checks real assembly/playback without claiming speech transcription.
  const data = Buffer.alloc(44 + 24000 * 2 * 4);
  data.write("RIFF", 0);
  data.writeUInt32LE(data.length - 8, 4);
  data.write("WAVEfmt ", 8);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(24000, 24);
  data.writeUInt32LE(48000, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write("data", 36);
  data.writeUInt32LE(data.length - 44, 40);
  return data;
}
test("recording replay restores ink on rewind, honors clear and keeps image alignment", async ({
  browser,
}) => {
  test.setTimeout(90000);
  const context = await browser.newContext({
    baseURL: "http://localhost:8080",
  });
  const suffix = Date.now();
  expect(
    (
      await context.request.post("/api/v1/auth/register", {
        data: {
          name: "Ink validation",
          email: `ink-${suffix}@example.com`,
          password: "annotation-test-password",
          role: "lecturer",
        },
      })
    ).status(),
  ).toBe(201);
  const cid = (
    await (
      await context.request.post("/api/v1/courses", {
        data: { name: `Ink validation ${suffix}` },
      })
    ).json()
  ).id;
  try {
    const rid = (
      await (
        await context.request.post(`/api/v1/courses/${cid}/resources`, {
          multipart: {
            file: {
              name: "deck.pdf",
              mimeType: "application/pdf",
              buffer: await readFile(path.resolve("e2e/deck.pdf")),
            },
          },
        })
      ).json()
    ).id;
    await expect
      .poll(
        async () =>
          (await (await context.request.get(`/api/v1/resources/${rid}`)).json())
            .process_status,
        { timeout: 20000 },
      )
      .toBe("ready");
    const lid = (
      await (
        await context.request.post(`/api/v1/courses/${cid}/lectures`, {
          data: { title: "Ink replay", slide_resource_id: rid },
        })
      ).json()
    ).id;
    const sid = (
      await (
        await context.request.post(`/api/v1/lectures/${lid}/sessions/start`, {
          data: { recording_enabled: true },
        })
      ).json()
    ).id;
    // Both legacy and current stroke formats must remain playable.
    await context.request.post(`/api/v1/sessions/${sid}/annotations`, {
      data: {
        index: 0,
        stroke: [
          [0.1, 0.1],
          [0.2, 0.2],
        ],
      },
    });
    await context.request.post(`/api/v1/sessions/${sid}/annotations`, {
      data: {
        index: 0,
        coordinates: "slide",
        stroke: [
          [0.3, 0.3],
          [0.7, 0.5],
        ],
      },
    });
    const before = (
      await (
        await context.request.get(`/api/v1/sessions/${sid}/timeline`)
      ).json()
    )
      .filter((e: any) => e.type === "annotation.added")
      .at(-1).offset_ms;
    const page = await context.newPage();
    // Establish a real, nonzero interval between draw and clear on the session clock.
    await page.waitForTimeout(400);
    await context.request.post(`/api/v1/sessions/${sid}/annotations`, {
      data: { index: 0, coordinates: "slide", stroke: [] },
    });
    const events = await (
      await context.request.get(`/api/v1/sessions/${sid}/timeline`)
    ).json();
    const cleared = events
      .filter((e: any) => e.type === "annotation.added")
      .at(-1).offset_ms;
    await context.request.post(`/api/v1/sessions/${sid}/audio/chunks`, {
      multipart: {
        group_id: randomUUID(),
        chunk_index: "0",
        start_ms: "0",
        end_ms: "4000",
        file: {
          name: "authored-silence.wav",
          mimeType: "audio/wav",
          buffer: silentWav(),
        },
      },
    });
    await context.request.post(`/api/v1/sessions/${sid}/end`, { data: {} });
    await expect
      .poll(
        async () =>
          (
            await (
              await context.request.get(
                `/api/v1/sessions/${sid}/processing-status`,
              )
            ).json()
          ).recording_state,
        { timeout: 25000 },
      )
      .toBe("ready");
    await page.goto(
      `/recordings/${sid}?t=${Math.floor((before + cleared) / 2)}`,
    );
    const ink = page
      .getByRole("img", { name: "Slide annotations", exact: true })
      .locator("polyline");
    const legacy = page
      .getByRole("img", { name: "Legacy slide annotations", exact: true })
      .locator("polyline");
    await expect(ink).toHaveCount(1);
    await expect(legacy).toHaveCount(1);
    await expect
      .poll(() =>
        page
          .locator(".slide-stage img")
          .evaluate((image: HTMLImageElement) => image.naturalWidth),
      )
      .toBeGreaterThan(0);
    for (const width of [1280, 360]) {
      await page.setViewportSize({ width, height: 900 });
      await expect
        .poll(() =>
          page.locator(".slide-stage").evaluate((stage) => {
            const image = stage.querySelector("img")!;
            const svg = stage
              .querySelector('[aria-label="Slide annotations"]')!
              .getBoundingClientRect();
            return Math.abs(
              svg.width / svg.height - image.naturalWidth / image.naturalHeight,
            );
          }),
        )
        .toBeLessThan(0.02);
      const heading = await page
        .locator(".archive-heading")
        .evaluate((header) => ({
          back: header.querySelector(".back")!.getBoundingClientRect().bottom,
          label: header.querySelector(".eyebrow")!.getBoundingClientRect().top,
        }));
      expect(heading.back).toBeLessThan(heading.label);
    }
    await page.screenshot({
      path: "test-results/replay-ink-mobile.png",
      fullPage: true,
    });
    await page
      .locator("audio")
      .evaluate((audio: HTMLAudioElement, ms: number) => {
        audio.currentTime = ms / 1000;
      }, cleared + 10);
    await expect(ink).toHaveCount(0);
    await expect(legacy).toHaveCount(0);
    await page.locator("audio").evaluate(
      (audio: HTMLAudioElement, ms: number) => {
        audio.currentTime = ms / 1000;
      },
      (before + cleared) / 2,
    );
    await expect(ink).toHaveCount(1);
    await expect(legacy).toHaveCount(1);
  } finally {
    expect(
      (await context.request.delete(`/api/v1/courses/${cid}`)).status(),
    ).toBe(204);
    await context.close();
  }
});
