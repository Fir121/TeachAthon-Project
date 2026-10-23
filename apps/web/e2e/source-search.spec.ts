import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";

test("grouped source links, exact pages and explicit preflight controls", async ({
  browser,
}) => {
  test.setTimeout(180000);
  const teacher = await browser.newContext({
    baseURL: "http://localhost:8080",
  });
  const student = await browser.newContext({
    baseURL: "http://localhost:8080",
    viewport: { width: 360, height: 780 },
  });
  const suffix = Date.now();
  for (const [context, role] of [
    [teacher, "lecturer"],
    [student, "student"],
  ] as const) {
    expect(
      (
        await context.request.post("/api/v1/auth/register", {
          data: {
            name: `Sources ${role}`,
            role,
            email: `sources-${role}-${suffix}@example.com`,
            password: "source-search-test-password",
          },
        })
      ).status(),
    ).toBe(201);
  }
  const cid = (
    await (
      await teacher.request.post("/api/v1/courses", {
        data: { name: `Source validation ${suffix}` },
      })
    ).json()
  ).id;
  try {
    await teacher.request.post(`/api/v1/courses/${cid}/members`, {
      data: { email: `sources-student-${suffix}@example.com` },
    });
    const rid = (
      await (
        await teacher.request.post(`/api/v1/courses/${cid}/resources`, {
          multipart: {
            file: {
              name: "search-pages.pdf",
              mimeType: "application/pdf",
              buffer: await readFile(path.resolve("e2e/search-pages.pdf")),
            },
          },
        })
      ).json()
    ).id;
    await expect
      .poll(
        async () =>
          (await (await teacher.request.get(`/api/v1/resources/${rid}`)).json())
            .extraction_status,
        { timeout: 90000 },
      )
      .toBe("ready");
    await expect
      .poll(
        async () =>
          (await (await teacher.request.get(`/api/v1/resources/${rid}`)).json())
            .index_status,
        { timeout: 30000 },
      )
      .toBe("ready");
    const page = await student.newPage();
    await page.goto(`/courses/${cid}/search`);
    await page.getByLabel("Search words").fill("binary search sorted sequence");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page.locator(".match-card")).toHaveCount(1, {
      timeout: 25000,
    });
    await expect(page.locator(".source-location")).toHaveCount(5);
    await expect(page.locator(".source-excerpt")).toHaveCount(0);
    await page.getByRole("button", { name: "Show 1 more locations" }).click();
    const popup = page.waitForEvent("popup");
    await page.getByRole("link", { name: "Page 6", exact: true }).click();
    const source = await popup;
    await expect(source).toHaveURL(new RegExp(`/resources/${rid}\\?page=6$`));
    await expect(
      source.locator('canvas[aria-label="Page 6 of search-pages.pdf"]'),
    ).toHaveAttribute("aria-busy", "false");
    await source.close();
    await page.screenshot({
      path: "test-results/source-groups-mobile.png",
      fullPage: true,
    });
    await page.getByLabel("Search words", { exact: true }).fill("binary");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page.locator(".match-card")).toHaveCount(1);
    await page
      .getByLabel("Search words", { exact: true })
      .fill("photosynthesis chlorophyll");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page.getByText(/No suitable source found/)).toBeVisible({
      timeout: 25000,
    });
    await expect(page.locator(".match-card")).toHaveCount(0);
    await page.goto(`/courses/${cid}/discussions`);
    await page
      .getByRole("button", { name: "Ask a question", exact: true })
      .click();
    await page
      .getByLabel("Your question")
      .fill("Why does binary search require a sorted sequence?");
    await page.getByRole("button", { name: "Post question" }).click();
    await expect(
      page.getByRole("heading", { name: "search-pages.pdf", exact: true }),
    ).toBeVisible({ timeout: 30000 });
    await expect(page.locator(".source-excerpt")).toHaveCount(0);
    expect(
      (
        await (
          await student.request.get(`/api/v1/courses/${cid}/questions`)
        ).json()
      ).length,
    ).toBe(0);
    // A transport failure never posts automatically. Explicit fallback obtains a genuine new proof.
    await page
      .getByLabel("Your question")
      .fill("How does binary search halve a sorted sequence?");
    await page.route(
      "**/questions/preflight",
      async (route) => {
        await route.abort("failed");
      },
      { times: 1 },
    );
    await page.getByRole("button", { name: "Post question" }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    expect(
      (
        await (
          await student.request.get(`/api/v1/courses/${cid}/questions`)
        ).json()
      ).length,
    ).toBe(0);
    await page.getByRole("button", { name: "Retry source search" }).click();
    await page
      .getByRole("button", { name: /Post (my question )?anyway/ })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 30000 });
    expect(
      (
        await (
          await student.request.get(`/api/v1/courses/${cid}/questions`)
        ).json()
      ).length,
    ).toBe(1);
    const lid = (
      await (
        await teacher.request.post(`/api/v1/courses/${cid}/lectures`, {
          data: { title: "Sources lesson", slide_resource_id: rid },
        })
      ).json()
    ).id;
    const sid = (
      await (
        await teacher.request.post(`/api/v1/lectures/${lid}/sessions/start`, {
          data: {},
        })
      ).json()
    ).id;
    await teacher.request.post(`/api/v1/sessions/${sid}/polls`, { data: {} });
    await page.goto(`/sessions/${sid}`);
    await page
      .getByText("Add a note for the lecturer", { exact: true })
      .click();
    await page
      .getByLabel("What would help?")
      .fill("Binary search sorted sequence needs another explanation.");
    await expect(
      page.getByRole("button", { name: "Check course sources", exact: true }),
    ).toHaveCount(0);
    await expect(page.locator(".match-card")).toHaveCount(0);
    await page.getByRole("button", { name: "Send note to lecturer" }).click();
    await expect(page.getByText(/Note sent/)).toBeVisible();
  } finally {
    expect(
      (await teacher.request.delete(`/api/v1/courses/${cid}`)).status(),
    ).toBe(204);
    await teacher.close();
    await student.close();
  }
});
