import { test, expect } from "@playwright/test";
test("输出说明随格式与语言变化，浏览不会重分组或改名称", async ({ page }) => {
  await page.goto("/");
  await page.locator("#demo").click();
  await expect(page.locator("#cacheStatus")).toContainText("已保存 3 / 3");
  await page.locator("#stepGroups").click();
  await expect(page.locator("#analyzeReports")).toHaveText(
    "识别文字并建议分组",
  );
  await expect(page.locator("#reportWorkspace")).toContainText(
    "仅为未分组照片建议分组",
  );
  await page.locator("#stepExport").click();
  await expect(page.locator("#outputDescription")).toContainText(
    "不恢复可编辑文字或图表",
  );
  await page.locator("#format").selectOption("md");
  await expect(page.locator("#outputDescription")).toContainText(
    "不包含 AI 总结",
  );
  await expect(page.locator("#aspect")).toBeHidden();
  await expect(page.locator("#quality")).toBeHidden();
  await page.locator("#settingsOpen").click();
  await page.locator("#languageChoice").selectOption("en");
  await page.locator("#settingsClose").click();
  await expect(page.locator("#outputDescription")).toContainText(
    "without AI summaries",
  );
  await page.locator("#stepGroups").click();
  await expect(page.locator("#analyzeReports")).toHaveText(
    "Recognize text and suggest groups",
  );
  await expect(page.locator("#reportWorkspace")).toContainText(
    "Existing groups and names are preserved",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});
