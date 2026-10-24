import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";

// Explicit test-only authored artifact. No fixture generation endpoint exists in the product.
function seedRevision(lid: string, index: number, title: string) {
  const artifact = {
    title,
    summary: "Observe how a search interval shrinks with repeated halving.",
    instructions:
      "Change Halving steps or tap Next step. Reset restores 256 candidates.",
    accessibility_description:
      "Remaining candidates is written numerically after each step.",
    html: '<div id="ll-diagram" data-layout="responsive-v2"><section data-region="visual"><svg viewBox="0 0 600 360" role="img" aria-label="Search interval"><rect x="20" y="120" width="560" height="100" fill="#1c584b"></rect></svg></section><section data-region="controls"><label for="steps">Halving steps</label><input id="steps" type="range" min="0" max="8" value="0"><p>Remaining candidates: <output id="remaining">256</output></p><button id="next">Next step</button><button id="reset">Reset</button></section></div>',
    css: "input{width:100%}button{margin:8px}output{font-weight:bold}",
    javascript: `const steps=document.querySelector('#steps'), remaining=document.querySelector('#remaining');function update(){remaining.textContent=String(256/2**Number(steps.value));document.querySelector('rect').setAttribute('width',String(560/2**Number(steps.value)));}steps.addEventListener('input',update);document.querySelector('#next').addEventListener('click',()=>{steps.value=String(Math.min(8,Number(steps.value)+1));update();});document.querySelector('#reset').addEventListener('click',()=>{steps.value='0';update();});`,
  };
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
from app.db import SessionLocal
from app.models import Lecture,Resource,Job,DiagramRevision,uid
from app.ai.diagrams import slide_image
from app.diagram_render import validate_artifact
v=json.load(sys.stdin)
with SessionLocal() as db:
 l=db.get(Lecture,v['lid']);r=db.get(Resource,l.slide_resource_id)
 j=Job(id=uid(),type='generate_diagram',target_id=uid(),course_id=l.course_id,status='ready');db.add(j);db.flush()
 d=DiagramRevision(id=j.target_id,lecture_id=l.id,course_id=l.course_id,slide_index=v['index'],request_id=uid(),source_fingerprint=slide_image(r,v['index']),status='preview',model='authored-browser-test-fixture',job_id=j.id,artifact=validate_artifact(v['artifact']).model_dump())
 db.add(d);db.commit();print(d.id)
`,
    ],
    {
      cwd: path.resolve("../.."),
      input: JSON.stringify({ lid, index, artifact }),
      encoding: "utf8",
    },
  );
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}

test("approved diagrams execute in an opaque CSP iframe, follow live slides and replay on mobile", async ({
  browser,
}) => {
  // The shared single worker may already be finishing a real provider call.
  test.setTimeout(180000);
  const teacher = await browser.newContext({
    baseURL: "http://localhost:8080",
  });
  const student = await browser.newContext({
    baseURL: "http://localhost:8080",
    viewport: { width: 360, height: 780 },
    hasTouch: true,
  });
  const suffix = randomUUID();
  await teacher.request.post("/api/v1/auth/register", {
    data: {
      name: "Diagram lecturer",
      email: `diagram-t-${suffix}@example.com`,
      password: "diagram-test-password",
      role: "lecturer",
    },
  });
  await student.request.post("/api/v1/auth/register", {
    data: {
      name: "Diagram learner",
      email: `diagram-s-${suffix}@example.com`,
      password: "diagram-test-password",
      role: "student",
    },
  });
  const cid = (
    await (
      await teacher.request.post("/api/v1/courses", {
        data: { name: `Diagram browser fixture ${suffix}` },
      })
    ).json()
  ).id;
  try {
    expect(
      (
        await teacher.request.post(`/api/v1/courses/${cid}/members`, {
          data: { email: `diagram-s-${suffix}@example.com` },
        })
      ).ok(),
    ).toBeTruthy();
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
        { timeout: 120000 },
      )
      .toBe("ready");
    const lid = (
      await (
        await teacher.request.post(`/api/v1/courses/${cid}/lectures`, {
          data: {
            title: "Diagram isolation and replay",
            slide_resource_id: rid,
          },
        })
      ).json()
    ).id;
    const did = seedRevision(lid, 0, "Authored halving experiment");
    const rejected = seedRevision(lid, 1, "Unapproved preview");
    const previewPath = `/api/v1/diagrams/${rejected}/render?viewer=${randomUUID()}`;
    expect(
      (
        await student.request.get(previewPath, {
          headers: {
            "sec-fetch-dest": "iframe",
            "sec-fetch-site": "same-origin",
          },
        })
      ).status(),
    ).toBe(404);
    expect(
      (
        await student.request.get(
          `/api/v1/lectures/${lid}/diagrams/preparation`,
        )
      ).status(),
    ).toBe(403);
    const t = await teacher.newPage();
    const appResponse = await t.goto(`/lectures/${lid}`);
    const mainCsp = appResponse!.headers()["content-security-policy"];
    expect(mainCsp).toContain("frame-ancestors 'none'");
    expect(mainCsp).toContain("script-src 'self' 'wasm-unsafe-eval'");
    await expect(
      t.getByRole("button", { name: "Generate selected · 0 slides" }),
    ).toBeDisabled();
    await t.getByLabel("Select slide 1", { exact: true }).check();
    await t.getByLabel("Select slide 2", { exact: true }).check();
    await expect(
      t.getByRole("button", { name: "Generate selected · 2 slides" }),
    ).toBeEnabled();
    await t
      .getByRole("button", { name: "Generate selected · 2 slides" })
      .click();
    await expect(t.getByRole("dialog")).toHaveAccessibleName(
      "Generate interactive diagrams",
    );
    await t
      .getByLabel("Teaching notes (optional)")
      .fill("Compare the two cases.");
    await t.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(t.getByRole("dialog")).toHaveCount(0);
    expect(
      (
        await (
          await teacher.request.get(
            `/api/v1/lectures/${lid}/diagrams/preparation`,
          )
        ).json()
      ).revisions,
    ).toHaveLength(2);
    await t.setViewportSize({ width: 360, height: 780 });
    const replacement = t.getByRole("button", {
      name: "Generate replacement",
      exact: true,
    });
    await replacement.click();
    await t
      .getByLabel("Teaching notes (optional)")
      .fill("Show a comparison beside the original case.");
    await expect(
      t.getByRole("button", { name: "Generate preview", exact: true }),
    ).toBeVisible();
    const notesLayout = await t.getByRole("dialog").evaluate((dialog) => ({
      fits: dialog.getBoundingClientRect().width <= innerWidth,
      overflow: dialog.scrollWidth > dialog.clientWidth,
    }));
    expect(notesLayout).toEqual({ fits: true, overflow: false });
    await t.screenshot({
      path: "test-results/diagram-teaching-notes-mobile.png",
    });
    await t.keyboard.press("Escape");
    await expect(t.getByRole("dialog")).toHaveCount(0);
    await expect(replacement).toBeFocused();
    await t.setViewportSize({ width: 1280, height: 720 });
    await t.getByRole("button", { name: "View slide 2", exact: true }).click();
    await t.getByRole("button", { name: "View slide 1", exact: true }).click();
    await t
      .getByRole("button", { name: "Clear selection", exact: true })
      .click();
    await t.screenshot({
      path: "test-results/diagram-preparation-workspace.png",
      fullPage: true,
    });
    await t.getByRole("button", { name: "Review ready previews · 2" }).click();
    const f = t.frameLocator("iframe.diagram-frame");
    await expect(f.locator("#remaining")).toHaveText("256");
    await f.getByText("Next step", { exact: true }).click();
    await expect(f.locator("#remaining")).toHaveText("128");
    await t
      .getByRole("button", { name: "Expand original slide", exact: true })
      .click();
    await expect(t.locator(".diagram-source-expanded img")).toBeVisible();
    await t
      .locator(".diagram-source-expanded")
      .getByRole("button", { name: "Back to diagram", exact: true })
      .click();

    for (const viewport of [
      { width: 1280, height: 720 },
      { width: 1440, height: 900 },
    ]) {
      await t.setViewportSize(viewport);
      const box = await t.locator("iframe.diagram-frame").boundingBox();
      expect(box!.width).toBeGreaterThan(viewport.width * 0.65);
      expect(box!.height).toBeGreaterThan(viewport.height * 0.7);
      const frame = await (await t
        .locator("iframe.diagram-frame")
        .elementHandle())!.contentFrame();
      const layout = await frame!.evaluate(() => ({
        horizontal: document.documentElement.scrollWidth > innerWidth,
        vertical: document.documentElement.scrollHeight > innerHeight + 1,
        visual:
          document
            .querySelector('[data-region="visual"]')!
            .getBoundingClientRect().width / innerWidth,
      }));
      expect(layout).toEqual({
        horizontal: false,
        vertical: false,
        visual: expect.any(Number),
      });
      expect(layout.visual).toBeGreaterThan(0.55);
      await t.screenshot({
        path: `test-results/diagram-review-${viewport.width}.png`,
      });
    }

    await t
      .getByRole("button", { name: "Approve and next", exact: true })
      .click();
    await expect(t.getByRole("dialog")).toHaveAccessibleName(
      "Unapproved preview",
    );
    await t
      .getByRole("button", { name: "Reject and next", exact: true })
      .click();
    await expect(t.getByRole("dialog")).toHaveCount(0);
    // Start remains the ordinary primary action; only the approved revision is frozen.
    await t.getByRole("button", { name: "Start lecture", exact: true }).click();
    await expect(t).toHaveURL(/\/sessions\//);
    const sid = t.url().split("/sessions/")[1].split("?")[0];
    const page = await student.newPage();
    await page.goto(`/sessions/${sid}`);
    await expect(
      page.getByRole("dialog", { name: "Explore this slide" }),
    ).toBeVisible();
    await page.screenshot({
      path: "test-results/student-diagram-alert.png",
      fullPage: true,
    });
    await expect(
      page.getByText("Explore interactive diagram", { exact: true }),
    ).toBeVisible();
    const responsePromise = page.waitForResponse((r) =>
      r.url().includes(`/diagrams/${did}/render?`),
    );
    await page
      .getByRole("button", { name: "Explore diagram", exact: true })
      .click();
    const renderResponse = await responsePromise;
    expect(renderResponse.status()).toBe(200);
    const csp = renderResponse.headers()["content-security-policy"];
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).not.toContain("frame-ancestors 'none'");
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("sandbox allow-scripts");
    expect(renderResponse.headers()["cache-control"]).toContain("no-store");
    const iframe = page.locator("iframe.diagram-frame");
    await expect(iframe).toHaveAttribute("sandbox", "allow-scripts");
    const inner = page.frameLocator("iframe.diagram-frame");
    await expect(inner.locator("#remaining")).toHaveText("256");
    await inner.getByRole("slider", { name: "Halving steps" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(inner.locator("#remaining")).toHaveText("128");
    await inner.getByText("Next step", { exact: true }).tap();
    await expect(inner.locator("#remaining")).toHaveText("64");
    const frame = await (await iframe.elementHandle())!.contentFrame();
    const boundaries = await frame!.evaluate(() => {
      let parentBlocked = false,
        cookiesBlocked = false;
      try {
        void window.parent.document.body;
      } catch {
        parentBlocked = true;
      }
      try {
        void document.cookie;
      } catch {
        cookiesBlocked = true;
      }
      return { parentBlocked, cookiesBlocked };
    });
    expect(boundaries).toEqual({ parentBlocked: true, cookiesBlocked: true });
    let outbound = 0;
    page.on("request", (r) => {
      if (r.url().startsWith("https://diagram-probe.invalid")) outbound++;
    });
    const network = await frame!.evaluate(async () => {
      let violated = false;
      document.addEventListener("securitypolicyviolation", (e) => {
        if (e.effectiveDirective === "connect-src") violated = true;
      });
      let blocked = false;
      try {
        await fetch("https://diagram-probe.invalid/forbidden");
      } catch {
        blocked = true;
      }
      await new Promise((r) => setTimeout(r, 50));
      return { blocked, violated };
    });
    expect(network).toEqual({ blocked: true, violated: true });
    expect(outbound).toBe(0);
    await expect(page.locator("#remaining")).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: "test-results/interactive-diagram-mobile.png",
      fullPage: true,
    });
    // Escape from within the frame reaches the trusted wrapper and closes the modal.
    await inner.getByText("Reset", { exact: true }).focus();
    await page.keyboard.press("Escape");
    await expect(page.locator("iframe.diagram-frame")).toHaveCount(0);
    await expect(
      page.getByText("Explore interactive diagram", { exact: true }),
    ).toBeFocused();
    await page
      .getByText("Explore interactive diagram", { exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Explore this slide" }),
    ).toHaveCount(0);
    await expect(
      page.frameLocator("iframe.diagram-frame").locator("#remaining"),
    ).toHaveText("256");
    await teacher.request.post(`/api/v1/sessions/${sid}/slides/change`, {
      data: { index: 1 },
    });
    await expect(page.locator("iframe.diagram-frame")).toHaveCount(0);
    await expect(
      page.getByText("Explore interactive diagram", { exact: true }),
    ).toHaveCount(0);
    expect(
      (
        await teacher.request.post(`/api/v1/diagrams/${did}/reject`, {
          data: {},
        })
      ).status(),
    ).toBe(409);
    await teacher.request.post(`/api/v1/sessions/${sid}/end`, { data: {} });
    await page.goto(`/recordings/${sid}`);
    await expect(
      page.getByText("Explore interactive diagram", { exact: true }),
    ).toBeVisible();
    await page
      .getByText("Explore interactive diagram", { exact: true })
      .click();
    await expect(
      page.frameLocator("iframe.diagram-frame").locator("#remaining"),
    ).toHaveText("256");
    await page
      .getByRole("button", { name: "Close exploration", exact: true })
      .click();
    await page
      .getByRole("navigation", { name: "Slide timeline" })
      .getByRole("button", { name: /Slide 2/ })
      .click();
    await expect(
      page.getByText("Explore interactive diagram", { exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("navigation", { name: "Slide timeline" })
      .getByRole("button", { name: /Slide 1/ })
      .click();
    await page
      .getByText("Explore interactive diagram", { exact: true })
      .click();
    await page
      .frameLocator("iframe.diagram-frame")
      .getByText("Next step", { exact: true })
      .click();
    await expect(
      page.frameLocator("iframe.diagram-frame").locator("#remaining"),
    ).toHaveText("128");
    await page
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    expect(
      (
        await student.request.get(
          `/api/v1/diagrams/${did}/render?viewer=${randomUUID()}`,
        )
      ).status(),
    ).toBe(403);
    // Membership is checked for every render, including archived, guessable artifact URLs.
    const user = (await (await student.request.get("/api/v1/auth/me")).json())
      .id;
    await teacher.request.delete(`/api/v1/courses/${cid}/members/${user}`);
    expect(
      (
        await student.request.get(
          `/api/v1/diagrams/${did}/render?viewer=${randomUUID()}`,
          {
            headers: {
              "sec-fetch-dest": "iframe",
              "sec-fetch-site": "same-origin",
            },
          },
        )
      ).status(),
    ).toBe(404);
  } finally {
    expect(
      (await teacher.request.delete(`/api/v1/courses/${cid}`)).status(),
    ).toBe(204);
    await teacher.close();
    await student.close();
  }
});

test("real vision analysis and generation produce an approved operable replay experience", async ({
  browser,
}) => {
  test.skip(
    process.env.RUN_DIAGRAM_AI !== "1",
    "Explicit opt-in paid provider test using only authored disposable content",
  );
  test.setTimeout(240000);
  const context = await browser.newContext({
    baseURL: "http://localhost:8080",
  });
  const suffix = randomUUID();
  await context.request.post("/api/v1/auth/register", {
    data: {
      name: "Vision diagram validation",
      email: `vision-${suffix}@example.com`,
      password: "diagram-test-password",
      role: "lecturer",
    },
  });
  const cid = (
    await (
      await context.request.post("/api/v1/courses", {
        data: { name: `Authored vision test ${suffix}` },
      })
    ).json()
  ).id;
  try {
    // Own authored one-page source, generated locally; never exports existing course material.
    const pdf = spawnSync(path.resolve("../../apps/api/.venv/bin/python"), [
      "-c",
      `
import sys,io
from reportlab.pdfgen.canvas import Canvas
b=io.BytesIO();c=Canvas(b,pagesize=(900,600));c.setFont('Helvetica-Bold',28);c.drawString(45,545,'Binary search: repeated halving')
c.setFont('Helvetica',19)
for y,text in [(490,'Start with 256 sorted records.'),(450,'Each comparison halves the remaining candidate interval.'),(410,'After n halving steps: remaining candidates = 256 / 2^n.'),(370,'At most 8 halving steps leave 1 candidate.'),(100,'Explore steps 0 through 8 and explain why growth is logarithmic.')]:c.drawString(45,y,text)
for i in range(16):
 c.setFillColorRGB(.2,.5,.8) if i<8 else c.setFillColorRGB(.8,.8,.8)
 c.rect(45+i*49,240,42,65,fill=1,stroke=0)
c.save();sys.stdout.buffer.write(b.getvalue())
`,
    ]);
    expect(pdf.status, pdf.stderr.toString()).toBe(0);
    const rid = (
      await (
        await context.request.post(`/api/v1/courses/${cid}/resources`, {
          multipart: {
            file: {
              name: "authored-halving.pdf",
              mimeType: "application/pdf",
              buffer: pdf.stdout,
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
          data: {
            title: "Authored halving experiment",
            slide_resource_id: rid,
          },
        })
      ).json()
    ).id;
    const analysis = await context.request.post(
      `/api/v1/lectures/${lid}/diagrams/analyse`,
      { data: {} },
    );
    expect(analysis.status()).toBe(202);
    await expect
      .poll(
        async () =>
          (
            await (
              await context.request.get(
                `/api/v1/lectures/${lid}/diagrams/preparation`,
              )
            ).json()
          ).analysis.job.status,
        { timeout: 90000 },
      )
      .toBe("ready");
    const opportunities = (
      await (
        await context.request.get(
          `/api/v1/lectures/${lid}/diagrams/preparation`,
        )
      ).json()
    ).analysis;
    expect(opportunities.completed_pages).toBe(1);
    // Zero is valid; generation is explicitly manual regardless of the selection result.
    const page = await context.newPage();
    await page.goto(`/lectures/${lid}`);
    await page
      .getByRole("button", {
        name: "Generate interactive diagram",
        exact: true,
      })
      .click();
    const guidance =
      "Use a step slider from 0 through 8 and show the remaining candidate count after each halving.";
    await page.getByLabel("Teaching notes (optional)").fill(guidance);
    await page
      .getByRole("button", { name: "Generate preview", exact: true })
      .click();
    await expect
      .poll(
        async () => {
          const r = (
            await (
              await context.request.get(
                `/api/v1/lectures/${lid}/diagrams/preparation`,
              )
            ).json()
          ).revisions[0];
          return r?.status === "preview" ? "preview" : r?.job.status;
        },
        { timeout: 130000 },
      )
      .toBe("preview");
    const preparation = await (
      await context.request.get(`/api/v1/lectures/${lid}/diagrams/preparation`)
    ).json();
    expect(preparation.revisions[0].feedback).toBe(guidance);
    expect(preparation.revisions[0].model).toBeUndefined(); // preparation metadata contains no source/provider response
    await page
      .getByRole("button", { name: "Review preview", exact: true })
      .click();
    const frame = page.frameLocator("iframe.diagram-frame");
    const controls = frame.locator('[data-region="controls"]');
    await expect(controls).toContainText(/\b256\b/);
    const slider = controls.getByRole("slider").first();
    await expect(slider).toHaveValue("0");
    const before = await controls.innerText();
    await slider.focus();
    await page.keyboard.press("ArrowRight");
    await expect(slider).toHaveValue("1");
    await expect(controls).toContainText(/\b128\b/);
    expect(await controls.innerText()).not.toBe(before);
    for (const viewport of [
      { width: 1280, height: 720 },
      { width: 1440, height: 900 },
    ]) {
      await page.setViewportSize(viewport);
      await page.screenshot({
        path: `test-results/real-diagram-review-${viewport.width}.png`,
      });
      const child = await (await page
        .locator("iframe.diagram-frame")
        .elementHandle())!.contentFrame();
      const fit = await child!.evaluate(() => ({
        horizontal: document.documentElement.scrollWidth > innerWidth,
        vertical: document.documentElement.scrollHeight > innerHeight + 1,
        visualOverflow: (() => {
          const r = document.querySelector('[data-region="visual"]')!;
          return (
            r.scrollWidth > r.clientWidth + 1 ||
            r.scrollHeight > r.clientHeight + 1
          );
        })(),
      }));
      expect(fit).toEqual({
        horizontal: false,
        vertical: false,
        visualOverflow: false,
      });
    }
    await page
      .getByRole("button", { name: "Approve and next", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Start lecture", exact: true })
      .click();
    await expect(page).toHaveURL(/\/sessions\//);
    const sid = page.url().split("/sessions/")[1].split("?")[0];
    await context.request.post(`/api/v1/sessions/${sid}/end`, { data: {} });
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto(`/recordings/${sid}`);
    await page
      .getByRole("button", { name: "Explore interactive diagram", exact: true })
      .click();
    const replayControls = page
      .frameLocator("iframe.diagram-frame")
      .locator('[data-region="controls"]');
    await expect(replayControls).toContainText(/\b256\b/);
    await replayControls.getByRole("slider").first().focus();
    await page.keyboard.press("ArrowRight");
    await expect(replayControls).toContainText(/\b128\b/);
    const mobileFrame = await (await page
      .locator("iframe.diagram-frame")
      .elementHandle())!.contentFrame();
    expect(
      await mobileFrame!.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: "test-results/real-vision-diagram-mobile.png",
      fullPage: true,
    });
    console.log(
      "Real vision analysis + generated controls + lecturer approval + mobile replay passed; suggestions:",
      opportunities.suggestions.length,
    );
  } finally {
    expect(
      (await context.request.delete(`/api/v1/courses/${cid}`)).status(),
    ).toBe(204);
    await context.close();
  }
});
