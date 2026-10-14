import { test, expect } from "@playwright/test";

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
