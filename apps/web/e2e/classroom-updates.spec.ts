import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";

test("lecture upload, live-start races, fullscreen and two-browser discussion moderation", async ({
  browser,
}) => {
  test.setTimeout(180000);
  const teacher = await browser.newContext({
    baseURL: "http://localhost:8080",
    viewport: { width: 1360, height: 900 },
  });
  const student = await browser.newContext({
    baseURL: "http://localhost:8080",
    viewport: { width: 390, height: 844 },
  });
  const suffix = Date.now(),
    courses: string[] = [];
  const t = await teacher.newPage(),
    s = await student.newPage();
  try {
    for (const [client, role] of [
      [teacher, "lecturer"],
      [student, "student"],
    ] as const) {
      expect(
        (
          await client.request.post("/api/v1/auth/register", {
            data: {
              name: `Updates ${role}`,
              email: `updates-${role}-${suffix}@example.com`,
              password: "updates-test-password",
              role,
            },
          })
        ).status(),
      ).toBe(201);
    }
    const cid = (
      await (
        await teacher.request.post("/api/v1/courses", {
          data: { name: `Classroom updates ${suffix}` },
        })
      ).json()
    ).id;
    courses.push(cid);
    await teacher.request.post(`/api/v1/courses/${cid}/members`, {
      data: { email: `updates-student-${suffix}@example.com` },
    });
    await t.goto(`/courses/${cid}/lectures`);
    await t
      .getByRole("button", { name: "Create lecture", exact: true })
      .click();
    const dialog = t.getByRole("dialog", { name: "Create a lecture" });
    await expect(dialog.getByText(/No prepared slide decks yet/)).toBeVisible();
    await dialog
      .getByLabel("Lecture title")
      .fill("Uploaded during lecture setup");
    // A malformed authored PDF exercises genuine worker failure and retry, without fake processing results.
    await dialog
      .getByLabel("Upload slides", { exact: true })
      .setInputFiles({
        name: "broken.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from(
          "%PDF-1.7\nintentionally incomplete test document\n",
        ),
      });
    await expect(
      dialog.getByText(/broken.pdf · Slide preparation failed/),
    ).toBeVisible({ timeout: 30000 });
    const retried = t.waitForResponse(
      (r) => r.url().endsWith("/reprocess") && r.request().method() === "POST",
    );
    await dialog
      .getByRole("button", { name: "Retry slide preparation", exact: true })
      .click();
    expect((await retried).status()).toBe(202);
    await expect(
      dialog.getByText(/broken.pdf · Slide preparation failed/),
    ).toBeVisible({ timeout: 30000 });
    // Inject only a transport failure; retry uses the actual server and converter.
    await t.route(`**/courses/${cid}/resources`, async (route) => {
      if (route.request().method() === "POST") {
        await route.abort("failed");
        await t.unroute(`**/courses/${cid}/resources`);
      } else await route.continue();
    });
    await dialog
      .getByLabel("Upload slides", { exact: true })
      .setInputFiles(path.resolve("e2e/deck.pdf"));
    await dialog
      .getByRole("button", { name: "Retry upload", exact: true })
      .click();
    await expect(dialog.getByText(/deck.pdf · Slides ready/)).toBeVisible({
      timeout: 30000,
    });
    await expect(dialog.getByLabel("Lecture title")).toHaveValue(
      "Uploaded during lecture setup",
    );
    const rid = await dialog.getByLabel("Prepared slide deck").inputValue();
    expect(rid).not.toBe("");
    await t.screenshot({ path: "test-results/create-lecture-upload.png" });
    await dialog
      .getByRole("button", { name: "Create lecture", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    const lid = (
      await (
        await teacher.request.get(`/api/v1/courses/${cid}/lectures`)
      ).json()
    )[0].id;
    const lid2 = (
      await (
        await teacher.request.post(`/api/v1/courses/${cid}/lectures`, {
          data: { title: "Competing lecture", slide_resource_id: rid },
        })
      ).json()
    ).id;
    const starts = await Promise.all(
      [lid, lid2].map((id) =>
        teacher.request.post(`/api/v1/lectures/${id}/sessions/start`, {
          data: {},
        }),
      ),
    );
    expect(starts.map((r) => r.status()).sort()).toEqual([200, 409]);
    const winner = starts[0].status() === 200 ? lid : lid2,
      loser = winner === lid ? lid2 : lid;
    const sid = (await starts.find((r) => r.status() === 200)!.json()).id;
    expect(
      (await starts.find((r) => r.status() === 409)!.json()).active_session.id,
    ).toBe(sid);
    expect(
      (
        await (
          await teacher.request.post(
            `/api/v1/lectures/${winner}/sessions/start`,
            { data: {} },
          )
        ).json()
      ).id,
    ).toBe(sid);
    await t.goto(`/lectures/${loser}`);
    await expect(
      t.getByRole("link", { name: "Open live lecture" }),
    ).toHaveAttribute("href", `/sessions/${sid}`);
    await expect(
      t.getByRole("button", { name: "Start lecture", exact: true }),
    ).toBeDisabled();
    const cid2 = (
      await (
        await teacher.request.post("/api/v1/courses", {
          data: { name: `Independent live ${suffix}` },
        })
      ).json()
    ).id;
    courses.push(cid2);
    const rid2 = (
      await (
        await teacher.request.post(`/api/v1/courses/${cid2}/resources`, {
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
          (
            await (
              await teacher.request.get(`/api/v1/resources/${rid2}`)
            ).json()
          ).process_status,
        { timeout: 30000 },
      )
      .toBe("ready");
    const other = (
      await (
        await teacher.request.post(`/api/v1/courses/${cid2}/lectures`, {
          data: { title: "Independent", slide_resource_id: rid2 },
        })
      ).json()
    ).id;
    expect(
      (
        await teacher.request.post(`/api/v1/lectures/${other}/sessions/start`, {
          data: {},
        })
      ).status(),
    ).toBe(200);
    for (const mode of ["", "?mode=presenter"]) {
      await t.goto(`/sessions/${sid}${mode}`);
      await t
        .getByRole("button", { name: "Fullscreen slides", exact: true })
        .click();
      await expect
        .poll(() => t.evaluate(() => !!document.fullscreenElement))
        .toBe(true);
      for (const name of [
        "Previous slide",
        "Next slide",
        "Annotate",
        "Clear slide ink",
        "Exit fullscreen",
      ]) {
        const control = t.getByRole("button", { name, exact: true });
        await expect(control).toBeVisible();
        const box = (await control.boundingBox())!;
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.y + box.height).toBeLessThanOrEqual(901);
      }
      await t.keyboard.press("ArrowRight");
      await expect(t.getByText("Slide 2 / 2")).toBeVisible();
      await t.keyboard.press("ArrowLeft");
      await expect(t.getByText("Slide 1 / 2")).toBeVisible();
      await t.screenshot({
        path: `test-results/fullscreen-${mode ? "projector" : "control"}.png`,
      });
      await t
        .getByRole("button", { name: "Exit fullscreen", exact: true })
        .click();
      await expect
        .poll(() => t.evaluate(() => !!document.fullscreenElement))
        .toBe(false);
      await t
        .getByRole("button", { name: "Fullscreen slides", exact: true })
        .click();
      await t.keyboard.press("Escape");
      await expect
        .poll(() => t.evaluate(() => !!document.fullscreenElement))
        .toBe(false);
    }
    await s.goto(`/courses/${cid}/discussions`);
    await t.goto(`/courses/${cid}/discussions`);
    await s
      .getByRole("button", { name: "Ask a question", exact: true })
      .click();
    await expect(s.getByLabel("Ask anonymously")).toHaveCount(0);
    const text = `Violet platypus wingspan observation ${suffix}?`;
    await s.getByLabel("Your question").fill(text);
    const checked = s.waitForResponse(
      (r) =>
        r.url().endsWith("/questions/preflight") &&
        r.request().method() === "POST",
    );
    const posted = s.waitForResponse(
      (r) =>
        r.url().endsWith(`/courses/${cid}/questions`) &&
        r.request().method() === "POST",
    );
    await s.getByRole("button", { name: "Post question", exact: true }).click();
    const check = await (await checked).json();
    expect(check.status).toBe("complete");
    expect(check.matches).toHaveLength(0);
    const response = await posted,
      question = await response.json(),
      payload = response.request().postDataJSON();
    await expect(s.getByRole("dialog")).toHaveCount(0);
    await expect(
      s.getByText(/No similar course sources were found/),
    ).toBeVisible();
    const duplicates = await Promise.all(
      [1, 2].map(() =>
        student.request.post(`/api/v1/courses/${cid}/questions`, {
          data: payload,
        }),
      ),
    );
    for (const response of duplicates)
      expect((await response.json()).id).toBe(question.id);
    await expect(
      t.getByRole("button", { name: text, exact: true }),
    ).toBeVisible();
    const teacherCard = t.locator(".question-card").filter({ hasText: text });
    await expect(
      teacherCard.getByRole("button", { name: "Edit", exact: true }),
    ).toHaveCount(0);
    await t.getByRole("button", { name: text, exact: true }).click();
    await s.getByRole("button", { name: text, exact: true }).click();
    await s
      .getByLabel("Add to the discussion")
      .fill("Student reply for moderation");
    await s.getByRole("button", { name: "Post reply", exact: true }).click();
    const teacherReply = t
      .locator(".reply")
      .filter({ hasText: "Student reply for moderation" });
    await expect(teacherReply).toBeVisible();
    await expect(
      teacherReply.getByRole("button", { name: "Edit reply", exact: true }),
    ).toHaveCount(0);
    await teacherReply
      .getByRole("button", { name: "Delete reply", exact: true })
      .click();
    await expect(
      s.getByText("Student reply for moderation", { exact: true }),
    ).toHaveCount(0);
    await teacherCard
      .getByRole("button", { name: "Delete", exact: true })
      .click();
    await expect(
      s.getByRole("button", { name: text, exact: true }),
    ).toHaveCount(0);
    await expect(
      s
        .getByRole("alert")
        .filter({ hasText: "This discussion is no longer available." }),
    ).toBeVisible();
    await s.screenshot({ path: "test-results/discussion-deletion-mobile.png" });
    expect(
      (await teacher.request.post(`/api/v1/sessions/${sid}/end`)).status(),
    ).toBe(200);
    expect(
      (
        await teacher.request.post(`/api/v1/lectures/${loser}/sessions/start`, {
          data: {},
        })
      ).status(),
    ).toBe(200);
  } finally {
    for (const cid of courses)
      expect(
        (await teacher.request.delete(`/api/v1/courses/${cid}`)).status(),
      ).toBe(204);
    await teacher.close();
    await student.close();
  }
});
