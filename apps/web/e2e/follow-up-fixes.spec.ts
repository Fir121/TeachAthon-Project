import { test, expect, type BrowserContext } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

function authoredSilence() {
  // Genuine four-second WAV fixture for assembly/playback; no speech/transcript is fabricated.
  const wav = Buffer.alloc(44 + 24000 * 2 * 4);
  wav.write("RIFF");
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(24000, 24);
  wav.writeUInt32LE(48000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(wav.length - 44, 40);
  return wav;
}

async function question(
  client: BrowserContext,
  cid: string,
  sid: string,
  text: string,
) {
  const data = { text, session_id: sid, submission_id: randomUUID() };
  const preflight = await client.request.post(
    `/api/v1/courses/${cid}/questions/preflight`,
    { data },
  );
  expect(preflight.status()).toBe(200);
  const posted = await client.request.post(`/api/v1/courses/${cid}/questions`, {
    data: {
      ...data,
      preflight_token: (await preflight.json()).preflight_token,
    },
  });
  expect(posted.status()).toBe(201);
  return posted.json();
}

test("dismissed questions persist, original notes send directly, and answered lectures link without exact excerpts", async ({
  browser,
}) => {
  test.setTimeout(150000);
  const teacher = await browser.newContext({
    baseURL: "http://localhost:8080",
  });
  const student = await browser.newContext({
    baseURL: "http://localhost:8080",
    viewport: { width: 390, height: 844 },
  });
  const suffix = Date.now();
  let cid: string | undefined;
  try {
    for (const [client, role] of [
      [teacher, "lecturer"],
      [student, "student"],
    ] as const)
      expect(
        (
          await client.request.post("/api/v1/auth/register", {
            data: {
              name: `Follow-up ${role}`,
              email: `followup-${role}-${suffix}@example.com`,
              password: "follow-up-test-password",
              role,
            },
          })
        ).status(),
      ).toBe(201);
    cid = (
      await (
        await teacher.request.post("/api/v1/courses", {
          data: { name: `Follow-up fixes ${suffix}` },
        })
      ).json()
    ).id;
    await teacher.request.post(`/api/v1/courses/${cid}/members`, {
      data: { email: `followup-student-${suffix}@example.com` },
    });
    const rid = (
      await (
        await teacher.request.post(`/api/v1/courses/${cid}/resources`, {
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
          (await (await teacher.request.get(`/api/v1/resources/${rid}`)).json())
            .process_status,
        { timeout: 30000 },
      )
      .toBe("ready");
    const lid = (
      await (
        await teacher.request.post(`/api/v1/courses/${cid}/lectures`, {
          data: { title: "Follow-up recording", slide_resource_id: rid },
        })
      ).json()
    ).id;
    const sid = (
      await (
        await teacher.request.post(`/api/v1/lectures/${lid}/sessions/start`, {
          data: { recording_enabled: true },
        })
      ).json()
    ).id;
    const deferred = await question(
      student,
      cid!,
      sid,
      "Could we discuss the interval invariant after class?",
    );
    const answered = await question(
      student,
      cid!,
      sid,
      "What are the violet platypus wingspan observations?",
    );
    const t = await teacher.newPage(),
      s = await student.newPage();
    await t.goto(`/sessions/${sid}`);
    await s.goto(`/sessions/${sid}`);
    const queuePanel = t.locator("section.panel").filter({
      has: t.getByRole("heading", { name: "Question queue", exact: true }),
    });
    await expect(queuePanel.getByRole("checkbox")).toHaveCount(0);
    await expect(
      queuePanel.getByRole("button", { name: "Group questions", exact: true }),
    ).toHaveAttribute("title", /AI automatically.*manually group/);
    await queuePanel
      .getByRole("button", { name: "Group questions", exact: true })
      .click();
    await queuePanel
      .getByRole("checkbox", {
        name: `Select question: ${deferred.text}`,
        exact: true,
      })
      .check();
    await t.setViewportSize({ width: 390, height: 844 });
    for (const label of ["Group selected (1)", "Cancel grouping"]) {
      const bounds = await queuePanel
        .getByRole("button", { name: label, exact: true })
        .boundingBox();
      expect(bounds).toBeTruthy();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
    }
    await queuePanel.screenshot({
      path: "test-results/queue-grouping-mobile.png",
    });
    await t.setViewportSize({ width: 1280, height: 720 });
    await queuePanel
      .getByRole("button", { name: "Cancel grouping", exact: true })
      .click();
    await expect(queuePanel.getByRole("checkbox")).toHaveCount(0);
    await queuePanel
      .getByRole("button", { name: "Group questions", exact: true })
      .click();
    await expect(
      queuePanel.getByRole("checkbox", {
        name: `Select question: ${deferred.text}`,
        exact: true,
      }),
    ).not.toBeChecked();
    for (const text of [deferred.text, answered.text])
      await queuePanel
        .getByRole("checkbox", {
          name: `Select question: ${text}`,
          exact: true,
        })
        .check();
    await queuePanel
      .getByRole("button", { name: "Group selected (2)", exact: true })
      .click();
    await expect(queuePanel.getByRole("checkbox")).toHaveCount(0);
    await expect(
      queuePanel.getByRole("button", {
        name: "Mark group answered",
        exact: true,
      }),
    ).toBeVisible();
    await t.screenshot({
      path: "test-results/queue-grouping-default.png",
      fullPage: true,
    });
    await queuePanel
      .getByRole("button", { name: "Split group", exact: true })
      .click();
    await expect(
      queuePanel.getByRole("button", {
        name: "Mark group answered",
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      queuePanel.getByRole("button", { name: "Split group", exact: true }),
    ).toHaveCount(0);
    await expect(queuePanel.locator(".question-card")).toHaveCount(2);
    await expect(
      queuePanel.getByRole("button", { name: "Mark answered", exact: true }),
    ).toHaveCount(2);
    await expect(queuePanel.locator(".queue-group > .row-between")).toHaveCount(
      0,
    );
    const splitQueue = await (
      await teacher.request.get(`/api/v1/sessions/${sid}/lecturer-queue`)
    ).json();
    expect(splitQueue.groups).toHaveLength(2);
    expect(
      splitQueue.groups.every(
        (group: any) => group.id === null && group.questions.length === 1,
      ),
    ).toBe(true);
    await t.reload();
    await expect(queuePanel.locator(".question-card")).toHaveCount(2);
    await expect(
      queuePanel.getByRole("button", {
        name: "Mark group answered",
        exact: true,
      }),
    ).toHaveCount(0);
    await queuePanel.screenshot({ path: "test-results/queue-after-split.png" });
    const card = t.locator(".question-card").filter({ hasText: deferred.text });
    await card
      .getByRole("button", { name: "Move to discussions", exact: true })
      .click();
    await expect(card).toHaveCount(0);
    expect(
      (
        await (
          await student.request.get(
            `/api/v1/courses/${cid}/questions?sort=unanswered`,
          )
        ).json()
      ).some((q: any) => q.id === deferred.id),
    ).toBe(true);
    await t
      .locator(".question-card")
      .filter({ hasText: answered.text })
      .getByRole("button", { name: "Mark answered", exact: true })
      .click();
    await expect(
      s
        .locator(".question-card")
        .filter({ hasText: answered.text })
        .getByRole("link", { name: "Follow-up recording", exact: true }),
    ).toBeVisible();
    await t
      .getByRole("button", { name: "Open understanding poll", exact: true })
      .click();
    let noteSearches = 0;
    s.on("request", (request) => {
      if (request.url().endsWith("/questions/preflight")) noteSearches++;
    });
    await s.getByText("Add a note for the lecturer", { exact: true }).click();
    const rawNotes = [
      "I like this course",
      "Tell me more about irradiance I love the course what is systems design? course is nice",
    ];
    for (const raw of rawNotes) {
      await s.getByLabel("What would help?").fill(raw);
      await s
        .getByRole("button", { name: "Send note to lecturer", exact: true })
        .click();
      await expect(s.getByText(/Note sent/)).toBeVisible();
    }
    expect(noteSearches).toBe(0);
    await expect(
      s.getByRole("button", { name: "Check course sources" }),
    ).toHaveCount(0);
    await t.getByText("Poll feedback & AI processing", { exact: true }).click();
    for (const raw of rawNotes)
      await expect(
        t.locator(".feedback-original").filter({ hasText: raw }),
      ).toHaveText(raw);
    await expect
      .poll(
        async () => {
          const queue = await (
            await teacher.request.get(`/api/v1/sessions/${sid}/lecturer-queue`)
          ).json();
          return (
            queue.feedback.length === 2 &&
            queue.feedback.every(
              (f: any) => f.classification !== "unclassified",
            )
          );
        },
        { timeout: 60000 },
      )
      .toBe(true);
    const feedback = (
      await (
        await teacher.request.get(`/api/v1/sessions/${sid}/lecturer-queue`)
      ).json()
    ).feedback;
    const praise = feedback.find((f: any) => f.text_original === rawNotes[0]);
    expect(praise.classification).toBe("feedback");
    expect(praise.ai_modified).toBe(false);
    expect(praise.text_rewritten).toBeNull();
    const inferred = feedback.find((f: any) => f.text_original === rawNotes[1]);
    expect(inferred.linked_question_id).toBeTruthy();
    const privateQuestion = await (
      await teacher.request.get(
        `/api/v1/questions/${inferred.linked_question_id}`,
      )
    ).json();
    expect(privateQuestion.text.toLowerCase()).toContain("irradiance");
    expect(privateQuestion.text.toLowerCase()).toContain("systems design");
    expect(privateQuestion.text).toContain("\n\n");
    expect(privateQuestion.original).toBe(rawNotes[1]);
    const privateCard = t
      .locator(".question-card")
      .filter({ hasText: "systems design" });
    await expect(privateCard.locator(".question-body")).toContainText(
      /irradiance/i,
    );
    await expect(privateCard.locator(".question-body")).toContainText(
      /systems design/i,
    );
    await expect(t.getByText("Original feedback", { exact: true })).toHaveCount(
      0,
    );
    expect(
      (
        await student.request.get(
          `/api/v1/questions/${inferred.linked_question_id}`,
        )
      ).status(),
    ).toBe(404);
    for (const originalCard of await t
      .locator(".reply")
      .filter({ has: t.locator(".feedback-original") })
      .all()) {
      await expect(originalCard).not.toContainText("AI edited");
    }
    await t.screenshot({
      path: "test-results/original-feedback.png",
      fullPage: true,
    });
    expect(
      (
        await teacher.request.post(`/api/v1/sessions/${sid}/audio/chunks`, {
          multipart: {
            group_id: randomUUID(),
            chunk_index: "0",
            start_ms: "0",
            end_ms: "4000",
            file: {
              name: "authored-silence.wav",
              mimeType: "audio/wav",
              buffer: authoredSilence(),
            },
          },
        })
      ).status(),
    ).toBe(202);
    await teacher.request.post(`/api/v1/sessions/${sid}/end`);
    await expect
      .poll(
        async () =>
          (
            await (
              await teacher.request.get(
                `/api/v1/sessions/${sid}/processing-status`,
              )
            ).json()
          ).recording_state,
        { timeout: 30000 },
      )
      .toBe("ready");
    await expect
      .poll(
        async () =>
          (
            await (
              await teacher.request.get(
                `/api/v1/questions/${answered.id}/match-status`,
              )
            ).json()
          ).state,
        { timeout: 30000 },
      )
      .toBe("unavailable");
    await s.goto(`/courses/${cid}/discussions`);
    const deferredCard = s
      .locator(".question-card")
      .filter({ hasText: deferred.text });
    await expect(deferredCard).toBeVisible();
    await expect(
      deferredCard.getByText("Moved to discussions", { exact: true }),
    ).toBeVisible();
    const answerCard = s
      .locator(".question-card")
      .filter({ hasText: answered.text });
    await expect(
      answerCard.getByText("Answered by lecturer", { exact: true }),
    ).toBeVisible();
    const recording = answerCard.getByRole("link", {
      name: "Follow-up recording",
      exact: true,
    });
    await expect(recording).toHaveAttribute("href", `/recordings/${sid}`);
    await expect(answerCard).toContainText(
      "an exact answer timestamp is not available",
    );
    await s.screenshot({
      path: "test-results/discussion-recording-fallback-mobile.png",
      fullPage: true,
    });
    await recording.click();
    await expect(s).toHaveURL(new RegExp(`/recordings/${sid}$`));
    await expect(s.locator("audio")).toBeVisible();
    expect(
      (
        await student.request.get(`/api/v1/sessions/${sid}/recording`, {
          headers: { Range: "bytes=0-99" },
        })
      ).status(),
    ).toBe(206);
  } finally {
    if (cid)
      expect(
        (await teacher.request.delete(`/api/v1/courses/${cid}`)).status(),
      ).toBe(204);
    await teacher.close();
    await student.close();
  }
});
