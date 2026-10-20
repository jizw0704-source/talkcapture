import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
test("report-only ordering, undo, review persistence and source references", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("#demo").click();
  await expect(page.locator("#cacheStatus")).toContainText("已保存 3 / 3");
  await page.route("**/api/analysis/ocr", (r) =>
    r.fulfill({
      json: {
        lines: [
          { text: "材料研究方法与实验结果", confidence: 1 },
          { text: "报告人：张老师", confidence: 1 },
        ],
      },
    }),
  );
  await page.locator("#stepGroups").click();
  await page.locator("#analyzeReports").click();
  await expect(page.locator(".report-group")).toHaveCount(1);
  const labels = await page.locator(".report-page > p").allTextContents();
  await page.locator(".report-pages > summary").click();
  await page
    .getByRole("button", { name: "确认分组与页序", exact: true })
    .click();
  await expect(page.locator(".report-group-info")).toContainText(
    "分组与页序已核对",
  );
  await page.getByRole("button", { name: "反转本组页序", exact: true }).click();
  await expect(page.locator(".report-group-info")).toContainText(
    "分组与页序待核对",
  );
  expect(await page.locator(".report-page > p").allTextContents()).toEqual(
    [...labels].reverse(),
  );
  await page.getByRole("button", { name: "撤销本组排序", exact: true }).click();
  expect(await page.locator(".report-page > p").allTextContents()).toEqual(
    labels,
  );
  await expect(page.locator(".report-group-info")).toContainText(
    "分组与页序已核对",
  );
  await page
    .getByRole("button", { name: "本组下移", exact: true })
    .first()
    .click();
  const moved = await page.locator(".report-page > p").allTextContents();
  expect(moved).toEqual([labels[1], labels[0], labels[2]]);
  await page
    .getByRole("button", { name: "确认分组与页序", exact: true })
    .click();
  await expect(page.locator("#cacheStatus")).toContainText("已保存");
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          new Promise<string>((resolve) => {
            const r = indexedDB.open("report-photo-organizer", 2);
            r.onsuccess = () => {
              const db = r.result;
              const tx = db.transaction("project");
              const q = tx.objectStore("project").get("current");
              tx.oncomplete = () => {
                db.close();
                resolve(
                  q.result.photos.every((p: any) => p.reportReview)
                    ? "saved"
                    : "waiting",
                );
              };
            };
          }),
      ),
    )
    .toBe("saved");
  await page.reload();
  await page.locator("#stepGroups").click();
  await page.locator(".report-pages > summary").click();
  expect(await page.locator(".report-page > p").allTextContents()).toEqual(
    moved,
  );
  await expect(page.locator(".report-group-info")).toContainText(
    "分组与页序已核对",
  );
  await page
    .getByRole("button", { name: "导出原文 Markdown", exact: true })
    .click();
  await page.locator("#export").click();
  const pending = page.waitForEvent("download");
  await page.locator("#download").click();
  const file = await pending;
  const md = readFileSync((await file.path())!, "utf8");
  expect([...md.matchAll(/来源：第 (\d+) 页/g)].map((m) => m[1])).toEqual([
    "2",
    "1",
    "3",
  ]);
  await page.locator("#stepGroups").click();
  await expect(page.locator("#status")).toBeHidden();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "/tmp/talkcapture-order-mobile.png" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: "/tmp/talkcapture-order-desktop.png" });
});
