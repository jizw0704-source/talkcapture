import { cleanProject } from "../../src/backup.ts";
import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import JSZip from "jszip";
async function saved(page: Page) {
  return page.evaluate(
    () =>
      new Promise<any>((resolve) => {
        const r = indexedDB.open("report-photo-organizer", 2);
        r.onsuccess = () => {
          const db = r.result,
            tx = db.transaction(["project", "originals"]),
            q = tx.objectStore("project").get("current"),
            k = tx.objectStore("originals").getAllKeys();
          tx.oncomplete = () => {
            db.close();
            resolve({ project: q.result, keys: k.result });
          };
        };
      }),
  );
}
async function demo(page: Page) {
  await page.goto("/");
  await page.locator("#demo").click();
  await expect(page.locator("#cacheStatus")).toContainText("已保存 3 / 3");
}
test("backup download, invalid/cancelled restore preservation and complete restore", async ({
  page,
}) => {
  await demo(page);
  const before = await saved(page);
  await page.locator("#settingsOpen").click();
  await page.locator("#projectSettings > summary").click();
  await page.locator("#backupSave").click();
  await expect(page.locator("#backupDownload")).toBeVisible();
  const pending = page.waitForEvent("download");
  await page.locator("#backupDownload").click();
  const file = await pending;
  const path = (await file.path())!;
  const zip = await JSZip.loadAsync(readFileSync(path));
  const manifest = JSON.parse(await zip.file("manifest.json")!.async("string"));
  expect(manifest.project.photos).toHaveLength(3);
  expect(manifest).not.toHaveProperty("modelKey");
  await page.locator("#backupFile").setInputFiles({
    name: "bad.zip",
    mimeType: "application/zip",
    buffer: Buffer.from("bad"),
  });
  await expect(page.locator("#backupStatus")).toContainText("损坏");
  expect(await saved(page)).toEqual(before);
  await page.locator("#backupFile").setInputFiles(path);
  await expect(page.locator("#restoreDialog")).toBeVisible();
  await page.locator("#restoreCancel").click();
  expect(await saved(page)).toEqual(before);
  await page.locator("#settingsClose").click();
  await page.locator("#exclude").click();
  await expect
    .poll(async () => (await saved(page)).project.photos[0].excluded)
    .toBe(true);
  const edited = await saved(page);
  await page.locator("#settingsOpen").click();
  await page.locator("#backupFile").setInputFiles(path);
  await expect(page.locator("#restoreDialog")).toBeVisible();
  await page.evaluate(() => {
    (window as any).__put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: any[]) {
      if (this.name === "originals")
        throw new DOMException("test quota", "QuotaExceededError");
      return Reflect.apply((window as any).__put, this, args);
    };
  });
  await page.locator("#restoreConfirm").click();
  await expect(page.locator("#restoreInfo")).toContainText("恢复失败");
  expect(await saved(page)).toEqual(edited);
  await page.evaluate(() => {
    IDBObjectStore.prototype.put = (window as any).__put;
  });
  await page.locator("#restoreConfirm").click();
  await page.waitForLoadState();
  await expect(page.locator("#cacheStatus")).toContainText("已保存 3 / 3");
  await expect
    .poll(async () => (await saved(page)).project?.photos.length)
    .toBe(3);
  expect(cleanProject((await saved(page)).project)).toEqual(
    cleanProject(before.project),
  );
  expect((await saved(page)).keys).toEqual(before.keys);
  await page.locator("#settingsOpen").click();
  await page.locator("#languageChoice").selectOption("en");
  await page.locator("#projectSettings > summary").click();
  await expect(page.locator("#backupSave")).toHaveText("Create project backup");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "/tmp/talkcapture-backup-mobile.png" });
});
test("batch three formats, manifest source order, partial failures and retry", async ({
  page,
}) => {
  await demo(page);
  await page.route("**/api/analysis/ocr", (r) =>
    r.fulfill({
      json: {
        lines: [
          { text: "太阳电池研究与实验方法", confidence: 1 },
          { text: "报告人：张老师", confidence: 1 },
        ],
      },
    }),
  );
  for (let i = 0; i < 3; i++) {
    await expect(page.locator("#canvasEmpty")).toBeHidden();
    await page.locator("#confirm").click();
    await expect(page.locator("#counts")).toContainText(`${i + 1} 页已确认`);
  }
  await page.locator("#stepGroups").click();
  await page.locator("#analyzeReports").click();
  await expect(page.locator(".report-group")).toHaveCount(1);
  await page.locator(".report-pages > summary").click();
  await page.getByRole("button", { name: "反转本组页序", exact: true }).click();
  await expect
    .poll(async () => (await saved(page)).project.photos[0].reportOrder)
    .toBe(2);
  const before = await saved(page);
  await page.getByRole("button", { name: "导出这份报告", exact: true }).click();
  await page.locator("#batchExport > summary").click();
  await page.locator("#batchRun").click();
  await expect(page.locator("#batchStatus")).toContainText("已完成 3/3");
  const pending = page.waitForEvent("download");
  await page.locator("#batchDownload").click();
  const path = (await (await pending).path())!;
  const zip = await JSZip.loadAsync(readFileSync(path));
  const manifest = JSON.parse(await zip.file("sources.json")!.async("string"));
  expect(manifest).toHaveLength(3);
  expect(manifest.every((r: any) => r.status === "complete")).toBe(true);
  expect(manifest[0].pages.map((p: any) => p.sourcePage)).toEqual([3, 2, 1]);
  const md = await zip
    .file(Object.keys(zip.files).find((k) => k.endsWith(".md"))!)!
    .async("string");
  expect([...md.matchAll(/来源：第 (\d+) 页/g)].map((x) => x[1])).toEqual([
    "3",
    "2",
    "1",
  ]);
  for (const ext of ["pdf", "pptx"])
    expect(
      (
        await zip
          .file(Object.keys(zip.files).find((k) => k.endsWith("." + ext))!)!
          .async("uint8array")
      ).length,
    ).toBeGreaterThan(500);
  expect(await saved(page)).toEqual(before);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await expect(page.locator("[name=batchFormat]").first()).toHaveCSS(
    "width",
    "18px",
  );
  await page.screenshot({ path: "/tmp/talkcapture-batch-mobile.png" });
  // Transient worker failure is test-only: a single failed job, then successful retry.
  await page.evaluate(() => {
    const send = Worker.prototype.postMessage;
    let fail = true;
    Worker.prototype.postMessage = function (...args: any[]) {
      if (fail) {
        fail = false;
        throw Error("test transient failure");
      }
      return Reflect.apply(send, this, args);
    };
  });
  await page.locator("#batchRun").click();
  await expect(page.locator("#batchStatus")).toContainText("已完成 2/3");
  await expect(page.locator("#batchRetry")).toBeVisible();
  await page.locator("#batchRetry").click();
  await expect(page.locator("#batchStatus")).toContainText("已完成 3/3");
  expect(await saved(page)).toEqual(before);
  await page.evaluate(() => {
    const send = Worker.prototype.postMessage;
    let count = 0;
    Worker.prototype.postMessage = function (...args: any[]) {
      if (++count === 4) {
        (window as any).__releaseBatch = () => Reflect.apply(send, this, args);
        return;
      }
      return Reflect.apply(send, this, args);
    };
  });
  await page.locator("#batchRun").click();
  await expect
    .poll(() => page.evaluate(() => typeof (window as any).__releaseBatch))
    .toBe("function");
  await page.locator("#batchCancel").click();
  await page.evaluate(() => (window as any).__releaseBatch());
  await expect(page.locator("#batchRetry")).toBeVisible();
  await expect(page.locator("#batchDownload")).toBeVisible();
  await page.locator("#batchRetry").click();
  await expect(page.locator("#batchStatus")).toContainText("已完成 3/3");
});
