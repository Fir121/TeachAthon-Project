import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("recording search groups open real timestamp links in the source player", async ({
  browser,
}) => {
  test.skip(
    !process.env.SOURCE_AUDIO_FIXTURE,
    "Provide authorized speech longer than 30 seconds to verify real batch-STT timestamp links.",
  );
  test.setTimeout(150000);
  const context = await browser.newContext({
    baseURL: "http://localhost:8080",
  });
  const suffix = Date.now();
  expect(
    (
      await context.request.post("/api/v1/auth/register", {
        data: {
          name: "Media source validation",
          email: `media-source-${suffix}@example.com`,
          password: "media-source-test-password",
          role: "lecturer",
        },
      })
    ).status(),
  ).toBe(201);
  const cid = (
    await (
      await context.request.post("/api/v1/courses", {
        data: { name: `Media source validation ${suffix}` },
      })
    ).json()
  ).id;
  try {
    const rid = (
      await (
        await context.request.post(`/api/v1/courses/${cid}/resources`, {
          multipart: {
            file: {
              name: "authored-speech.mp3",
              mimeType: "audio/mpeg",
              buffer: await readFile(process.env.SOURCE_AUDIO_FIXTURE!),
            },
          },
        })
      ).json()
    ).id;
    await expect
      .poll(
        async () =>
          (await (await context.request.get(`/api/v1/resources/${rid}`)).json())
            .index_status,
        { timeout: 90000 },
      )
      .toBe("ready");
    expect(
      (await (await context.request.get(`/api/v1/resources/${rid}`)).json())
        .extraction_status,
    ).toBe("ready");
    const page = await context.newPage();
    await page.goto(`/courses/${cid}/search`);
    await page.getByLabel("Search words").fill("binary search sorted interval");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page.locator(".match-card")).toHaveCount(1, {
      timeout: 25000,
    });
    await expect(page.locator(".source-excerpt")).toHaveCount(0);
    // Use the measured input-window boundary (MP3 padding can shift it by a millisecond).
    const segments = await (
      await context.request.get(`/api/v1/resources/${rid}/transcript`)
    ).json();
    const offset = segments.find(
      (segment: { start_ms: number }) => segment.start_ms >= 29000,
    )?.start_ms;
    expect(offset).toBeGreaterThanOrEqual(29000);
    expect(offset).toBeLessThan(31000);
    const timestamp = page.getByRole("link", { name: "0:30", exact: true });
    await expect(timestamp).toHaveAttribute(
      "href",
      `/resources/${rid}?t=${offset}`,
    );
    const popup = page.waitForEvent("popup");
    await timestamp.click();
    const source = await popup;
    await expect(source).toHaveURL(
      new RegExp(`/resources/${rid}\\?t=${offset}$`),
    );
    await expect
      .poll(() =>
        source
          .locator("audio")
          .evaluate((audio: HTMLAudioElement) => audio.currentTime),
      )
      .toBeGreaterThanOrEqual(offset / 1000 - 0.1);
    await expect(source.locator(".transcript-list")).toContainText(
      /binary|search/i,
    );
    await source.locator("audio").evaluate(async (audio: HTMLAudioElement) => {
      await audio.play();
    });
    await expect
      .poll(() =>
        source
          .locator("audio")
          .evaluate((audio: HTMLAudioElement) => audio.currentTime),
      )
      .toBeGreaterThan(offset / 1000 + 0.1);
    await source.close();
  } finally {
    expect(
      (await context.request.delete(`/api/v1/courses/${cid}`)).status(),
    ).toBe(204);
    await context.close();
  }
});
