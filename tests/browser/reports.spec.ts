import { test, expect } from "@playwright/test";
test("local OCR, report groups, corrections, Markdown and recovery", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("#demo").click();
  await expect(page.locator("#cacheStatus")).toContainText("已保存 3 / 3");
  await page.locator("#reportWorkspace > summary").click();
  let calls = 0;
  await page.route("**/api/analysis/ocr", (route) => {
    calls++;
    return route.fulfill({
      json: {
        lines: [
          {
            text:
              calls < 3
                ? "材料表面分析研究与实验结果"
                : "机器人控制方法研究与应用",
            confidence: 0.95,
          },
          {
            text:
              calls < 3
                ? "报告人：张老师；材料表面分析研究"
                : "报告人：李老师；机械臂运动轨迹规划",
            confidence: 0.95,
          },
        ],
      },
    });
  });
  await page.locator("#analyzeReports").click();
  await expect(page.locator("#reportStatus")).toContainText("已整理为 2 组");
  await expect(page.locator(".report-group")).toHaveCount(2);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载总结 Markdown" }).nth(1).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.md$/);
  await page.route("**/api/analysis/summary", (route) => {
    const payload = route.request().postDataJSON();
    expect(payload.pages).toHaveLength(1);
    expect(JSON.stringify(payload)).toContain("机器人");
    expect(JSON.stringify(payload)).not.toContain("材料表面");
    expect(payload).not.toHaveProperty("title");
    return route.fulfill({
      json: { text: "## 合成测试总结\n机器人研究[第3页]", provider: "MiniMax" },
    });
  });
  const modelDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "MiniMax 解读" }).nth(1).click();
  await modelDownload;
  await expect(page.locator("#reportStatus")).toContainText("已生成并下载");
  await page
    .locator(".report-group")
    .nth(1)
    .getByRole("button", { name: "合并到上一报告" })
    .click();
  await expect(page.locator(".report-group")).toHaveCount(1);
  await page.locator(".report-group details > summary").click();
  await page.getByRole("button", { name: "从此页拆分" }).nth(2).click();
  await expect(page.locator(".report-group")).toHaveCount(2);
  await expect(page.locator("#cacheStatus")).toContainText("已保存 3 / 3");
  await page.reload();
  await page.locator("#reportWorkspace > summary").click();
  await expect(page.locator(".report-group")).toHaveCount(2);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "test-results/reports-mobile.png",
    fullPage: true,
  });
});
test("OCR failure preserves pages and MiniMax failure offers recovery", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("#demo").click();
  await expect(page.locator("#cacheStatus")).toContainText("已保存 3 / 3");
  await page.locator("#reportWorkspace > summary").click();
  await page.route("**/api/analysis/ocr", (r) =>
    r.fulfill({ status: 422, json: { error: "测试识别失败" } }),
  );
  await page.locator("#analyzeReports").click();
  await expect(page.locator("#reportStatus")).toContainText("3 页缺少");
  await expect(page.locator("#pageList > *")).not.toHaveCount(0);
  await page.route("**/api/analysis/summary", (r) =>
    r.fulfill({ status: 503, json: { error: "请先配置 MINIMAX_API_KEY" } }),
  );
  await page.getByRole("button", { name: "MiniMax 解读" }).click();
  await expect(page.locator("#reportStatus")).toContainText("仍可下载");
});

test("real native OCR reads a synthetic slide without cloud services", async ({
  page,
  request,
}) => {
  test.skip(process.platform !== "darwin", "macOS Vision required");
  await page.goto("/");
  const image = Buffer.from(
    await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 1400;
      c.height = 900;
      const g = c.getContext("2d")!;
      g.fillStyle = "white";
      g.fillRect(0, 0, 1400, 900);
      g.fillStyle = "black";
      g.font = "60px sans-serif";
      g.fillText("Solar cell efficiency research", 70, 140);
      g.fillText("Presented by Alice Wang", 70, 260);
      g.font = "40px sans-serif";
      g.fillText("Interface passivation improves device stability", 70, 400);
      return c.toDataURL("image/png").split(",")[1];
    }),
    "base64",
  );
  const response = await request.post("/api/analysis/ocr", {
    data: image,
    headers: { "Content-Type": "image/png" },
    timeout: 120000,
  });
  expect(response.status(), await response.text()).toBe(200);
  const result = await response.json();
  expect(result.lines.map((l: any) => l.text).join(" ")).toContain(
    "Solar cell efficiency",
  );
});
