import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";

test("workspace dialogs, lecturer access and page-based PDF sources", async ({
  browser,
}) => {
  test.setTimeout(120000);
  const context = await browser.newContext({
    baseURL: "http://localhost:8080",
    viewport: { width: 1360, height: 1000 },
  });
  const outsider = await browser.newContext({
    baseURL: "http://localhost:8080",
  });
  const suffix = Date.now();
  for (const [client, name] of [
    [context, "Owner"],
    [outsider, "Colleague"],
  ] as const) {
    expect(
      (
        await client.request.post("/api/v1/auth/register", {
          data: {
            name,
            email: `ux-${name}-${suffix}@example.com`,
            password: "workspace-test-password",
            role: "lecturer",
          },
        })
      ).status(),
    ).toBe(201);
  }
  const cid = (
    await (
      await context.request.post("/api/v1/courses", {
        data: { name: `Workspace UX ${suffix}` },
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
    expect(
      (await outsider.request.get(`/api/v1/resources/${rid}/preview`)).status(),
    ).toBe(404);
    const preview = await context.request.get(
      `/api/v1/resources/${rid}/preview`,
    );
    expect(preview.status()).toBe(200);
    expect(preview.headers()["content-disposition"]).toMatch(/^inline;/);
    expect(preview.headers()["content-security-policy"]).toContain(
      "frame-ancestors 'none'",
    );
    expect(preview.headers()["content-type"]).toBe("application/pdf");
    const page = await context.newPage();
    const downloaded: string[] = [];
    page.on("download", (download) =>
      downloaded.push(download.suggestedFilename()),
    );
    await page.goto(`/courses/${cid}/resources`);
    await expect(page.getByText("ready", { exact: true })).toBeVisible({
      timeout: 15000,
    });
    await page.getByRole("button", { name: "Manage deck.pdf" }).click();
    const dialog = page.getByRole("dialog", { name: "Manage resource" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("File name")).toBeFocused();
    await page.screenshot({
      path: "test-results/resource-manage-desktop.png",
      fullPage: true,
    });
    await page.goBack();
    await expect(dialog).toHaveCount(0);
    await page.goForward();
    await expect(dialog).toBeVisible();
    await page.getByRole("button", { name: "Close dialog" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Manage deck.pdf" }),
    ).toBeFocused();
    await page.getByRole("button", { name: "New folder" }).click();
    await page.getByRole("dialog").getByLabel("Folder name").fill("Week 1");
    await page
      .getByRole("button", { name: "Create folder", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Week 1", exact: true }),
    ).toBeVisible();
    await page.setViewportSize({ width: 360, height: 780 });
    await page.getByRole("button", { name: "New folder" }).click();
    await page.getByLabel("Folder name").fill("Week 1");
    await page
      .getByRole("button", { name: "Create folder", exact: true })
      .click();
    await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
    await expect(page.locator(".notice")).toHaveCount(0);
    expect(
      await page
        .getByRole("dialog")
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
    await page.screenshot({
      path: "test-results/folder-error-mobile.png",
      fullPage: true,
    });
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("link", { name: "Open", exact: true }).click();
    await expect(page.getByLabel("PDF preview: deck.pdf")).toBeVisible();
    await expect(
      page.getByText("Source transcript", { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.locator('canvas[aria-label="Page 1 of deck.pdf"]'),
    ).toHaveAttribute("aria-busy", "false");
    await page.getByRole("button", { name: "Use page images" }).click();
    await page.getByLabel("Document page").selectOption("2");
    const image = page.getByRole("img", { name: "Page 2 of deck.pdf" });
    await expect(image).toBeVisible();
    await expect
      .poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth))
      .toBeGreaterThan(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: "test-results/pdf-source-mobile.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 1360, height: 1000 });
    await page.getByRole("button", { name: "Use PDF viewer" }).click();
    await expect(
      page.locator('canvas[aria-label="Page 2 of deck.pdf"]'),
    ).toHaveAttribute("aria-busy", "false");
    const pdfCanvas = page.locator('canvas[aria-label="Page 2 of deck.pdf"]');
    const originalWidth = await pdfCanvas.evaluate(
      (canvas: HTMLCanvasElement) => canvas.width,
    );
    await page.getByRole("combobox", { name: "PDF zoom" }).selectOption("1.5");
    await expect
      .poll(() =>
        pdfCanvas.evaluate((canvas: HTMLCanvasElement) => canvas.width),
      )
      .toBeGreaterThan(originalWidth);
    await expect(pdfCanvas).toHaveAttribute("aria-busy", "false");
    await page.getByRole("combobox", { name: "PDF zoom" }).selectOption("1");
    await expect(pdfCanvas).toHaveAttribute("aria-busy", "false");
    await page.getByText("Read page text", { exact: true }).click();
    await expect(page.locator(".pdf-page-text p")).toContainText(
      "retain the interval containing the target",
    );
    await page.getByText("Read page text", { exact: true }).click();
    await expect(page.locator(".notice")).toHaveCount(0);
    await page.screenshot({
      path: "test-results/pdf-source-desktop.png",
      fullPage: true,
    });
    await expect
      .poll(
        async () =>
          (await (await context.request.get(`/api/v1/resources/${rid}`)).json())
            .index_status,
        { timeout: 90000 },
      )
      .toBe("ready");
    await expect
      .poll(
        async () =>
          (await (await context.request.get(`/api/v1/resources/${rid}`)).json())
            .extraction_status,
        { timeout: 90000 },
      )
      .toBe("ready");
    await page.goto(`/courses/${cid}/search`);
    await page.getByLabel("Search words").fill("binary search sorted");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "deck.pdf", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Page 1", { exact: true })).toBeVisible();
    await expect(page.locator(".match-card")).toHaveCount(1);
    await expect(page.locator(".source-excerpt")).toHaveCount(0);
    await expect(page.locator(".match-card").getByText(/0:00/)).toHaveCount(0);
    await page.screenshot({
      path: "test-results/search-sources-desktop.png",
      fullPage: true,
    });
    const popupPromise = page.waitForEvent("popup");
    await page.getByRole("link", { name: /Open source/ }).click();
    const source = await popupPromise;
    await expect(source).toHaveURL(new RegExp(`/resources/${rid}\\?page=1$`));
    await expect(source.getByLabel("PDF preview: deck.pdf")).toBeVisible();
    expect(downloaded).toEqual([]);
    const colleague = await outsider.newPage();
    await colleague.goto(`/courses/${cid}`);
    await expect(
      colleague.getByText(/Ask a course lecturer for a lecturer invitation/),
    ).toBeVisible();
    await expect(
      colleague.getByRole("button", { name: "Request to join" }),
    ).toHaveCount(0);
    // Direct-linked dialogs can close without navigating out of the workspace.
    await page.goto(`/courses/${cid}/resources?dialog=create-folder`);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/courses/${cid}/resources$`));
  } finally {
    expect(
      (await context.request.delete(`/api/v1/courses/${cid}`)).status(),
    ).toBe(204);
    await context.close();
    await outsider.close();
  }
});
