import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

test.skip(
  process.env.RUN_BSL_E2E !== "1",
  "Requires optional local Kozha service (compose.bsl.yaml)",
);

// Only operator-authored test captions in this exact disposable session, never a product endpoint.
function finalCaption(sid: string, text: string, item: string) {
  const result = spawnSync(
    "docker",
    [
      "compose",
      "exec",
      "-T",
      "api",
      "python",
      "-c",
      `
import json,sys
from sqlalchemy import select
from app.db import SessionLocal
from app.models import LiveSession,Transcript
from app.classroom import emit,offset
v=json.load(sys.stdin)
with SessionLocal() as db:
 s=db.get(LiveSession,v['sid']); ms=offset(s)
 t=db.scalar(select(Transcript).where(Transcript.session_id==s.id,Transcript.item_id==v['item']))
 if t is None:
  t=Transcript(session_id=s.id,item_id=v['item'],text=v['text'],start_ms=max(0,ms-2000),end_ms=ms);db.add(t);db.flush()
 emit(db,s,'transcript.final',{'item_id':t.item_id,'text':t.text,'start_ms':t.start_ms,'end_ms':t.end_ms})
 db.commit();print(t.id)
`,
    ],
    {
      cwd: path.resolve("../.."),
      input: JSON.stringify({ sid, text, item }),
      encoding: "utf8",
    },
  );
  if (result.status !== 0) throw Error(result.stderr);
  return result.stdout.trim();
}

test("standalone corpus renderer then mobile student final-caption queue, failure and session end", async ({
  browser,
}) => {
  test.setTimeout(180000);
  const teacher = await browser.newContext({
    baseURL: "http://localhost:8080",
    ...(process.env.RUN_BSL_SPEECH === "1"
      ? { permissions: ["microphone"] }
      : {}),
  });
  const student = await browser.newContext({
    baseURL: "http://localhost:8080",
    viewport: { width: 360, height: 800 },
    hasTouch: true,
  });
  const suffix = randomUUID();
  for (const [context, role] of [
    [teacher, "lecturer"],
    [student, "student"],
  ] as const) {
    expect(
      (
        await context.request.post("/api/v1/auth/register", {
          data: {
            name: `BSL ${role}`,
            email: `${role}-${suffix}@example.com`,
            password: "bsl-browser-fixture",
            role,
          },
        })
      ).ok(),
    ).toBeTruthy();
  }
  const cid = (
    await (
      await teacher.request.post("/api/v1/courses", {
        data: { name: `BSL browser fixture ${suffix}` },
      })
    ).json()
  ).id;
  try {
    await teacher.request.post(`/api/v1/courses/${cid}/members`, {
      data: { email: `student-${suffix}@example.com` },
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
        { timeout: 60000 },
      )
      .toBe("ready");
    const lid = (
      await (
        await teacher.request.post(`/api/v1/courses/${cid}/lectures`, {
          data: { title: "Experimental BSL test", slide_resource_id: rid },
        })
      ).json()
    ).id;
    const sid = (
      await (
        await teacher.request.post(`/api/v1/lectures/${lid}/sessions/start`, {
          data: { recording_enabled: process.env.RUN_BSL_SPEECH === "1" },
        })
      ).json()
    ).id;
    expect(
      (await student.request.get(`/api/v1/sessions/${sid}/bsl/config`)).ok(),
    ).toBeTruthy();
    const home = await student.request.get("/");
    expect(home.headers()["content-security-policy"]).toContain(
      "frame-ancestors 'none'",
    );
    expect(home.headers()["content-security-policy"]).not.toContain(
      "'unsafe-eval'",
    );
    const frameResponse = await student.request.get(
      `/api/v1/sessions/${sid}/bsl/assets/panel.html`,
      { headers: { "Sec-Fetch-Dest": "iframe" } },
    );
    expect(frameResponse.headers()["content-security-policy"]).toContain(
      "frame-ancestors 'self'",
    );
    expect(
      frameResponse.headers()["content-security-policy"].split("default-src"),
    ).toHaveLength(2);
    expect(frameResponse.headers()["cache-control"]).toBe("no-store");
    const head = await student.request.head(
      `/api/v1/sessions/${sid}/bsl/assets/cwa/avatars/anna.jar`,
    );
    expect(head.status()).toBe(200);
    expect(Number(head.headers()["content-length"])).toBeGreaterThan(100000);
    const range = await student.request.get(
      `/api/v1/sessions/${sid}/bsl/assets/cwa/avatars/anna.jar`,
      { headers: { Range: "bytes=0-31" } },
    );
    expect(range.status()).toBe(206);
    expect((await range.body()).length).toBe(32);
    const page = await student.newPage();
    const errors: string[] = [],
      externalRequests: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("request", (r) => {
      if (
        r.url().startsWith("https:") ||
        (r.url().startsWith("http:") &&
          new URL(r.url()).origin !== "http://localhost:8080")
      )
        externalRequests.push(new URL(r.url()).origin);
    });
    // First validate standalone known-corpus rendering, independent of live transport/planner.
    await page.goto(`/api/v1/sessions/${sid}/bsl/assets/test.html`);
    await expect(page.getByRole("status")).toHaveText(
      "Corpus and 3D avatar ready.",
      { timeout: 45000 },
    );
    await expect(page.locator("iframe")).toBeVisible();
    await page.getByRole("button", { name: "Play prepared script" }).click();
    await expect(page.getByRole("status")).toHaveText(
      "Corpus script completed.",
      { timeout: 60000 },
    );
    await page.screenshot({
      path: "test-results/bsl-standalone.png",
      fullPage: true,
    });
    console.log(
      "Standalone BSL corpus script completed; browser errors:",
      errors,
    );

    await page.goto(`/sessions/${sid}`);
    await expect(
      page.getByRole("button", { name: "BSL Avatar (Experimental)" }),
    ).toBeVisible();
    const planRequests: string[] = [];
    page.on("request", (r) => {
      if (r.url().endsWith("/bsl/plan")) planRequests.push(r.postData() || "");
    });
    await page
      .getByRole("button", { name: "BSL Avatar (Experimental)" })
      .click();
    const panel = page.getByLabel("BSL Avatar (Experimental)", { exact: true });
    await expect(
      panel.getByRole("button", { name: "Pause signing" }),
    ).toBeEnabled({ timeout: 45000 });
    // Let the first snapshot establish its baseline, then emit an actual persisted final event.
    await expect(
      panel.getByText("Captions fallback", { exact: true }),
    ).toBeVisible();
    await page.waitForTimeout(500);
    const start = Date.now();
    finalCaption(sid, "Read a book.", "bsl-read");
    await expect(
      panel.getByText("Signing source caption: Read a book."),
    ).toBeVisible({ timeout: 12000 });
    console.log("Final caption to renderer dispatch ms:", Date.now() - start);
    await expect(panel.getByRole("status")).toContainText(
      "Sequence completed",
      { timeout: 30000 },
    );
    const count = planRequests.length;
    finalCaption(sid, "Read a book.", "bsl-read");
    await page.waitForTimeout(2500);
    expect(planRequests.length).toBe(count);
    await panel.getByRole("button", { name: "Pause signing" }).click();
    finalCaption(sid, "Ask a question.", "bsl-ask");
    await expect(panel.getByRole("status")).toContainText("Paused");
    await panel.getByLabel("Signing speed").selectOption("0.5");
    await panel.getByRole("button", { name: "Resume signing" }).click();
    await expect(
      panel.getByText("Signing source caption: Ask a question."),
    ).toBeVisible({ timeout: 12000 });
    await expect(panel.getByRole("status")).toContainText(
      "Sequence completed",
      { timeout: 30000 },
    );
    await panel.scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    for (const button of await panel.getByRole("button").all()) {
      const box = await button.boundingBox();
      if (box) expect(box.x + box.width).toBeLessThanOrEqual(361);
    }
    await page.screenshot({
      path: "test-results/bsl-mobile.png",
      fullPage: true,
    });
    // Verify actual native engine suspension and speed controls, not only button labels.
    await panel.getByRole("button", { name: "Play prepared script" }).click();
    await expect(panel.getByRole("status")).toContainText(
      "Signing prepared corpus vocabulary",
      { timeout: 45000 },
    );
    await panel.getByRole("button", { name: "Pause signing" }).click();
    const avatar = page.frameLocator(
      'iframe[title="Experimental BSL signing avatar"]',
    );
    await expect(avatar.locator(".bttnResume.av0")).toBeEnabled();
    await expect(avatar.locator(".txtLogSpeed.av0")).toHaveValue("-1.00");
    await page.waitForTimeout(500);
    await panel.getByRole("button", { name: "Resume signing" }).click();
    await expect(panel.getByRole("status")).toContainText(
      "Prepared corpus script completed",
      { timeout: 45000 },
    );
    await panel.getByRole("button", { name: "Follow captions" }).click();
    await expect(
      panel.getByRole("button", { name: "Pause signing" }),
    ).toBeEnabled({ timeout: 45000 });
    finalCaption(sid, "The eigenvector is orthogonal.", "bsl-unsupported");
    await expect(panel.getByRole("status")).toContainText(
      "corpus vocabulary is incomplete",
      { timeout: 12000 },
    );
    await expect(
      panel.getByText(/1 segment\(s\) missed or unsupported/),
    ).toBeVisible();
    await page.setViewportSize({ width: 1280, height: 800 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: "test-results/bsl-desktop.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 360, height: 800 });
    // WebGL failure from the actual iframe's trusted source tears down renderer, retains text.
    await page
      .frameLocator('iframe[title="Experimental BSL signing avatar"]')
      .locator("canvas")
      .evaluate((canvas) =>
        canvas.dispatchEvent(
          new Event("webglcontextlost", { cancelable: true }),
        ),
      );
    await expect(panel.getByRole("status")).toContainText("Avatar unavailable");
    await expect(
      panel.getByText("The eigenvector is orthogonal.", { exact: true }),
    ).toBeVisible();
    await expect(panel.locator("iframe")).toHaveCount(0);
    await panel.getByRole("button", { name: "Retry renderer" }).click();
    await expect(
      panel.getByRole("button", { name: "Pause signing" }),
    ).toBeEnabled({ timeout: 45000 });
    let captured: { id: string; start_ms: number; text: string } | undefined;
    if (process.env.RUN_BSL_SPEECH === "1") {
      const lecturer = await teacher.newPage();
      await lecturer.goto(`/sessions/${sid}`);
      const micStart = Date.now();
      await lecturer
        .getByRole("button", { name: "Start microphone", exact: true })
        .click();
      await expect(
        lecturer.getByRole("button", { name: "Pause microphone", exact: true }),
      ).toBeVisible();
      await expect
        .poll(
          async () => {
            const rows = await (
              await student.request.get(`/api/v1/sessions/${sid}/transcript`)
            ).json();
            captured = rows.find(
              (c: { item_id: string; text: string }) =>
                !c.item_id.startsWith("bsl-") &&
                c.text.toLowerCase().includes("book"),
            );
            return !!captured;
          },
          { timeout: 30000 },
        )
        .toBe(true);
      await expect(
        panel.getByText(/Signing source caption:.*book/i),
      ).toBeVisible({ timeout: 15000 });
      console.log(
        "Actual microphone start to BSL dispatch ms:",
        Date.now() - micStart,
      );
      await lecturer
        .getByRole("button", { name: "Pause microphone", exact: true })
        .click();
      await lecturer.close();
    }
    await teacher.request.post(`/api/v1/sessions/${sid}/end`, { data: {} });
    await expect(page.getByText("LECTURE COMPLETE")).toBeVisible({
      timeout: 10000,
    });
    await expect(
      page.locator('iframe[title="Experimental BSL signing avatar"]'),
    ).toHaveCount(0);
    await page.getByRole("link", { name: "Open lecture archive" }).click();
    await expect(
      page.getByRole("button", { name: "BSL Avatar (Experimental)" }),
    ).toBeVisible();
    if (captured) {
      await expect
        .poll(
          async () =>
            (
              await (
                await student.request.get(
                  `/api/v1/sessions/${sid}/processing-status`,
                )
              ).json()
            ).recording_state,
          { timeout: 30000 },
        )
        .toBe("ready");
      await page
        .getByRole("button", { name: "BSL Avatar (Experimental)" })
        .click();
      await expect(
        page.getByRole("button", { name: "Pause signing" }),
      ).toBeEnabled({ timeout: 45000 });
      const at = captured.start_ms / 1000 + 0.1;
      await page
        .locator("audio")
        .evaluate(async (audio: HTMLAudioElement, seconds) => {
          audio.currentTime = seconds;
          await audio.play();
        }, at);
      await expect(
        page.getByText(/Signing source caption:.*book/i),
      ).toBeVisible({ timeout: 15000 });
      await page
        .locator("audio")
        .evaluate((audio: HTMLAudioElement) => audio.pause());
      await expect(
        page
          .frameLocator('iframe[title="Experimental BSL signing avatar"]')
          .locator(".bttnResume.av0"),
      ).toBeEnabled();
      console.log("Replay signed actual retained caption ID:", captured.id);
    }
    const teacherPage = await teacher.newPage();
    await teacherPage.goto(`/sessions/${sid}`);
    expect(
      (
        await teacher.request.get(`/api/v1/sessions/${sid}/bsl/config`)
      ).status(),
    ).toBe(403);
    expect(
      (
        await student.request.post("/api/translate", {
          data: { text: "anything" },
        })
      ).status(),
    ).toBe(404);
    expect(errors).toEqual([]);
    expect(externalRequests).toEqual([]);
  } finally {
    await teacher.request.delete(`/api/v1/courses/${cid}`);
    await teacher.close();
    await student.close();
  }
});
