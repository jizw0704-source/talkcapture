import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { revealControl } from "./ui";

async function demo(page: Page) {
  await revealControl(page, "demo");
  await page.locator("#demo").click();
  await expect(page.locator("#add")).toBeEnabled();
  await expect(page.locator(".page-row")).toHaveCount(3);
}
async function uncertain(page: Page) {
  await page.locator("#stepImport").click();
  const fixtures = await page.evaluate(() =>
    [false, true].map((multiple) => {
      const c = document.createElement("canvas");
      c.width = 1000;
      c.height = 700;
      const g = c.getContext("2d")!;
      g.fillStyle = "#232323";
      g.fillRect(0, 0, c.width, c.height);
      if (multiple) {
        g.fillStyle = "#ededed";
        g.fillRect(40, 140, 420, 406);
        g.fillRect(540, 140, 420, 406);
      }
      return {
        name: multiple ? "多个画面.png" : "没有边界.png",
        data: c.toDataURL("image/png"),
      };
    }),
  );
  await page.locator("#files").evaluate((el, photos) => {
    const transfer = new DataTransfer();
    for (const p of photos) {
      const bytes = Uint8Array.from(atob(p.data.split(",")[1]), (c) =>
        c.charCodeAt(0),
      );
      transfer.items.add(
        new File([bytes], p.name, {
          type: "image/png",
          lastModified: 1750000000000,
        }),
      );
    }
    (el as HTMLInputElement).files = transfer.files;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }, fixtures);
  await expect(page.locator("#autoOrganize")).toBeEnabled();
}

test("一键生成保留人工选区、设置和页序，排除页不输出，刷新后恢复原图", async ({
  page,
}, info) => {
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
  await expect(page.locator("#automaticPanel")).toBeHidden();
  await demo(page);
  await revealControl(page, "pointSelect");
  await page.locator("#pointSelect").selectOption("0");
  await page.locator("#pointX").fill("13");
  await page.locator("#applyPoint").click();
  await page.locator("#brightness").fill("8");
  await page.locator("#brightness").dispatchEvent("change");
  await page.locator("#autoNext").uncheck();
  await page.locator("#confirm").click();
  await expect(page.locator("#counts")).toContainText("1 页已确认");
  await revealControl(page, "pageTools");
  await page
    .locator(".page-row")
    .nth(2)
    .getByRole("button", { name: "上移", exact: true })
    .click();
  await page
    .locator(".page-row")
    .nth(2)
    .getByRole("button", { name: "排除", exact: true })
    .click();
  const order = await page.locator(".photo-name").allTextContents();
  await revealControl(page, "format");
  await page.locator("#format").selectOption("pdf");
  await page.locator("#stepReview").click();
  await revealControl(page, "autoOrganize");
  await page.locator("#autoOrganize").click();
  await expect(page.locator("#download")).toBeVisible();
  await expect(page.locator("#download")).toContainText("PPTX");
  await expect(page.locator("#counts")).toContainText(
    "1 页已确认 · 1 页自动校正 · 1 页已排除",
  );
  await expect(page.locator("#status")).toContainText("已生成 2 页 PPTX");
  await expect(page.locator("#automaticReview")).toBeHidden();
  expect(await page.locator(".photo-name").allTextContents()).toEqual(order);
  const downloadEvent = page.waitForEvent("download");
  await page.locator("#download").click();
  const pptxPath = info.outputPath("automatic.pptx");
  await (await downloadEvent).saveAs(pptxPath);
  const folder = info.outputPath("pptx");
  execFileSync("/usr/bin/unzip", ["-q", pptxPath, "-d", folder]);
  expect(
    readdirSync(`${folder}/ppt/slides`).filter((name) =>
      /^slide\d+\.xml$/.test(name),
    ),
  ).toHaveLength(2);
  expect(readFileSync(`${folder}/ppt/presentation.xml`, "utf8")).toContain(
    'cx="12192000" cy="6858000"',
  );
  const media = readdirSync(`${folder}/ppt/media`).filter((name) =>
    /\.(jpeg|jpg)$/i.test(name),
  );
  expect(media).toHaveLength(2);
  for (const name of media) {
    const size = execFileSync(
      "/usr/bin/sips",
      ["-g", "pixelWidth", `${folder}/ppt/media/${name}`],
      { encoding: "utf8" },
    );
    expect(Number(size.match(/pixelWidth: (\d+)/)?.[1])).toBeGreaterThan(900);
  }
  await page.screenshot({
    path: info.outputPath("batch-desktop.png"),
    fullPage: true,
  });
  await page.locator("#stepReview").click();
  await page.locator("#pointSelect").selectOption("0");
  await expect(page.locator("#pointX")).toHaveValue("13.00");
  await expect(page.locator("#brightness")).toHaveValue("8");
  await page.waitForTimeout(400);
  await page.reload();
  await expect(page.locator("#cacheStatus")).toContainText(
    "已保存 3 / 3 张原图",
  );
  await expect(page.locator("#autoOrganize")).toBeEnabled();
  await expect(page.locator("#download")).toBeHidden();
  await demo(page);
  await expect(page.locator("#status")).toContainText("三张合成示例");
  await expect(page.locator(".page-row")).toHaveCount(3);
  await expect(page.locator("#counts")).toContainText("1 页自动校正");
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});

test("不确定页面集中检查，不静默漏页；人工处理后继续生成完整报告", async ({
  page,
}, info) => {
  await page.goto("/");
  await demo(page);
  await uncertain(page);
  await expect(page.locator(".page-row")).toHaveCount(5);
  await revealControl(page, "autoOrganize");
  await page.locator("#autoOrganize").click();
  await expect(page.locator("#automaticIssues li")).toHaveCount(2);
  await expect(page.locator("#download")).toBeHidden();
  await expect(page.locator("#counts")).toContainText("3 页自动校正");
  await expect(page.locator("#automaticIssues")).toContainText("多个候选");
  await expect(page.locator("#automaticIssues")).toContainText("未找到");
  await page.screenshot({
    path: info.outputPath("batch-review-desktop.png"),
    fullPage: true,
  });
  for (let i = 0; i < 2; i++) {
    await page.locator("#automaticIssues button").first().click();
    await revealControl(page, "whole");
    await page.locator("#whole").click();
    await page.locator("#autoNext").uncheck();
    await page.locator("#confirm").click();
    await expect(page.locator("#automaticIssues li")).toHaveCount(1 - i);
  }
  await revealControl(page, "autoOrganize");
  await page.locator("#autoOrganize").click();
  await expect(page.locator("#download")).toBeVisible();
  await expect(page.locator("#status")).toContainText("已生成 5 页 PPTX");
  await expect(page.locator("#counts")).toContainText(
    "2 页已确认 · 3 页自动校正",
  );
});

test("自动整理可取消和重试，关闭导入定位也可主动启动，元数据缺图不能导出", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message: { kind?: string }) {
      if (message.kind === "detect")
        setTimeout(() => {
          try {
            original.call(this, message);
          } catch {
            /* cancelled worker */
          }
        }, 700);
      else original.call(this, message);
    };
  });
  await page.goto("/");
  await revealControl(page, "autoDetect");
  await page.locator("#autoDetect").uncheck();
  await demo(page);
  await revealControl(page, "autoOrganize");
  await page.locator("#autoOrganize").click();
  await expect(page.locator("#cancelAutomatic")).toBeVisible();
  await expect(page.locator("#autoOrganize")).toBeDisabled();
  await page.locator("#cancelAutomatic").click();
  await expect(page.locator("#autoOrganize")).toBeEnabled();
  await expect(page.locator("#status")).toContainText("已取消");
  await expect(page.locator("#download")).toBeHidden();
  await expect(page.locator(".page-row")).toHaveCount(3);
  await revealControl(page, "autoOrganize");
  await page.locator("#autoOrganize").click();
  await expect(page.locator("#download")).toBeVisible();
  await page.waitForTimeout(400);
  await page.reload();
  await expect(page.locator("#cacheStatus")).toContainText(
    "已保存 3 / 3 张原图",
  );
  await expect(page.locator("#autoOrganize")).toBeEnabled();
  await page.locator("#stepExport").click();
  await page.locator("#export").click();
  await expect(page.locator("#download")).toBeVisible();
});

test("自动生成文件阶段也能取消，保留自动校正页面后重试", async ({ page }) => {
  await page.addInitScript(() => {
    const original = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message: {
      kind?: string;
      maxEdge?: number;
    }) {
      if (message.kind === "warp" && message.maxEdge === 3200)
        setTimeout(() => {
          try {
            original.call(this, message);
          } catch {
            /* cancelled worker */
          }
        }, 700);
      else original.call(this, message);
    };
  });
  await page.goto("/");
  await demo(page);
  await revealControl(page, "autoOrganize");
  await page.locator("#autoOrganize").click();
  await expect(page.locator("#status")).toContainText("生成第 1 / 3 页");
  await page.locator("#cancelAutomatic").click();
  await expect(page.locator("#stepReview")).toBeEnabled();
  await expect(page.locator("#download")).toBeHidden();
  await expect(page.locator("#counts")).toContainText("3 页自动校正");
  await page.locator("#stepReview").click();
  await revealControl(page, "autoOrganize");
  await page.locator("#autoOrganize").click();
  await expect(page.locator("#download")).toBeVisible();
  await expect(page.locator("#status")).toContainText("已生成 3 页 PPTX");
});

test("自动入口和待检查列表支持窄屏、键盘及高对比模式", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await uncertain(page);
  await revealControl(page, "autoOrganize");
  const action = page.locator("#autoOrganize");
  expect((await action.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await page.keyboard.press("Tab");
  await action.focus();
  await expect(action).toBeFocused();
  expect(
    await action.evaluate((el) => getComputedStyle(el).outlineStyle),
  ).not.toBe("none");
  await action.press("Enter");
  await expect(page.locator("#automaticIssues li")).toHaveCount(2);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(
    (await page.locator("#automaticIssues button").first().boundingBox())
      ?.height,
  ).toBeGreaterThanOrEqual(44);
  await page.screenshot({
    path: info.outputPath("batch-mobile.png"),
    fullPage: true,
  });
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  await page.screenshot({
    path: info.outputPath("batch-high-contrast.png"),
    fullPage: true,
  });
  await page
    .locator("#automaticIssues button")
    .filter({ hasText: "多个画面.png" })
    .focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#currentName")).toContainText("多个画面.png");
});
