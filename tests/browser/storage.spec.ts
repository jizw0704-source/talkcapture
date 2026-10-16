import { test, expect, type Page } from "@playwright/test";
import { revealControl, dropOriginalCache } from "./ui";
async function image(page: Page, color = "#ededed") {
  return Buffer.from(
    await page.evaluate((color) => {
      const c = document.createElement("canvas");
      c.width = 800;
      c.height = 600;
      const g = c.getContext("2d")!;
      g.fillStyle = "#252525";
      g.fillRect(0, 0, 800, 600);
      g.fillStyle = color;
      g.fillRect(100, 100, 600, 400);
      return c.toDataURL("image/jpeg").split(",")[1];
    }, color),
    "base64",
  );
}
async function snapshot(page: Page) {
  return page.evaluate(
    async () =>
      new Promise<any>((resolve, reject) => {
        const r = indexedDB.open("report-photo-organizer");
        r.onsuccess = () => {
          const db = r.result,
            tx = db.transaction("project"),
            q = tx.objectStore("project").get("current");
          tx.oncomplete = () => {
            db.close();
            resolve(q.result);
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
  );
}
async function ready(page: Page, count = 1) {
  await expect(page.locator("#cacheStatus")).toContainText(
    `已保存 ${count} / ${count} 张原图`,
  );
}
async function upload(page: Page, buffer: Buffer, name = "旧报告.jpg") {
  await page
    .locator("#files")
    .setInputFiles({ name, mimeType: "image/jpeg", buffer });
  await expect(page.locator("#add")).toBeEnabled();
}
test("刷新恢复原图字节、选区与顺序，无需重传即可生成 PPT", async ({
  page,
}, info) => {
  await page.goto("/");
  await page.locator("#demo").click();
  await ready(page, 3);
  await revealControl(page, "pointX");
  await page.locator("#pointSelect").selectOption("0");
  await page.locator("#pointX").fill("18");
  await page.locator("#applyPoint").click();
  await ready(page, 3);
  const before = await snapshot(page);
  await page.reload();
  await ready(page, 3);
  await expect(page.locator(".page-row")).toHaveCount(3);
  await expect(page.locator(".missing")).toHaveCount(0);
  expect((await snapshot(page)).photos).toEqual(before.photos);
  const originalIntegrity = await page.evaluate(
    async () =>
      new Promise<boolean>((resolve, reject) => {
        const r = indexedDB.open("report-photo-organizer");
        r.onsuccess = () => {
          const db = r.result,
            tx = db.transaction("originals"),
            q = tx.objectStore("originals").getAll();
          tx.oncomplete = async () => {
            db.close();
            const checks = await Promise.all(
              q.result.map(async (s) => {
                const hash = await crypto.subtle.digest(
                  "SHA-256",
                  await s.blob.arrayBuffer(),
                );
                return (
                  Array.from(new Uint8Array(hash), (n) =>
                    n.toString(16).padStart(2, "0"),
                  ).join("") === s.digest
                );
              }),
            );
            resolve(checks.length === 3 && checks.every(Boolean));
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
  );
  expect(originalIntegrity).toBe(true);
  await revealControl(page, "autoOrganize");
  await page.locator("#autoOrganize").click();
  await expect(page.locator("#download")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#stepReview").click();
  await expect(page.locator("#canvasEmpty")).toBeHidden();
  await expect(page.locator("#previewImage")).toBeVisible();
  await ready(page, 3);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("cached-review-mobile.png"),
    fullPage: true,
  });
});
test("缓存丢失后按内容匹配改名文件，保留原页和人工四角", async ({ page }) => {
  await page.goto("/");
  const buffer = await image(page);
  await upload(page, buffer);
  await ready(page);
  await revealControl(page, "pointX");
  await page.locator("#pointSelect").selectOption("0");
  await page.locator("#pointX").fill("18");
  await page.locator("#applyPoint").click();
  await ready(page);
  const before = await snapshot(page);
  await dropOriginalCache(page);
  await page.reload();
  await expect(page.locator("#replaceSource")).toBeVisible();
  await upload(page, buffer, "手机改过名称.jpg");
  await ready(page);
  await expect(page.locator(".page-row")).toHaveCount(1);
  const after = await snapshot(page);
  expect(after.photos[0].id).toBe(before.photos[0].id);
  expect(after.photos[0].name).toBe("旧报告.jpg");
  expect(after.photos[0].corners).toEqual(before.photos[0].corners);
  expect(after.photos[0].selection).toBe(before.photos[0].selection);
});
test("旧版数据库升级保留编辑，明确补传新文件不新增或清空选区", async ({
  page,
}, info) => {
  await page.goto("/");
  const buffer = await image(page);
  await upload(page, buffer);
  await ready(page);
  const before = await snapshot(page);
  await page.evaluate(async (value) => {
    delete value.photos[0].digest;
    await new Promise<void>((resolve, reject) => {
      const d = indexedDB.deleteDatabase("report-photo-organizer");
      d.onsuccess = () => {
        const r = indexedDB.open("report-photo-organizer", 1);
        r.onupgradeneeded = () => r.result.createObjectStore("project");
        r.onsuccess = () => {
          const db = r.result,
            tx = db.transaction("project", "readwrite");
          tx.objectStore("project").put(value, "current");
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      };
      d.onerror = () => reject(d.error);
    });
  }, before);
  await page.reload();
  await expect(page.locator("#replaceSource")).toBeVisible();
  await expect(page.locator("#recovery")).toContainText("1 张旧原图未缓存");
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath(`missing-source-${width}.png`),
      fullPage: true,
    });
  }
  const chooser = page.waitForEvent("filechooser");
  await page.locator("#replaceCurrent").click();
  await (
    await chooser
  ).setFiles({
    name: "重新导出的照片.jpg",
    mimeType: "image/jpeg",
    buffer: await image(page, "#cccccc"),
  });
  await ready(page);
  const after = await snapshot(page);
  expect(after.photos).toHaveLength(1);
  expect(after.photos[0].id).toBe(before.photos[0].id);
  expect(after.photos[0].corners).toEqual(before.photos[0].corners);
  expect(after.photos[0].selection).toBe(before.photos[0].selection);
  expect(after.photos[0].sourceNeedsReview).toBe(true);
  expect(after.photos[0].processed).toBe(false);
  await revealControl(page, "autoOrganize");
  await page.locator("#autoOrganize").click();
  await expect(page.locator("#automaticIssues")).toContainText("补传原图");
  await expect(page.locator("#download")).toBeHidden();
});
test("缓存不足明确提示，重试后可恢复，清空项目删除缓存副本", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).cacheFull = true;
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof put>) {
      if (this.name === "originals" && (window as any).cacheFull)
        throw new DOMException("disk full", "QuotaExceededError");
      return put.apply(this, args);
    };
  });
  await page.goto("/");
  await upload(page, await image(page));
  await expect(page.locator("#cacheStatus")).toContainText(
    "浏览器可用空间不足",
  );
  await expect(page.locator("#retryCache")).toBeVisible();
  await page.evaluate(() => {
    (window as any).cacheFull = false;
  });
  await page.locator("#retryCache").click();
  await ready(page);
  await page.reload();
  await ready(page);
  await expect(page.locator(".missing")).toHaveCount(0);
  await revealControl(page, "clear");
  await page.locator("#clear").click();
  await page.locator('#clearDialog button[value="clear"]').click();
  await expect(page.locator(".page-row")).toHaveCount(0);
  const count = await page.evaluate(
    async () =>
      new Promise<number>((resolve, reject) => {
        const r = indexedDB.open("report-photo-organizer");
        r.onsuccess = () => {
          const db = r.result,
            tx = db.transaction("originals"),
            q = tx.objectStore("originals").count();
          tx.oncomplete = () => {
            db.close();
            resolve(q.result);
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
  );
  expect(count).toBe(0);
});
