import { test, expect } from "@playwright/test";
import path from "node:path";
test("lecturer and mobile student share slides, polls and private-safe questions", async ({
  browser,
}) => {
  const teacher = await browser.newContext({
      baseURL: "http://localhost:8080",
    }),
    student = await browser.newContext({
      baseURL: "http://localhost:8080",
      viewport: { width: 360, height: 780 },
      isMobile: true,
    });
  const t = await teacher.newPage(),
    s = await student.newPage(),
    suffix = Date.now();
  for (const [page, role] of [
    [t, "lecturer"],
    [s, "student"],
  ] as const) {
    await page.goto("/");
    await page.getByText("New here? Create an account").click();
    await page.getByLabel("Your name").fill(`Browser ${role}`);
    await page
      .getByLabel("Email address")
      .fill(`${role}-${suffix}@example.com`);
    await page
      .getByLabel("Password", { exact: true })
      .fill("browser-smoke-password");
    await page.getByLabel("I am a").selectOption(role);
    await page
      .getByRole("button", { name: "Create account", exact: true })
      .click();
    await expect(page.getByRole("heading", { name: /Hello/ })).toBeVisible();
  }
  await expect(
    t.getByRole("heading", { name: "Discover courses" }),
  ).toHaveCount(0);
  await t.getByRole("button", { name: "Create course" }).click();
  await expect(
    t.getByRole("dialog", { name: "Create a course" }),
  ).toBeVisible();
  await t.goBack();
  await expect(t.getByRole("dialog")).toHaveCount(0);
  await t.goForward();
  await expect(
    t.getByRole("dialog", { name: "Create a course" }),
  ).toBeVisible();
  await t.keyboard.press("Escape");
  await expect(t.getByRole("dialog")).toHaveCount(0);
  await t.getByRole("button", { name: "Create course" }).click();
  await t.getByLabel("Course name").fill(`Browser course ${suffix}`);
  await t
    .getByLabel("Description", { exact: true })
    .fill("Synthetic owner-created browser test");
  await t.getByRole("button", { name: "Create", exact: true }).click();
  await t
    .getByRole("link", { name: new RegExp(`Browser course ${suffix}`) })
    .click();
  const cid = t.url().split("/courses/")[1].split("/")[0];
  await teacher.request.post(`/api/v1/courses/${cid}/members`, {
    data: { email: `student-${suffix}@example.com` },
  });
  await t.getByRole("link", { name: "Resources", exact: true }).click();
  await t
    .getByLabel("Upload resources")
    .setInputFiles(path.resolve("e2e/deck.pdf"));
  await expect(t.getByText("ready", { exact: true })).toBeVisible({
    timeout: 15000,
  });
  await t.getByRole("link", { name: "Lectures", exact: true }).click();
  await t.getByRole("button", { name: "Create lecture", exact: true }).click();
  await t.getByLabel("Lecture title").fill("Browser search lecture");
  await t.getByLabel("Prepared slide deck").selectOption({ label: "deck.pdf" });
  await t
    .getByRole("button", { name: "Create lecture", exact: true })
    .last()
    .click();
  await t.getByRole("link", { name: "Open lecture" }).click();
  await t.getByRole("button", { name: "Start lecture", exact: true }).click();
  await expect(t.getByText("Connected", { exact: true })).toBeVisible();
  const session = t.url().split("/sessions/")[1];
  await s.goto(`/sessions/${session}`);
  await expect(s.getByText("Connected", { exact: true })).toBeVisible();
  await t.getByRole("button", { name: "Next slide" }).click();
  await expect(s.getByText("Slide 2 / 2")).toBeVisible();
  await t.getByRole("button", { name: "Open understanding poll" }).click();
  await s.getByRole("button", { name: /Somewhat understood/ }).click();
  await expect(s.getByText(/Response saved/)).toBeVisible();
  await expect(t.getByText("1 response · aggregate only")).toBeVisible();
  await s.getByRole("button", { name: /Unsure or confused/ }).click();
  await s.reload();
  await expect(
    s.getByRole("button", { name: /Unsure or confused/ }),
  ).toHaveAttribute("aria-pressed", "true");
  await s.getByRole("button", { name: "Ask a question", exact: true }).click();
  await s
    .getByLabel("Your question")
    .fill("Why does binary search halve the search space?");
  await s.getByLabel("Ask anonymously").check();
  await s.getByRole("button", { name: "Check existing explanations" }).click();
  await s.getByRole("button", { name: "Post my question anyway" }).click();
  await expect(
    t.getByRole("button", {
      name: "Why does binary search halve the search space?",
      exact: true,
    }),
  ).toBeVisible();
  await t.getByRole("button", { name: "Mark answered" }).click();
  await expect(
    s.getByText("Answered by lecturer", { exact: true }),
  ).toBeVisible();
  await s.getByRole("button", { name: "Ask a question", exact: true }).click();
  await s.getByLabel("Your question").fill("Private accommodation discussion");
  await s.getByLabel("Who can see it?").selectOption("private");
  await s.getByRole("button", { name: "Check existing explanations" }).click();
  await s.getByRole("button", { name: "Post my question anyway" }).click();
  await expect(
    t.getByRole("button", {
      name: "Private accommodation discussion",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    s
      .locator(".question-feed")
      .getByText("Private accommodation discussion", { exact: true }),
  ).toHaveCount(0);
  await t.screenshot({ path: "test-results/lecturer.png", fullPage: true });
  await s.screenshot({
    path: "test-results/student-mobile.png",
    fullPage: true,
  });
  expect(
    (await teacher.request.delete(`/api/v1/courses/${cid}`)).status(),
  ).toBe(204);
  await teacher.close();
  await student.close();
});

test("real browser microphone chunks assemble to seekable protected recording", async ({
  browser,
}) => {
  const context = await browser.newContext({
    baseURL: "http://localhost:8080",
    permissions: ["microphone"],
  });
  const page = await context.newPage(),
    suffix = Date.now();
  const r = await context.request.post("/api/v1/auth/register", {
    data: {
      name: "Recording teacher",
      email: `audio-${suffix}@example.com`,
      password: "recording-test-password",
      role: "lecturer",
    },
  });
  expect(r.status()).toBe(201);
  const cid = (
    await (
      await context.request.post("/api/v1/courses", {
        data: { name: `Recording ${suffix}` },
      })
    ).json()
  ).id;
  const learner = await browser.newContext({
    baseURL: "http://localhost:8080",
    viewport: { width: 360, height: 780 },
    isMobile: true,
  });
  try {
    await learner.request.post("/api/v1/auth/register", {
      data: {
        name: "Caption learner",
        email: `caption-${suffix}@example.com`,
        password: "caption-test-password",
        role: "student",
      },
    });
    await context.request.post(`/api/v1/courses/${cid}/members`, {
      data: { email: `caption-${suffix}@example.com` },
    });
    const learnerPage = await learner.newPage();
    const fs = await import("node:fs/promises");
    const resource = (
      await (
        await context.request.post(`/api/v1/courses/${cid}/resources`, {
          multipart: {
            file: {
              name: "deck.pdf",
              mimeType: "application/pdf",
              buffer: await fs.readFile(path.resolve("e2e/deck.pdf")),
            },
          },
        })
      ).json()
    ).id;
    await expect
      .poll(
        async () =>
          (
            await (
              await context.request.get(`/api/v1/resources/${resource}`)
            ).json()
          ).process_status,
      )
      .toBe("ready");
    const lid = (
      await (
        await context.request.post(`/api/v1/courses/${cid}/lectures`, {
          data: {
            title: "Recording browser test",
            slide_resource_id: resource,
          },
        })
      ).json()
    ).id;
    await page.goto(`/lectures/${lid}`);
    await page.getByLabel("Record microphone audio for course replay").check();
    await page
      .getByRole("button", { name: "Start lecture", exact: true })
      .click();
    await page.waitForURL("**/sessions/*");
    const sid = page.url().split("/sessions/")[1];
    await learnerPage.goto(`/sessions/${sid}`);
    await learnerPage.getByLabel("Show live captions").check();
    let privateQuestion: string | undefined;
    if (process.env.LIVE_AUDIO_FIXTURE) {
      const question = {
        text: "Why is binary search logarithmic?",
        visibility: "private",
        anonymous: true,
        session_id: sid,
      };
      const proof = await (
        await learner.request.post(
          `/api/v1/courses/${cid}/questions/preflight`,
          {
            data: question,
          },
        )
      ).json();
      privateQuestion = (
        await (
          await learner.request.post(`/api/v1/courses/${cid}/questions`, {
            data: { ...question, preflight_token: proof.preflight_token },
          })
        ).json()
      ).id;
      expect(
        (
          await context.request.post(
            `/api/v1/questions/${privateQuestion}/resolve`,
          )
        ).status(),
      ).toBe(200);
      expect(
        (
          await (
            await context.request.get(`/api/v1/questions/${privateQuestion}`)
          ).json()
        ).state,
      ).toBe("answered");
    }
    await page
      .getByRole("button", { name: "Start microphone", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Pause microphone", exact: true }),
    ).toBeVisible();
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
        { timeout: 12000 },
      )
      .toBe("capturing");
    if (process.env.LIVE_AUDIO_FIXTURE) {
      await expect(learnerPage.locator(".captions")).toContainText(
        /binary|search/i,
        { timeout: 20000 },
      );
      await expect
        .poll(
          async () => {
            const transcript = await (
              await learner.request.get(`/api/v1/sessions/${sid}/transcript`)
            ).json();
            return transcript.some((segment: any) =>
              /binary|search/i.test(segment.text),
            );
          },
          { timeout: 20000 },
        )
        .toBe(true);
    }
    await page.getByRole("button", { name: "Next slide" }).click();
    await expect(page.getByText("Slide 2 / 2")).toBeVisible();
    await page
      .getByRole("button", { name: "Pause microphone", exact: true })
      .click();
    await expect(
      page.getByText("Microphone paused · audio uploads saved"),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "End lecture", exact: true })
      .click();
    await page
      .getByRole("button", { name: "End lecture now", exact: true })
      .click();
    await page.getByRole("link", { name: "Open lecture archive" }).click();
    await expect(page.locator("audio")).toBeVisible({ timeout: 20000 });
    const media = await context.request.get(
      `/api/v1/sessions/${sid}/recording`,
      {
        headers: { Range: "bytes=0-99" },
      },
    );
    expect(media.status()).toBe(206);
    const timeline = await (
      await context.request.get(`/api/v1/sessions/${sid}/timeline`)
    ).json();
    const transition = timeline.find(
      (e: any) => e.type === "slide.changed" && e.payload.index === 1,
    );
    await page.locator("audio").evaluate(async (audio: HTMLAudioElement) => {
      await audio.play();
    });
    await expect
      .poll(() =>
        page.locator("audio").evaluate((a: HTMLAudioElement) => a.currentTime),
      )
      .toBeGreaterThan(0);
    await page.locator("audio").evaluate((a: HTMLAudioElement) => a.pause());
    await page.locator("audio").evaluate((a: HTMLAudioElement) => {
      a.currentTime = 0;
    });
    await expect(page.getByAltText("Lecture slide 1")).toBeVisible();
    await page.locator("audio").evaluate((a: HTMLAudioElement, ms: number) => {
      a.currentTime = ms / 1000;
    }, transition.offset_ms);
    await expect(page.getByAltText("Lecture slide 2")).toBeVisible();
    if (process.env.LIVE_AUDIO_FIXTURE) {
      await expect
        .poll(
          async () =>
            (
              await (
                await context.request.get(
                  `/api/v1/questions/${privateQuestion}/match-status`,
                )
              ).json()
            ).state,
          { timeout: 25000 },
        )
        .toBe("ready");
      expect(
        (
          await learner.request.get(`/api/v1/questions/${privateQuestion}`)
        ).status(),
      ).toBe(404);
      await expect(page.locator(".transcript-panel")).toContainText(
        /binary|search/i,
      );
      await expect
        .poll(
          async () => {
            const result = await (
              await learner.request.get(
                `/api/v1/courses/${cid}/search?q=binary%20search%20sorted%20interval`,
              )
            ).json();
            return result.matches?.some(
              (match: any) => match.source_type === "lecture_explanation",
            );
          },
          { timeout: 30000 },
        )
        .toBe(true);
    }
  } finally {
    try {
      expect(
        (await context.request.delete(`/api/v1/courses/${cid}`)).status(),
      ).toBe(204);
    } finally {
      await learner.close();
      await context.close();
    }
  }
});
