import { test, expect } from "@playwright/test";

test("compact groups show previews, disclose controls and preserve project data", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("#demo").click();
  await expect(page.locator("#cacheStatus")).toContainText("已保存 3 / 3");
  await page.route("**/api/analysis/ocr", (r) =>
    r.fulfill({
      json: {
        lines: [
          { text: "太阳电池测试与应用研究", confidence: 1 },
          { text: "报告人：张老师", confidence: 1 },
        ],
      },
    }),
  );
  await page.locator("#stepGroups").click();
  await page.locator("#analyzeReports").click();
  await expect(page.locator(".report-group")).toHaveCount(1);
  const snapshot = () =>
    page.evaluate(
      () =>
        new Promise((resolve) => {
          const r = indexedDB.open("report-photo-organizer", 2);
          r.onsuccess = () => {
            const db = r.result,
              tx = db.transaction("project"),
              q = tx.objectStore("project").get("current");
            tx.oncomplete = () => {
              db.close();
              resolve(q.result);
            };
          };
        }),
    );
  await expect
    .poll(async () => {
      const saved = (await snapshot()) as { photos: { reportId?: string }[] };
      return saved.photos.every((p) => !!p.reportId);
    })
    .toBe(true);
  const before = await snapshot();
  await expect(page.locator(".report-cover img")).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator(".report-cover img")
        .evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBeGreaterThan(0);
  await expect(page.getByRole("button", { name: "重新建议名称" })).toBeHidden();
  await page.locator(".report-pages > summary").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".report-page select").first()).toBeVisible();
  await expect(page.locator(".report-page textarea").first()).toBeHidden();
  await page.locator(".report-reading > summary").first().click();
  await expect(page.locator(".report-page textarea").first()).toHaveValue(
    /太阳电池/,
  );
  await page.locator(".report-more > summary").click();
  await expect(
    page.getByRole("button", { name: "重新建议名称" }),
  ).toBeVisible();
  await page.locator("#settingsOpen").click();
  await expect(page.locator("#modelSettings")).not.toHaveAttribute("open");
  await expect(page.locator("#themeChoice")).toBeVisible();
  expect(
    await page
      .locator("#displaySettingsTitle")
      .evaluate(
        (el) =>
          !!(
            el.compareDocumentPosition(
              document.querySelector("#modelSettings")!,
            ) & Node.DOCUMENT_POSITION_FOLLOWING
          ),
      ),
  ).toBe(true);
  await page.locator("#languageChoice").selectOption("en");
  await expect(page.locator("#modelSettingsTitle")).toHaveText(
    "Model configuration",
  );
  await page.locator("#settingsClose").click();
  await expect(page.locator(".report-more > summary")).toHaveText(
    "More actions",
  );
  await expect(page.locator(".report-pages")).toHaveAttribute("open", "");
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });
  await expect(page.locator(".report-pages > summary")).toBeVisible();
  await page.reload();
  await expect(page.locator("#cacheStatus")).toContainText("Saved 3 / 3");
  await page.locator("#stepGroups").click();
  await expect(page.locator(".report-group")).toHaveCount(1);
  expect(await snapshot()).toEqual(before);
});
