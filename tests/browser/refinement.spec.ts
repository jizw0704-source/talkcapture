import { test, expect } from "@playwright/test";
import { revealControl } from "./ui";

test("步骤图标反馈尊重减少动态效果设置", async ({ page }) => {
  await page.goto("/");
  const icon = page.locator("#stepImport span");
  const transform = () =>
    icon.evaluate((el) => getComputedStyle(el, "::before").transform);
  await page.locator("#stepImport").hover();
  await expect.poll(transform).toBe("matrix(1, 0, 0, 1, 0, -2)");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect.poll(transform).toBe("none");
  await page.locator("#stepImport").focus();
  await expect(page.locator("#stepImport")).toBeFocused();
  await expect(page.locator("#stepImport")).toHaveAccessibleName("1 导入照片");
});

test("导入入口和键盘跳转在桌面与窄屏可用，下载后修改设置会撤销旧结果", async ({
  page,
}, info) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "跳到主要内容" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#mainContent")).toBeFocused();
  await page.locator("#importTitle").click();
  await expect(page.locator(".overview")).toBeHidden();
  for (const width of [1440, 820, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator("#add")).toBeVisible();
    await expect(page.locator("#phoneOpen")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    for (const id of ["add", "phoneOpen"]) {
      const box = await page.locator(`#${id}`).boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.width).toBeGreaterThanOrEqual(44);
    }
    await page.screenshot({
      path: info.outputPath(`import-${width}.png`),
      fullPage: true,
    });
  }
  await page.locator("#dropzone").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#phonePanel")).toBeVisible();
  await page.locator("#phoneHide").click();
  await page.locator("#demo").click();
  await expect(page.locator(".overview")).toBeVisible();
  await expect(page.locator("#stepReview")).toHaveAttribute(
    "aria-current",
    "step",
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({
    path: info.outputPath("review-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 900 });
  await page.screenshot({
    path: info.outputPath("review-mobile.png"),
    fullPage: true,
  });
  await expect(page.locator("#autoOrganize")).toBeEnabled();
  await expect(page.locator("#automaticSummary")).toContainText("3 页保留");
  await revealControl(page, "autoOrganize");
  await page.locator("#autoOrganize").click();
  await expect(page.locator("#downloadResult")).toBeVisible();
  await expect(page.locator("#downloadInfo")).toContainText(".pptx · 3 页");
  await expect(page.locator("#download")).toBeFocused();
  await page.screenshot({
    path: info.outputPath("download-ready-mobile.png"),
    fullPage: true,
  });
  await page.locator("#quality").selectOption("compact");
  await expect(page.locator("#downloadResult")).toBeHidden();
  await expect(page.locator("#download")).toBeHidden();
  await expect(page.locator("#export")).toBeEnabled();
});

test("选区移动不重置画布，切图准备期间保留已绘制画面", async ({
  page,
}, info) => {
  await page.goto("/");
  await page.locator("#demo").click();
  const viewport = page.locator("#canvasViewport");
  await expect(viewport).toHaveAttribute("aria-busy", "false");
  const box = await page.locator("#editorCanvas").boundingBox();
  await page.evaluate(() => {
    const canvas = document.getElementById("editorCanvas")!;
    (window as any).canvasResets = 0;
    new MutationObserver((records) => {
      (window as any).canvasResets += records.filter(
        (r) => r.attributeName === "width" || r.attributeName === "height",
      ).length;
    }).observe(canvas, { attributes: true });
    const original = window.createImageBitmap.bind(window);
    window.createImageBitmap = (async (
      ...args: Parameters<typeof createImageBitmap>
    ) => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      return (original as any)(...args);
    }) as typeof createImageBitmap;
  });
  await page.mouse.move(box!.x + box!.width * 0.8, box!.y + box!.height * 0.2, {
    steps: 20,
  });
  expect(await page.evaluate(() => (window as any).canvasResets)).toBe(0);
  await page.screenshot({
    path: info.outputPath("magnifier-opposite-corner.png"),
    fullPage: true,
  });
  await page.mouse.move(0, 0);
  const before = await page
    .locator("#editorCanvas")
    .evaluate((c: HTMLCanvasElement) => c.toDataURL());
  await page.locator(".page-row").nth(1).locator(".page-open").click();
  await expect(viewport).toHaveAttribute("aria-busy", "true");
  expect(
    await page
      .locator("#editorCanvas")
      .evaluate((c: HTMLCanvasElement) => c.toDataURL()),
  ).toBe(before);
  await expect(viewport).toHaveAttribute("aria-busy", "false");
});
