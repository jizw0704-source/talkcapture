import { test, expect, type Page } from "@playwright/test";
const stored = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<any>((resolve) => {
        const r = indexedDB.open("report-photo-organizer", 2);
        r.onsuccess = () => {
          const db = r.result,
            tx = db.transaction(["project", "originals"]),
            q = tx.objectStore("project").get("current"),
            originals = tx.objectStore("originals").getAllKeys();
          tx.oncomplete = () => {
            db.close();
            resolve({ photos: q.result.photos, originals: originals.result });
          };
        };
      }),
  );
test("移除误选照片可撤销、刷新后恢复，不改变选区、分组或原图缓存", async ({
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
  await expect
    .poll(async () =>
      (await stored(page)).photos.every((p: any) => !!p.reportId),
    )
    .toBe(true);
  const before = await stored(page);
  await page.locator("#brandHome").click();
  await page.locator(".gallery-remove").nth(1).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".gallery-card")).toHaveCount(2);
  await expect(page.locator("#photoViewer")).toBeHidden();
  await expect(page.locator("#galleryUndoRemove")).toBeFocused();
  await expect
    .poll(async () => (await stored(page)).photos[1].excluded)
    .toBe(true);
  const after = await stored(page);
  expect(after.originals).toEqual(before.originals);
  expect(after.photos).toEqual(
    before.photos.map((p: any, i: number) => ({
      ...p,
      excluded: i === 1 ? true : p.excluded,
    })),
  );
  await page.locator("#galleryUndoRemove").click();
  await expect(page.locator(".gallery-card")).toHaveCount(3);
  await expect.poll(() => stored(page)).toEqual(before);
  await page.locator(".gallery-card").nth(1).click();
  await page.locator("#galleryRemove").click();
  await expect(page.locator("#photoViewer")).toBeHidden();
  await expect
    .poll(async () => (await stored(page)).photos[1].excluded)
    .toBe(true);
  await page.reload();
  await expect(page.locator("#cacheStatus")).toContainText("已保存 3 / 3");
  await page.locator("#brandHome").click();
  await expect(page.locator(".gallery-card")).toHaveCount(2);
  await page.locator("#galleryShowRemoved").check();
  await expect(page.locator(".gallery-card")).toHaveCount(3);
  await page.locator(".gallery-remove").nth(1).click();
  await expect.poll(() => stored(page)).toEqual(before);
});

test("移除全部后的恢复入口、英文及窄屏可用", async ({ page }) => {
  await page.goto("/");
  await page.locator("#demo").click();
  await expect(page.locator("#cacheStatus")).toContainText("已保存 3 / 3");
  await page.locator("#brandHome").click();
  for (let i = 0; i < 3; i++)
    await page.locator(".gallery-remove").first().click();
  await expect(page.locator("#galleryEmpty")).toBeVisible();
  await expect(page.locator("#galleryUndoRemove")).toBeVisible();
  await page.locator("#galleryShowRemoved").check();
  await page.locator(".gallery-card").first().click();
  await expect(page.locator("#galleryRemove")).toHaveText("恢复照片");
  await page.locator("#galleryRemove").click();
  await page.locator("#settingsOpen").click();
  await page.locator("#languageChoice").selectOption("en");
  await page.locator("#settingsClose").click();
  await expect(page.locator("#galleryRemovedTools")).toContainText(
    "Show removed photos",
  );
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });
  await expect(page.locator(".gallery-remove").first()).toBeVisible();
  await page.screenshot({ path: "test-results/gallery-removal-mobile.png" });
});
