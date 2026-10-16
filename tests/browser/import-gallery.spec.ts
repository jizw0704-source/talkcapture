import { test, expect, type Page } from "@playwright/test";
import { dropOriginalCache } from "./ui";
const snapshot = (page: Page) =>
  page.evaluate(
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
                reportId: p.reportId,
              })),
            );
          };
        };
      }),
  );
test("导入照片墙浏览、增量上传、键盘与跳转不改已有选区页序", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("#importGallery")).toBeHidden();
  await page.locator("#demo").click();
  await page.locator("#stepReview").click();
  await page.locator("#confirm").click();
  await expect(page.locator("#counts")).toContainText("1 页已确认");
  await expect(page.locator("#cacheStatus")).toContainText("已保存 3 / 3");
  const before = await snapshot(page);
  await page.locator("#brandHome").click();
  await expect(page.locator(".gallery-card")).toHaveCount(3);
  await page.locator("#galleryToggle").click();
  await expect(page.locator("#importGalleryContent")).toBeHidden();
  await expect(page.locator("#importGalleryCount")).toContainText("共 3 张");
  await expect(page.locator("#galleryToggle")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await page.locator("#stepReview").click();
  await page.locator("#brandHome").click();
  await expect(page.locator("#importGalleryContent")).toBeHidden();
  await page.locator("#galleryToggle").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#importGalleryContent")).toBeVisible();
  expect(await snapshot(page)).toEqual(before);
  await expect(page.locator(".gallery-card").first()).toContainText("已确认");
  await page.locator(".gallery-card").nth(1).click();
  await expect(page.locator("#photoViewer")).toBeVisible();
  await expect(page.locator("#galleryTitle")).toContainText("第 2 / 3 张");
  await expect(page.locator("#galleryImage")).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#galleryTitle")).toContainText("第 3 / 3 张");
  await expect(page.locator("#galleryNext")).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(page.locator(".gallery-card").nth(1)).toBeFocused();
  await page
    .locator(".gallery-card")
    .first()
    .evaluate((el) => ((el as any).galleryRetained = true));
  await page.locator(".gallery-card").nth(1).click();
  const focused = await page.evaluate(() => document.activeElement?.id);
  const fixture = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 800;
    c.height = 600;
    const g = c.getContext("2d")!;
    g.fillStyle = "#eeeeee";
    g.fillRect(0, 0, 800, 600);
    g.fillStyle = "#111";
    g.font = "48px sans-serif";
    g.fillText("A new photo", 100, 200);
    return c.toDataURL("image/png").split(",")[1];
  });
  await page.locator("#files").setInputFiles({
    name: "new-photo.png",
    mimeType: "image/png",
    buffer: Buffer.from(fixture, "base64"),
  });
  await expect(page.locator(".gallery-card")).toHaveCount(4);
  await expect(page.locator("#cacheStatus")).toContainText("已保存 4 / 4");
  await expect(page.locator("#photoViewer")).toBeVisible();
  await expect(page.locator("#galleryTitle")).toContainText("第 2 / 4 张");
  expect(await page.evaluate(() => document.activeElement?.id)).toBe(focused);
  expect(
    await page
      .locator(".gallery-card")
      .first()
      .evaluate((el) => (el as any).galleryRetained),
  ).toBe(true);
  expect((await snapshot(page)).slice(0, 3)).toEqual(before);
  await page.locator("#galleryReview").click();
  await expect(page.locator("#reviewScreen")).toBeVisible();
  await expect(page.locator("#currentName")).toHaveText(
    await page
      .locator(".gallery-card")
      .nth(1)
      .locator("span")
      .textContent()
      .then((s) => s!.replace(/^2\. /, "")),
  );
  await page.locator("#brandHome").click();
  await page.locator("#settingsOpen").click();
  await page.locator("#languageChoice").selectOption("en");
  await page.locator("#settingsClose").click();
  await expect(page.locator("#importGalleryTitle")).toHaveText(
    "Uploaded photos",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".gallery-card").first().click();
  await expect(page.locator("#galleryReview")).toHaveText("Review this photo");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  for (const id of ["galleryClose", "galleryNext", "galleryReview"])
    expect(
      (await page.locator("#" + id).boundingBox())!.height,
    ).toBeGreaterThanOrEqual(44);
  await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });
  await page.keyboard.press("Escape");
  expect((await snapshot(page)).slice(0, 3)).toEqual(before);
  await page.reload();
  await expect(page.locator("#cacheStatus")).toContainText("Saved 4 / 4");
  await page.locator("#brandHome").click();
  await expect(page.locator(".gallery-card")).toHaveCount(4);
  expect((await snapshot(page)).slice(0, 3)).toEqual(before);
});
test("缺原图仍显示照片位置和缺图提示，不借用校正图冒充原图", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("#demo").click();
  await expect(page.locator("#cacheStatus")).toContainText("已保存 3 / 3");
  await dropOriginalCache(page);
  await page.reload();
  await page.locator("#brandHome").click();
  await expect(page.locator(".gallery-card")).toHaveCount(3);
  await expect(page.locator(".gallery-card").first()).toContainText("原图缺失");
  await page.locator(".gallery-card").first().click();
  await expect(page.locator("#galleryStatus")).toHaveText("原图缺失");
  await expect(page.locator("#galleryReview")).toBeDisabled();
  await expect(page.locator("#galleryImage")).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(page.locator(".gallery-card").first()).toBeFocused();
});
