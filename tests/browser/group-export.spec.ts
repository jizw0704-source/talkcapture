import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

test("确认后自动分组智能命名，按组导出 PDF、PPTX 和无分析的原文 Markdown", async ({
  page,
}) => {
  let ocr = 0,
    cloud = 0;
  await page.route("**/api/analysis/summary", (r) => {
    cloud++;
    return r.fulfill({ status: 500, json: { error: "Must not call cloud" } });
  });
  await page.route("**/api/analysis/ocr", (r) => {
    ocr++;
    const first = ocr < 3;
    return r.fulfill({
      json: {
        lines: [
          {
            text: first ? "材料界面研究与实验方法" : "机器人控制研究与实验方法",
            confidence: 0.95,
          },
          {
            text: first
              ? "报告人：张老师；材料界面研究"
              : "报告人：李老师；机器人控制研究",
            confidence: 0.95,
          },
        ],
      },
    });
  });
  await page.goto("/");
  await page.locator("#demo").click();
  await expect(page.locator("#cacheStatus")).toContainText("已保存 3 / 3");
  for (let i = 0; i < 3; i++) {
    await expect(page.locator("#canvasEmpty")).toBeHidden();
    await page.locator("#confirm").click();
    await expect(page.locator("#counts")).toContainText(`${i + 1} 页已确认`);
  }
  await page.locator("#goExport").click();
  await expect(page.locator("#groupsScreen")).toBeVisible();
  await expect(page.locator(".report-group")).toHaveCount(2);
  await expect(page.locator("#analyzeReports")).toBeEnabled();
  expect(ocr).toBe(3);
  await expect(
    page.locator(".report-group").nth(1).locator("input"),
  ).toHaveValue(/李老师_机器人/);
  await expect(page.locator(".optional-analysis").nth(1)).not.toHaveAttribute(
    "open",
    "",
  );
  await page
    .locator(".report-group")
    .nth(1)
    .getByRole("button", { name: "导出这份报告", exact: true })
    .click();
  await expect(page.locator("#exportScreen")).toBeVisible();
  await expect(page.locator("#exportSummary")).toContainText("1 页待导出");
  for (const format of ["pdf", "pptx", "md"]) {
    await page.locator("#format").selectOption(format);
    await page.locator("#export").click();
    await expect(page.locator("#download")).toBeVisible();
    const promise = page.waitForEvent("download");
    await page.locator("#download").click();
    const file = await promise;
    expect(file.suggestedFilename()).toMatch(new RegExp(`\\.${format}$`));
    const path = (await file.path())!;
    if (format === "pdf")
      expect(
        readFileSync(path)
          .toString("latin1")
          .match(/\/Type \/Page\b/g) || [],
      ).toHaveLength(1);
    if (format === "pptx") {
      const xml = execFileSync("unzip", ["-p", path, "ppt/presentation.xml"], {
        encoding: "utf8",
      });
      expect(xml.match(/<p:sldId /g) || []).toHaveLength(1);
    }
    if (format === "md") {
      const text = readFileSync(path, "utf8");
      expect(text).toContain("机器人");
      expect(text).toContain("来源：第 3 页");
      expect(text).not.toContain("材料界面");
      expect(text).not.toContain("主要内容摘录");
      await expect(page.locator("#aspect")).toBeHidden();
    }
  }
  expect(cloud).toBe(0);
  await page.locator("#exportGroup").selectOption("all");
  await expect(page.locator("#exportSummary")).toContainText("3 页待导出");
  await page.locator("#backReview").click();
  await expect(page.locator("#groupsScreen")).toBeVisible();
  expect(ocr).toBe(3);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "test-results/group-export-mobile.png",
    fullPage: true,
  });
});
