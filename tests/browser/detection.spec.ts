import { revealControl } from "./ui";
import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

type Scene = "screen" | "second" | "blank" | "ambiguous";
async function photo(page: Page, scene: Scene, name = `${scene}.png`) {
  return page.evaluate(
    ({ scene, name }) => {
      const canvas = document.createElement("canvas");
      canvas.width = 1600;
      canvas.height = 1000;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#232323";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const polygon = (points: number[][]) => {
        ctx.fillStyle = "#ededed";
        ctx.beginPath();
        points.forEach(([x, y], i) => {
          if (!i) ctx.moveTo(x * canvas.width, y * canvas.height);
          else ctx.lineTo(x * canvas.width, y * canvas.height);
        });
        ctx.closePath();
        ctx.fill();
      };
      if (scene === "screen" || scene === "second") {
        polygon(
          scene === "screen"
            ? [
                [0.15, 0.2],
                [0.86, 0.12],
                [0.81, 0.85],
                [0.22, 0.8],
              ]
            : [
                [0.08, 0.1],
                [0.92, 0.1],
                [0.88, 0.91],
                [0.12, 0.87],
              ],
        );
        ctx.fillStyle = "#252525";
        ctx.font = "34px sans-serif";
        ctx.fillText("Synthetic screen — not research data", 400, 300);
        ctx.font = "26px sans-serif";
        ctx.fillText("Automatic corners require your confirmation", 400, 370);
      } else if (scene === "ambiguous") {
        polygon([
          [0.04, 0.2],
          [0.46, 0.2],
          [0.46, 0.78],
          [0.04, 0.78],
        ]);
        polygon([
          [0.54, 0.2],
          [0.96, 0.2],
          [0.96, 0.78],
          [0.54, 0.78],
        ]);
      }
      return { name, data: canvas.toDataURL("image/png") };
    },
    { scene, name },
  );
}
async function importPhotos(
  page: Page,
  photos: Awaited<ReturnType<typeof photo>>[],
) {
  // Fixed metadata exercises real IndexedDB recovery without introducing a new file.
  await revealControl(page, "sort");
  await page.locator("#sort").selectOption("selection");
  await page.locator("#files").evaluate((el, photos) => {
    const transfer = new DataTransfer();
    for (const photo of photos) {
      const bytes = Uint8Array.from(atob(photo.data.split(",")[1]), (c) =>
        c.charCodeAt(0),
      );
      transfer.items.add(
        new File([bytes], photo.name, {
          type: "image/png",
          lastModified: 1_750_000_000_000,
        }),
      );
    }
    (el as HTMLInputElement).files = transfer.files;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }, photos);
  await expect(page.locator("#add")).toBeEnabled();
  await expect(page.locator("#canvasEmpty")).toBeHidden();
}
async function firstCorner(page: Page) {
  await revealControl(page, "pointSelect");
  await page.locator("#pointSelect").selectOption("0");
  return Number(await page.locator("#pointX").inputValue());
}

test("默认自动定位、逐页核对与原图分辨率导出", async ({ page }, info) => {
  const errors: string[] = [],
    external: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (
      /^https?:/.test(request.url()) &&
      !request.url().startsWith("http://127.0.0.1:9025/")
    )
      external.push(request.url());
  });
  await page.goto("/");
  await expect(page.locator("#autoDetect")).toBeChecked();
  await importPhotos(page, [
    await photo(page, "screen"),
    await photo(page, "second"),
  ]);
  await expect(page.locator("#cornerPrompt")).toContainText("自动建议");
  expect(await firstCorner(page)).toBeCloseTo(15, 0);
  await expect(page.locator("#counts")).toContainText("0 页已确认");
  await expect(page.locator("#previewImage")).toBeVisible();
  // The detector analyzes only 640 px; the crop preview must use the 1600 px original.
  expect(
    await page
      .locator("#previewImage")
      .evaluate((img) => (img as HTMLImageElement).naturalWidth),
  ).toBeGreaterThan(900);
  await revealControl(page, "export");
  await page.locator("#export").click();
  await expect(page.locator("#status")).toContainText("存在未确认页");
  await revealControl(page, "confirm");
  await page.locator("#confirm").click();
  await expect(page.locator("#counts")).toContainText("1 页已确认");
  await expect(page.locator("#cornerPrompt")).toContainText("自动建议");
  expect(await firstCorner(page)).toBeCloseTo(8, 0);
  await expect(page.locator("#currentName")).toContainText("second.png");
  await revealControl(page, "confirm");
  await page.locator("#confirm").click();
  await expect(page.locator("#counts")).toContainText("2 页已确认");
  await revealControl(page, "format");
  await page.locator("#format").selectOption("pdf");
  await revealControl(page, "export");
  await page.locator("#export").click();
  await expect(page.locator("#download")).toBeVisible();
  const event = page.waitForEvent("download");
  await page.locator("#download").click();
  const path = info.outputPath("automatic.pdf");
  await (await event).saveAs(path);
  const content = readFileSync(path).toString("latin1");
  expect(content.match(/\/Type \/Page\b/g)).toHaveLength(2);
  const widths = [...content.matchAll(/\/Width (\d+)/g)].map((m) =>
    Number(m[1]),
  );
  expect(widths.length).toBeGreaterThanOrEqual(2);
  expect(Math.min(...widths)).toBeGreaterThan(900);
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
  await revealControl(page, "autoFind");
  await page.locator("#editTools > summary").click();
  await page.screenshot({
    path: info.outputPath("automatic-desktop.png"),
    fullPage: true,
  });
});

test("手动微调后可重新自动定位、撤销、取消并重试", async ({ page }) => {
  await page.addInitScript(() => {
    const original = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message: { kind?: string }) {
      if (message.kind === "detect")
        setTimeout(() => {
          try {
            original.call(this, message);
          } catch {
            /* terminated worker */
          }
        }, 400);
      else original.call(this, message);
    };
  });
  await page.goto("/");
  await importPhotos(page, [await photo(page, "screen")]);
  await expect(page.locator("#previewImage")).toBeVisible();
  await firstCorner(page);
  await revealControl(page, "pointX");
  await page.locator("#pointX").fill("18");
  await revealControl(page, "applyPoint");
  await page.locator("#applyPoint").click();
  await revealControl(page, "autoNext");
  await page.locator("#autoNext").uncheck();
  await revealControl(page, "confirm");
  await page.locator("#confirm").click();
  await expect(page.locator("#counts")).toContainText("1 页已确认");
  await revealControl(page, "autoFind");
  await page.locator("#autoFind").click();
  await expect(page.locator("#cancelDetect")).toBeVisible();
  await page.locator("#cancelDetect").click();
  await expect(page.locator("#autoFind")).toBeEnabled();
  await expect(page.locator("#status")).toContainText("取消");
  expect(await firstCorner(page)).toBe(18);
  await expect(page.locator("#counts")).toContainText("1 页已确认");
  await revealControl(page, "autoFind");
  await page.locator("#autoFind").click();
  await expect(page.locator("#autoFind")).toBeEnabled();
  await expect(page.locator("#cornerPrompt")).toContainText("自动建议");
  expect(await firstCorner(page)).toBeCloseTo(15, 0);
  await expect(page.locator("#counts")).toContainText("0 页已确认");
  await revealControl(page, "undo");
  await page.locator("#undo").click();
  expect(await firstCorner(page)).toBe(18);
  await expect(page.locator("#counts")).toContainText("0 页已确认");
  await revealControl(page, "rotate");
  await page.locator("#rotate").click();
  await expect(page.locator("#autoFind")).toBeEnabled();
  await revealControl(page, "autoFind");
  await page.locator("#autoFind").click();
  await expect(page.locator("#cornerPrompt")).toContainText("自动建议");
  await expect(page.locator("#previewImage")).toBeVisible();
});

test("失败与多候选保留照片，重试失败不覆盖已确认的手动选区", async ({
  page,
}) => {
  await page.goto("/");
  await importPhotos(page, [
    await photo(page, "blank"),
    await photo(page, "ambiguous"),
  ]);
  await expect(page.locator(".page-row")).toHaveCount(2);
  await expect(page.locator("#cornerPrompt")).toContainText("未找到可靠");
  await expect(page.locator("#previewImage")).toBeHidden();
  await revealControl(page, "whole");
  await page.locator("#whole").click();
  await revealControl(page, "autoNext");
  await page.locator("#autoNext").uncheck();
  await revealControl(page, "confirm");
  await page.locator("#confirm").click();
  await expect(page.locator("#counts")).toContainText("1 页已确认");
  await revealControl(page, "autoFind");
  await page.locator("#autoFind").click();
  await expect(page.locator("#autoFind")).toBeEnabled();
  await expect(page.locator("#status")).toContainText("现有选区保留");
  await expect(page.locator("#counts")).toContainText("1 页已确认");
  expect(await firstCorner(page)).toBe(0);
  await expect(page.locator("#previewImage")).toBeVisible();
  await revealControl(page, "next");
  await page.locator("#next").click();
  await expect(page.locator("#cornerPrompt")).toContainText("多个候选");
  await expect(page.locator("#previewImage")).toBeHidden();
});

test("重新关联原图不重新检测或覆盖既有手动参数", async ({ page }) => {
  await page.goto("/");
  const inputPhoto = await photo(page, "screen");
  await importPhotos(page, [inputPhoto]);
  await firstCorner(page);
  await revealControl(page, "pointX");
  await page.locator("#pointX").fill("18");
  await revealControl(page, "applyPoint");
  await page.locator("#applyPoint").click();
  await revealControl(page, "autoNext");
  await page.locator("#autoNext").uncheck();
  await revealControl(page, "confirm");
  await page.locator("#confirm").click();
  await expect(page.locator("#counts")).toContainText("1 页已确认");
  await page.waitForTimeout(400);
  await page.reload();
  await expect(page.locator("#recovery")).toBeVisible();
  await expect(page.locator("#autoDetect")).toBeChecked();
  await importPhotos(page, [inputPhoto]);
  expect(await firstCorner(page)).toBe(18);
  await expect(page.locator("#counts")).toContainText("1 页已确认");
  await expect(page.locator("#recovery")).toBeHidden();
  await expect(page.locator("#previewImage")).toBeVisible();
});

test("自动定位入口的窄屏布局、键盘焦点和无障碍模式", async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await importPhotos(page, [await photo(page, "screen")]);
  await expect(page.locator("#previewImage")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const button = page.locator("#autoFind");
  expect((await button.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await revealControl(page, "autoDetect");
  expect(
    (
      await page
        .locator("label")
        .filter({ has: page.locator("#autoDetect") })
        .boundingBox()
    )?.height,
  ).toBeGreaterThanOrEqual(44);
  await revealControl(page, "autoFind");
  await page.keyboard.press("Tab");
  await button.focus();
  await expect(button).toBeFocused();
  expect(
    await button.evaluate((el) => getComputedStyle(el).outlineStyle),
  ).not.toBe("none");
  await page.screenshot({
    path: info.outputPath("automatic-mobile.png"),
    fullPage: true,
  });
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await page.screenshot({
    path: info.outputPath("automatic-high-contrast.png"),
    fullPage: true,
  });
  await button.press("Enter");
  await expect(button).toBeEnabled();
  await expect(page.locator("#cornerPrompt")).toContainText("自动建议");
});

test("三步流程按需展开，切换步骤保留选区和人工确认", async ({ page }, info) => {
  await page.goto("/");
  await expect(page.locator("#importScreen")).toBeVisible();
  await expect(page.locator("#stepReview")).toBeDisabled();
  await expect(page.locator("#stepExport")).toBeDisabled();
  await expect(page.locator("#reviewScreen")).toBeHidden();
  await expect(page.locator("#exportScreen")).toBeHidden();
  await expect(page.locator("#autoDetect")).toBeHidden();
  await importPhotos(page, [await photo(page, "screen")]);
  await expect(page.locator("#reviewScreen")).toBeVisible();
  await expect(page.locator("#importScreen")).toBeHidden();
  await expect(page.locator("#stepReview")).toHaveAttribute(
    "aria-current",
    "step",
  );
  await expect(page.locator("#pointX")).toBeHidden();
  await expect(page.locator("#moveSelected")).toBeHidden();
  await page.locator("#goExport").click();
  await expect(page.locator("#exportTitle")).toBeFocused();
  await expect(page.locator("#exportCheck")).toContainText("1 页未确认");
  await expect(page.locator("#allowOriginal")).not.toBeChecked();
  await page.locator("#export").click();
  await expect(page.locator("#status")).toContainText("存在未确认页");
  await page.locator("#backReview").click();
  await expect(page.locator("#reviewTitle")).toBeFocused();
  const disclosure = page.locator("#editTools > summary");
  await disclosure.focus();
  await disclosure.press("Enter");
  await expect(page.locator("#pointX")).toBeVisible();
  await page.locator("#pointSelect").selectOption("0");
  await page.locator("#pointX").fill("18");
  await page.locator("#applyPoint").click();
  await page.locator("#stepImport").click();
  await expect(page.locator("#importTitle")).toBeFocused();
  await page.locator("#continueReview").click();
  await expect(page.locator("#pointX")).toHaveValue("18.00");
  await page.locator("#confirm").click();
  await expect(page.locator("#counts")).toContainText("1 页已确认");
  await page.locator("#goExport").click();
  await expect(page.locator("#exportCheck")).toContainText("已确认 1 页");
  await page.setViewportSize({ width: 390, height: 844 });
  for (const step of ["import", "review", "export"] as const) {
    await page.locator(`#step${step[0].toUpperCase()}${step.slice(1)}`).click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath(`${step}-mobile.png`),
      fullPage: true,
    });
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(
    () => window.matchMedia("(prefers-reduced-transparency: reduce)").matches,
  );
  // All surfaces are opaque and there are no animated transitions or backdrop filters.
  const styles = await page.locator("#exportScreen").evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      background: style.backgroundColor,
      motion: style.transitionDuration,
      blur: style.backdropFilter,
    };
  });
  expect(styles).toEqual({
    background: "rgb(255, 255, 255)",
    motion: "0s",
    blur: "none",
  });
});
