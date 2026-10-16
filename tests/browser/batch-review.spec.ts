import { test, expect, type Page } from "@playwright/test";
async function snapshot(page: Page) {
  return page.evaluate(
    () =>
      new Promise<any>((resolve) => {
        const r = indexedDB.open("report-photo-organizer", 2);
        r.onsuccess = () => {
          const db = r.result,
            tx = db.transaction("project"),
            q = tx.objectStore("project").get("current");
          tx.oncomplete = () => {
            db.close();
            resolve(
              q.result.photos.map((p: any) => ({
                id: p.id,
                corners: p.corners,
                processed: p.processed,
                excluded: p.excluded,
              })),
            );
          };
        };
      }),
  );
}
test("总览只提示疑似重复，保留、排除、恢复及刷新不改已确认四角", async ({
  page,
}) => {
  await page.goto("/");
  const images = await page.evaluate(() =>
    [0.9, 0.8, 0.95].map((quality, k) => {
      const c = document.createElement("canvas");
      c.width = 1200;
      c.height = 800;
      const g = c.getContext("2d")!;
      g.fillStyle = "#333";
      g.fillRect(0, 0, 1200, 800);
      g.fillStyle = "#eee";
      g.fillRect(120, 100, 960, 600);
      g.fillStyle = "#111";
      g.font = "bold 64px sans-serif";
      g.fillText(k < 2 ? "SAME REPORT" : "DIFFERENT CONTENT", 180, 230);
      g.fillStyle = k < 2 ? "#245a91" : "#a02c2c";
      g.fillRect(180, 300, k < 2 ? 600 : 350, 200);
      return c.toDataURL("image/jpeg", quality).split(",")[1];
    }),
  );
  await page.locator("#files").setInputFiles(
    images.map((s, k) => ({
      name: `report-${k}.jpg`,
      mimeType: "image/jpeg",
      buffer: Buffer.from(s, "base64"),
    })),
  );
  await expect(page.locator("#add")).toBeEnabled();
  for (let k = 0; k < 3; k++) {
    await expect(page.locator("#canvasEmpty")).toBeHidden();
    await page.locator("#confirm").click();
    await expect(page.locator("#counts")).toContainText(`${k + 1} 页已确认`);
  }
  await expect(page.locator("#cacheStatus")).toContainText("已保存 3 / 3");
  const before = await snapshot(page);
  await page.locator("#batchOverview > summary").click();
  await expect(page.locator(".batch-card")).toHaveCount(3);
  await expect(page.locator("#duplicateStatus")).toContainText("发现 1 对");
  await expect(
    page.locator(".batch-card").filter({ hasText: "校正预览" }),
  ).toHaveCount(3);
  expect(await snapshot(page)).toEqual(before);
  await page.locator("#batchFilter").selectOption("duplicates");
  await expect(page.locator(".batch-card")).toHaveCount(2);
  await page
    .locator(".batch-card")
    .first()
    .getByRole("button", { name: /并排比较/ })
    .click();
  await expect(page.locator("#duplicateComparison img")).toHaveCount(2);
  await page
    .getByRole("button", { name: "保留第 1 页，排除第 2 页", exact: true })
    .click();
  await expect(page.locator("#cacheStatus")).toContainText("已保存 3 / 3");
  const after = await snapshot(page);
  expect(after.map((p: any) => p.corners)).toEqual(
    before.map((p: any) => p.corners),
  );
  expect(after.every((p: any) => p.processed)).toBe(true);
  expect(after.map((p: any) => p.excluded)).toEqual([false, true, false]);
  await page.locator("#batchFilter").selectOption("excluded");
  await expect(page.locator(".batch-card")).toHaveCount(1);
  await page
    .locator(".batch-card")
    .getByRole("button", { name: "恢复", exact: true })
    .click();
  await expect(page.locator("#cacheStatus")).toContainText("已保存 3 / 3");
  expect(await snapshot(page)).toEqual(before);
  await page.locator("#batchFilter").selectOption("duplicates");
  await expect(page.locator("#duplicateStatus")).toContainText("发现 1 对");
  await page
    .locator(".batch-card")
    .first()
    .getByRole("button", { name: /并排比较/ })
    .click();
  await page.getByRole("button", { name: "保留两页，本次不再提示" }).click();
  await expect(page.locator(".batch-card")).toHaveCount(0);
  expect(await snapshot(page)).toEqual(before);
  await page.reload();
  await expect(page.locator("#counts")).toContainText("3 页已确认");
  await page.locator("#batchOverview > summary").click();
  await expect(page.locator("#duplicateStatus")).toContainText("发现 1 对");
  await page.locator("#settingsOpen").click();
  await page.locator("#languageChoice").selectOption("en");
  await page.locator("#settingsClose").click();
  await expect(page.locator("#duplicateStatus")).toContainText(
    "possible duplicate",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/batch-review-mobile.png",
    fullPage: true,
  });
});
