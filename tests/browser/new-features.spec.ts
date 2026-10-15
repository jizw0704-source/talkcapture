import { test, expect, type Page } from "@playwright/test";
import { revealControl } from "./ui";
async function scene(page: Page) {
  return Buffer.from(
    await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 640;
      c.height = 420;
      const g = c.getContext("2d")!;
      g.fillStyle = "#252525";
      g.fillRect(0, 0, 640, 420);
      g.fillStyle = "#ededed";
      g.beginPath();
      g.arc(320, 210, 150, 0, Math.PI * 2);
      g.fill();
      return c.toDataURL("image/jpeg").split(",")[1];
    }),
    "base64",
  );
}
async function importScene(page: Page, buffer: Buffer, name: string) {
  if (!(await page.locator("#importScreen").isVisible()))
    await page.locator("#stepImport").click();
  await page
    .locator("#files")
    .setInputFiles({ name, mimeType: "image/jpeg", buffer });
  await expect(page.locator("#add")).toBeEnabled();
  await expect(page.locator("#canvasEmpty")).toBeHidden();
}
test("报告名称自动建议且不覆盖人工名称", async ({ page }) => {
  await page.goto("/");
  const buffer = await scene(page);
  await importScene(page, buffer, "材料报告_01.jpg");
  await page.locator("#stepExport").click();
  await expect(page.locator("#projectName")).toHaveValue(
    /材料报告_\d{4}-\d{2}-\d{2}_1页/,
  );
  await page.locator("#projectName").fill("我的正式报告");
  await page.locator("#stepReview").click();
  await page.locator("#stepExport").click();
  await expect(page.locator("#projectName")).toHaveValue("我的正式报告");
  await page.locator("#suggestName").click();
  await expect(page.locator("#projectName")).toHaveValue(/材料报告_.*_1页/);
});
test("人工确认记住本机构图，后续经验建议需要核对，可关闭和清除", async ({
  page,
}, info) => {
  await page.goto("/");
  const buffer = await scene(page);
  await importScene(page, buffer, "现场01.jpg");
  await expect(page.locator("#importReviewSummary")).toContainText(
    "1 张边界待核对",
  );
  await revealControl(page, "reset");
  await page.locator("#reset").click();
  await page.locator("#autoNext").uncheck();
  const c = page.locator("#editorCanvas");
  await c.scrollIntoViewIfNeeded();
  const box = (await c.boundingBox())!;
  const rect = await c.evaluate((c) => {
    const w = c.clientWidth,
      h = c.clientHeight,
      r = Math.min((w - 48) / 640, (h - 48) / 420);
    return {
      x: (w - 640 * r) / 2,
      y: (h - 420 * r) / 2,
      w: 640 * r,
      h: 420 * r,
    };
  });
  for (const [x, y] of [
    [0.2, 0.2],
    [0.8, 0.2],
    [0.8, 0.8],
    [0.2, 0.8],
  ])
    await page.mouse.click(
      box.x + rect.x + x * rect.w,
      box.y + rect.y + y * rect.h,
    );
  await page.locator("#confirm").click();
  await expect(page.locator("#learningStatus")).toContainText("已记住 1 条");
  await importScene(page, buffer, "现场02.jpg");
  await expect(page.locator(".page-row")).toHaveCount(2);
  await page.locator(".page-open").nth(1).click();
  await expect(page.locator("#cornerPrompt")).toContainText("本地纠正经验");
  await page.locator("#autoOrganize").click();
  await expect(page.locator("#automaticIssues")).toContainText("经验选区");
  await expect(page.locator("#download")).toBeHidden();
  await revealControl(page, "autoNext");
  await page.locator("#learnCorrections").uncheck();
  await importScene(page, buffer, "现场03.jpg");
  await expect(page.locator(".page-row")).toHaveCount(3);
  await expect(page.locator(".page-row").nth(2)).toContainText("需手动选四角");
  await revealControl(page, "autoNext");
  await page.locator("#learnCorrections").check();
  await page.locator("#clearLearning").click();
  await expect(page.locator("#learningStatus")).toContainText("已记住 0 条");
  await page.screenshot({
    path: info.outputPath("local-correction-review.png"),
    fullPage: true,
  });
});
