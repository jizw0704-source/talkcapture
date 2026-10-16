import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
test("本地找角对比只读缓存，保留人工选区与确认状态，支持窄屏", async ({
  page,
}) => {
  const external: string[] = [];
  page.on("request", (r) => {
    if (
      /^https?:/.test(r.url()) &&
      !r.url().startsWith("http://127.0.0.1:9025/")
    )
      external.push(r.url());
  });
  await page.goto("/");
  await page.locator("#demo").click();
  await expect(page.locator("#cacheStatus")).toContainText("已保存 3 / 3");
  for (let k = 0; k < 3; k++) {
    await expect(page.locator("#canvasEmpty")).toBeHidden();
    await page.locator("#confirm").click();
    await expect(page.locator("#counts")).toContainText(`${k + 1} 页已确认`);
  }
  await expect(page.locator("#cacheStatus")).toContainText("已保存 3 / 3");
  await page.goto("/validation/corners.html");
  await page.getByRole("button", { name: "开始本地对比" }).click();
  await expect(page.locator("#status")).toContainText("对比完成");
  await expect(page.locator("#summary")).toContainText("共 3 页，完成 3 页");
  await expect(page.locator("#summary")).toContainText(
    "已确认选区及项目参数保持不变",
  );
  await expect(page.locator("canvas")).toHaveCount(9);
  const downloading = page.waitForEvent("download");
  await page.locator("#download").click();
  const download = await downloading;
  const report = JSON.parse(readFileSync((await download.path())!, "utf8"));
  expect(report.summary.preserved).toBe(true);
  expect(report.rows).toHaveLength(3);
  expect(
    report.rows.every(
      (p: { corners: { reference: unknown[] } }) =>
        p.corners.reference.length === 4,
    ),
  ).toBe(true);
  expect(external).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("link", { name: "返回工具" }).click();
  await expect(page.locator("#counts")).toContainText("3 页已确认");
});
