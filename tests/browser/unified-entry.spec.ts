import { test, expect } from "@playwright/test";
test("命名跨入口同步，Markdown 快捷入口统一检查生成，改名使旧下载失效", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("#demo").click();
  await expect(page.locator("#cacheStatus")).toContainText("已保存 3 / 3");
  let n = 0;
  await page.route("**/api/analysis/ocr", (r) =>
    r.fulfill({
      json: {
        lines: [
          { text: "材料界面测试与研究方法", confidence: 1 },
          {
            text: ++n < 3 ? "报告人：张老师" : "报告人：李老师",
            confidence: 1,
          },
        ],
      },
    }),
  );
  await page.locator("#stepGroups").click();
  await page.locator("#analyzeReports").click();
  await expect(page.locator(".report-group")).toHaveCount(2);
  await page
    .locator(".report-group input")
    .first()
    .fill("人工保留的第一份报告");
  await page.locator(".report-group input").first().press("Tab");
  const order = await page.locator(".photo-name").allTextContents();
  const memberships = await page.locator(".report-group").evaluateAll((gs) =>
    gs.map((g) => ({
      id: g.getAttribute("data-report"),
      pages: Array.from(g.querySelectorAll(".report-page > p")).map(
        (p) => p.textContent,
      ),
    })),
  );
  await page
    .getByRole("button", { name: "导出原文 Markdown", exact: true })
    .nth(1)
    .click();
  await expect(page.locator("#exportScreen")).toBeVisible();
  await expect(page.locator("#format")).toHaveValue("md");
  await expect(page.locator("#download")).toBeHidden();
  await page.locator("#projectName").fill("第二份正式名称");
  await page.locator("#projectName").press("Tab");
  await page.locator("#export").click();
  await expect(page.locator("#download")).toBeVisible();
  await page.locator("#projectName").fill("第二份修订名称");
  await page.locator("#projectName").press("Tab");
  await page.locator("#projectName").fill("");
  await page.locator("#projectName").press("Tab");
  await expect(page.locator("#projectName")).toHaveValue("第二份修订名称");
  await expect(page.locator("#download")).toBeHidden();
  await page.locator("#stepGroups").click();
  await expect(page.locator(".report-group input").first()).toHaveValue(
    "人工保留的第一份报告",
  );
  await expect(page.locator(".report-group input").nth(1)).toHaveValue(
    "第二份修订名称",
  );
  expect(await page.locator(".photo-name").allTextContents()).toEqual(order);
  expect(
    await page.locator(".report-group").evaluateAll((gs) =>
      gs.map((g) => ({
        id: g.getAttribute("data-report"),
        pages: Array.from(g.querySelectorAll(".report-page > p")).map(
          (p) => p.textContent,
        ),
      })),
    ),
  ).toEqual(memberships);
  await page.locator("#automaticReviewTitle").click();
  await expect(page.locator("#automaticIssues li")).toHaveCount(0);
  await page.locator("#reviewDuplicates").click();
  await expect(page.locator("#batchOverview")).toHaveAttribute("open", "");
  await expect(page.locator("#batchFilter")).toHaveValue("duplicates");
  await page.locator("#stepGroups").click();
  await page.locator(".report-group input").nth(1).fill("第二份再次编辑");
  await page.locator(".report-group input").nth(1).press("Tab");
  await page
    .getByRole("button", { name: "导出这份报告", exact: true })
    .nth(1)
    .click();
  await expect(page.locator("#projectName")).toHaveValue("第二份再次编辑");
  await expect(page.locator("#cacheStatus")).toContainText("已保存 3 / 3");
  await page.reload();
  await page.locator("#stepGroups").click();
  await expect(page.locator(".report-group input").nth(1)).toHaveValue(
    "第二份再次编辑",
  );
  await page.locator("#settingsOpen").click();
  await page.locator("#languageChoice").selectOption("en");
  await page.locator("#settingsClose").click();
  await expect(page.locator("#importReviewSummary")).toContainText(
    "Image checks",
  );
  await expect(
    page.getByRole("button", { name: "Export source Markdown", exact: true }),
  ).toHaveCount(2);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});
