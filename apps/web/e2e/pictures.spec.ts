import { test, expect } from "@playwright/test";
import path from "node:path";
import { readFile } from "node:fs/promises";

test("profile pictures and course and lecture banners persist with authorized controls", async ({
  browser,
}) => {
  test.setTimeout(90000);
  const teacher = await browser.newContext({
    baseURL: "http://localhost:8080",
  });
  const student = await browser.newContext({
    baseURL: "http://localhost:8080",
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
            name: `Picture ${role}`,
            email: `pictures-${role}-${suffix}@example.com`,
            password: "picture-test-password",
            role,
          },
        })
      ).status(),
    ).toBe(201);
  }
  const cid = (
    await (
      await teacher.request.post("/api/v1/courses", {
        data: { name: `Picture course ${suffix}` },
      })
    ).json()
  ).id;
  try {
    const page = await teacher.newPage();
    await page.goto("/");
    await page
      .getByRole("button", { name: "Your profile", exact: true })
      .click();
    await page
      .getByLabel("Choose profile picture")
      .setInputFiles(path.resolve("e2e/banner.png"));
    await page
      .getByRole("button", { name: "Upload image", exact: true })
      .click();
    await expect(
      page.getByText("Image updated.", { exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await page.reload();
    await expect(
      page.getByRole("img", { name: "Your profile picture", exact: true }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page
          .getByRole("img", { name: "Your profile picture", exact: true })
          .evaluate((image: HTMLImageElement) => image.naturalWidth),
      )
      .toBeGreaterThan(0);
    await page.goto(`/courses/${cid}/settings`);
    await page
      .getByLabel("Choose course banner")
      .setInputFiles(path.resolve("e2e/banner.png"));
    await page
      .getByRole("button", { name: "Upload image", exact: true })
      .click();
    await expect(
      page.getByText("Image updated.", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("img", {
        name: `Picture course ${suffix} banner`,
        exact: true,
      }),
    ).toBeVisible();
    expect(
      (await student.request.get(`/api/v1/courses/${cid}/banner`)).status(),
    ).toBe(404);
    await teacher.request.post(`/api/v1/courses/${cid}/members`, {
      data: { email: `pictures-student-${suffix}@example.com` },
    });
    expect(
      (await student.request.get(`/api/v1/courses/${cid}/banner`)).status(),
    ).toBe(200);
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
        { timeout: 20000 },
      )
      .toBe("ready");
    const lid = (
      await (
        await teacher.request.post(`/api/v1/courses/${cid}/lectures`, {
          data: { title: "Banner lesson", slide_resource_id: rid },
        })
      ).json()
    ).id;
    await page.goto(`/lectures/${lid}`);
    await page
      .getByRole("button", { name: "Add lecture banner", exact: true })
      .click();
    await page
      .getByLabel("Choose lecture banner")
      .setInputFiles(path.resolve("e2e/banner.png"));
    await page
      .getByRole("button", { name: "Upload image", exact: true })
      .click();
    await expect(
      page.getByText("Image updated.", { exact: true }),
    ).toBeVisible();
    await page.goBack();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.reload();
    await expect(
      page.getByRole("img", { name: "Banner lesson banner", exact: true }),
    ).toBeVisible();
    await page.setViewportSize({ width: 360, height: 780 });
    await page
      .getByRole("button", { name: "Change lecture banner", exact: true })
      .click();
    await page.screenshot({
      path: "test-results/picture-upload-mobile.png",
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Remove image", exact: true })
      .click();
    await expect(
      page.getByText("Image removed.", { exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("img", { name: "Banner lesson banner", exact: true }),
    ).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  } finally {
    expect(
      (await teacher.request.delete(`/api/v1/courses/${cid}`)).status(),
    ).toBe(204);
    await teacher.close();
    await student.close();
  }
});
