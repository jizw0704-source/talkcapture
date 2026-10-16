import { test, expect } from "@playwright/test";

test("整批上传后所有页面已有预览，未定位页面保留原图预览，均不自动确认", async ({
  page,
}) => {
  await page.goto("/");
  const images = await page.evaluate(() =>
    [true, true, false].map((screen, i) => {
      const c = document.createElement("canvas");
      c.width = 640;
      c.height = 420;
      const g = c.getContext("2d")!;
      g.fillStyle = "#252525";
      g.fillRect(0, 0, 640, 420);
      if (screen) {
        g.fillStyle = "#ededed";
        g.fillRect(85, 70, 470, 270);
      }
      return {
        name: `batch-${i}.png`,
        data: c.toDataURL("image/png").split(",")[1],
      };
    }),
  );
  await page.locator("#files").setInputFiles(
    images.map((p) => ({
      name: p.name,
      mimeType: "image/png",
      buffer: Buffer.from(p.data, "base64"),
    })),
  );
  await expect(page.locator("#counts")).toContainText("3 张照片 · 0 页已确认");
  await expect(page.locator("#add")).toBeEnabled();
  // Check preparation before opening the later pages: eager previews are part
  // of the upload transaction, not lazy work caused by selecting each page.
  const saved = await page.evaluate(
    () =>
      new Promise<any[]>((resolve, reject) => {
        const req = indexedDB.open("report-photo-organizer");
        req.onsuccess = () => {
          const db = req.result,
            r = db.transaction("project").objectStore("project").get("current");
          r.onsuccess = () => {
            resolve(r.result.photos);
            db.close();
          };
          r.onerror = () => reject(r.error);
        };
        req.onerror = () => reject(req.error);
      }),
  );
  expect(saved).toHaveLength(3);
  expect(
    saved.every((p) => p.resultWidth > 0 && p.resultHeight > 0 && !p.processed),
  ).toBeTruthy();
  expect(saved.filter((p) => p.previewKind === "corrected")).toHaveLength(2);
  expect(
    saved.filter((p) => p.previewKind === "original" && p.corners.length === 0),
  ).toHaveLength(1);
  await page.locator(".page-open").nth(2).click();
  await expect(page.locator("#canvasEmpty")).toBeHidden();
  await expect(page.locator("#previewImage")).toBeVisible();
  await expect(page.locator("#previewMeta")).toContainText("原图预览");
});

test("预览失败不会丢掉已上传原图，打开待核对页可重试", async ({ page }) => {
  await page.addInitScript(() => {
    const send = Worker.prototype.postMessage;
    let failed = false;
    Worker.prototype.postMessage = function (q: { id: number; kind: string }) {
      if (q.kind === "warp" && !failed) {
        failed = true;
        queueMicrotask(() =>
          this.dispatchEvent(
            new MessageEvent("message", {
              data: { id: q.id, error: "Synthetic preview failure" },
            }),
          ),
        );
      } else send.call(this, q);
    };
  });
  await page.goto("/");
  const buffer = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 640;
    c.height = 420;
    const g = c.getContext("2d")!;
    g.fillStyle = "#252525";
    g.fillRect(0, 0, 640, 420);
    g.fillStyle = "#ededed";
    g.fillRect(85, 70, 470, 270);
    return c.toDataURL("image/png").split(",")[1];
  });
  await page.locator("#files").setInputFiles({
    name: "preview-retry.png",
    mimeType: "image/png",
    buffer: Buffer.from(buffer, "base64"),
  });
  await expect(page.locator("#cacheStatus")).toContainText("已保存 1 / 1");
  await expect(page.locator("#counts")).toContainText("1 张照片 · 0 页已确认");
  await expect(page.locator("#previewImage")).toBeVisible();
  await expect(page.locator("#previewMeta")).toContainText("待核对");
});
