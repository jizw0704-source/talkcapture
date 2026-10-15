import { revealControl } from "./ui";
import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

test("鼠标拖动控制点、放大平移、拖动页序和交叉四角阻断", async ({ page }) => {
  await demo(page);
  await fourCorners(page);
  await revealControl(page, "editorCanvas");
  await page.locator("#editorCanvas").scrollIntoViewIfNeeded();
  const box = await page.locator("#editorCanvas").boundingBox();
  if (!box) throw Error("No canvas");
  const rect = await page.locator("#editorCanvas").evaluate((c) => {
    const s = Math.min(
      (c.clientWidth - 48) / 1600,
      (c.clientHeight - 48) / 1100,
    );
    return {
      x: (c.clientWidth - 1600 * s) / 2 + 180 * s,
      y: (c.clientHeight - 1100 * s) / 2 + 130 * s,
    };
  });
  await page.mouse.move(box.x + rect.x, box.y + rect.y);
  await page.mouse.down();
  await page.mouse.move(box.x + rect.x + 15, box.y + rect.y + 5, { steps: 5 });
  await page.mouse.up();
  expect(Number(await page.locator("#pointX").inputValue())).toBeGreaterThan(
    11.25,
  );
  await page.locator("#zoom").selectOption("2");
  await page.locator("#canvasViewport").scrollIntoViewIfNeeded();
  const vp = await page.locator("#canvasViewport").boundingBox();
  if (!vp) throw Error("No viewport");
  await page.mouse.move(vp.x + 200, vp.y + vp.height / 2);
  await page.mouse.down();
  await page.mouse.move(vp.x + 100, vp.y + vp.height / 2 - 30, { steps: 5 });
  await page.mouse.up();
  expect(
    await page.locator("#canvasViewport").evaluate((el) => el.scrollLeft),
  ).toBeGreaterThan(0);
  await page
    .locator(".page-row")
    .first()
    .dragTo(page.locator(".page-row").last());
  await expect(page.locator(".photo-name").last()).toContainText("_1.jpg");
  await revealControl(page, "pointSelect");
  await page.locator("#pointSelect").selectOption("0");
  await revealControl(page, "pointX");
  await page.locator("#pointX").fill("95");
  await revealControl(page, "pointY");
  await page.locator("#pointY").fill("95");
  await revealControl(page, "applyPoint");
  await page.locator("#applyPoint").click();
  await revealControl(page, "confirm");
  await page.locator("#confirm").click();
  await expect(page.locator("#status")).toContainText("顺时针");
  await expect(page.locator("#counts")).toContainText("0 页已确认");
  await revealControl(page, "whole");
  await page.locator("#whole").click();
  await revealControl(page, "autoNext");
  await page.locator("#autoNext").uncheck();
  await revealControl(page, "confirm");
  await page.locator("#confirm").click();
  await expect(page.locator("#counts")).toContainText("1 页已确认");
});

async function demo(page: Page) {
  await page.goto("/");
  await revealControl(page, "autoDetect");
  await page.locator("#autoDetect").uncheck();
  await revealControl(page, "demo");
  await page.locator("#demo").click();
  await expect(page.locator(".page-row")).toHaveCount(3);
  await expect(page.locator("#add")).toBeEnabled();
  await expect(page.locator("#canvasEmpty")).toBeHidden();
}
async function fourCorners(page: Page) {
  await revealControl(page, "editorCanvas");
  await page.locator("#editorCanvas").scrollIntoViewIfNeeded();
  const box = await page.locator("#editorCanvas").boundingBox();
  if (!box) throw Error("No canvas");
  const rect = await page.locator("#editorCanvas").evaluate((c) => {
    const width = c.clientWidth,
      height = c.clientHeight,
      scale = Math.min((width - 48) / 1600, (height - 48) / 1100);
    return {
      x: (width - 1600 * scale) / 2,
      y: (height - 1100 * scale) / 2,
      w: 1600 * scale,
      h: 1100 * scale,
    };
  });
  for (const [x, y] of [
    [180 / 1600, 130 / 1100],
    [1420 / 1600, 130 / 1100],
    [1420 / 1600, 950 / 1100],
    [180 / 1600, 950 / 1100],
  ]) {
    await page.mouse.click(
      box.x + rect.x + x * rect.w,
      box.y + rect.y + y * rect.h,
    );
  }
  await expect(page.locator("#previewImage")).toBeVisible();
}
async function clear(page: Page) {
  await revealControl(page, "clear");
  await page.locator("#clear").click();
  await page
    .getByRole("button", { name: "清空项目", exact: true })
    .last()
    .click();
  await expect(page.locator(".page-row")).toHaveCount(0);
}

test("四点校正、继承、排序、PDF 和 PPTX 的真正文件导出", async ({
  page,
}, testInfo) => {
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
  await demo(page);
  await revealControl(page, "export");
  await page.locator("#export").click();
  await expect(page.locator("#status")).toContainText("存在未确认页");
  await fourCorners(page);
  await revealControl(page, "confirm");
  await page.locator("#confirm").click();
  await expect(page.locator("#currentName")).toContainText("_2.jpg");
  await expect(page.locator("#counts")).toContainText("1 页已确认");
  await expect(page.locator("#cornerPrompt")).toContainText("四角已就绪");
  await revealControl(page, "confirm");
  await page.locator("#confirm").click();
  await expect(page.locator("#currentName")).toContainText("_3.jpg");
  await page.locator("#exclude").click();
  await expect(page.locator("#counts")).toContainText("1 页已排除");
  await revealControl(page, "pageTools");
  await page
    .locator(".page-row")
    .nth(1)
    .getByRole("button", { name: "上移", exact: true })
    .click();
  await expect(page.locator(".photo-name").first()).toContainText("_2.jpg");
  await revealControl(page, "format");
  await page.locator("#format").selectOption("pdf");
  await revealControl(page, "export");
  await page.locator("#export").click();
  await expect(page.locator("#download")).toBeVisible();
  const pdfDownload = page.waitForEvent("download");
  await page.locator("#download").click();
  const pdf = await pdfDownload;
  const pdfPath = testInfo.outputPath("report.pdf");
  await pdf.saveAs(pdfPath);
  const content = readFileSync(pdfPath);
  expect(content.subarray(0, 5).toString()).toBe("%PDF-");
  expect(content.toString("latin1").match(/\/Type \/Page\b/g)?.length).toBe(2);
  await revealControl(page, "format");
  await page.locator("#format").selectOption("pptx");
  await revealControl(page, "aspect");
  await page.locator("#aspect").selectOption("standard");
  await revealControl(page, "export");
  await page.locator("#export").click();
  await expect(page.locator("#download")).toBeVisible();
  const pptxDownload = page.waitForEvent("download");
  await page.locator("#download").click();
  const pptx = await pptxDownload;
  const pptxPath = testInfo.outputPath("report.pptx");
  await pptx.saveAs(pptxPath);
  const archive = execFileSync("/usr/bin/unzip", ["-Z1", pptxPath], {
    encoding: "utf8",
  }).split("\n");
  expect(
    archive.filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p)),
  ).toHaveLength(2);
  const types = execFileSync(
    "/usr/bin/unzip",
    ["-p", pptxPath, "[[]Content_Types].xml"],
    { encoding: "utf8" },
  );
  for (const match of types.matchAll(/PartName="\/([^"]+)"/g))
    expect(archive).toContain(match[1]);
  const slide = execFileSync(
    "/usr/bin/unzip",
    ["-p", pptxPath, "ppt/slides/slide1.xml"],
    { encoding: "utf8" },
  );
  expect(slide).toContain("<p:pic>");
  expect(slide).not.toContain("<a:srcRect");
  const presentation = execFileSync(
    "/usr/bin/unzip",
    ["-p", pptxPath, "ppt/presentation.xml"],
    { encoding: "utf8" },
  );
  expect(presentation).toContain('cx="9144000" cy="6858000"');
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath("desktop.png"),
    fullPage: true,
  });
});

test("排除恢复、拖动与坐标校验、撤销、旋转、亮度和刷新恢复", async ({
  page,
}) => {
  await demo(page);
  await fourCorners(page);
  await revealControl(page, "autoNext");
  await page.locator("#autoNext").uncheck();
  await revealControl(page, "confirm");
  await page.locator("#confirm").click();
  await expect(page.locator("#counts")).toContainText("1 页已确认");
  await revealControl(page, "pointSelect");
  await page.locator("#pointSelect").selectOption("0");
  await revealControl(page, "pointX");
  await page.locator("#pointX").fill("120");
  await revealControl(page, "applyPoint");
  await page.locator("#applyPoint").click();
  await expect(page.locator("#status")).toContainText("0–100%");
  await revealControl(page, "pointX");
  await page.locator("#pointX").fill("15");
  await revealControl(page, "applyPoint");
  await page.locator("#applyPoint").click();
  await expect(page.locator("#counts")).toContainText("0 页已确认");
  await revealControl(page, "undo");
  await page.locator("#undo").click();
  await expect(page.locator("#pointX")).toHaveValue("");
  await revealControl(page, "pointSelect");
  await page.locator("#pointSelect").selectOption("0");
  await expect(page.locator("#pointX")).toHaveValue("11.25");
  await revealControl(page, "editorCanvas");
  await page.locator("#editorCanvas").focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#pointX")).toHaveValue("11.35");
  await revealControl(page, "rotate");
  await page.locator("#rotate").click();
  await expect(page.locator("#canvasEmpty")).toBeHidden();
  await revealControl(page, "showOriginal");
  await page.locator("#showOriginal").click();
  await expect(page.locator("#previewMeta")).toContainText("原图对比");
  await revealControl(page, "brightness");
  await page.locator("#brightness").fill("10");
  await page.locator("#brightness").dispatchEvent("change");
  await revealControl(page, "pageTools");
  await page.locator(".page-row input").first().check();
  await revealControl(page, "excludeSelected");
  await page.locator("#excludeSelected").click();
  await expect(page.locator("#counts")).toContainText("1 页已排除");
  await revealControl(page, "restoreSelected");
  await page.locator("#restoreSelected").click();
  await expect(page.locator("#counts")).toContainText("0 页已排除");
  await revealControl(page, "movePosition");
  await page.locator("#movePosition").fill("3");
  await revealControl(page, "moveSelected");
  await page.locator("#moveSelected").click();
  await expect(page.locator(".photo-name").last()).toContainText("_1.jpg");
  await revealControl(page, "projectName");
  await page.locator("#projectName").fill("恢复测试");
  await page.waitForTimeout(400);
  await page.reload();
  await expect(page.locator("#recovery")).toContainText("已恢复 3 页编辑参数");
  await expect(page.locator("#projectName")).toHaveValue("恢复测试");
  await revealControl(page, "export");
  await page.locator("#export").click();
  await expect(page.locator("#status")).toContainText("缺少原图");
  await revealControl(page, "demo");
  await page.locator("#demo").click();
  await expect(page.locator("#add")).toBeEnabled();
  await expect(page.locator("#status")).toContainText("示例");
  await expect(page.locator(".page-row")).toHaveCount(3);
  await expect(page.locator("#recovery")).toBeHidden();
  await expect(page.locator(".photo-name").last()).toContainText("_1.jpg");
  await clear(page);
  await page.reload();
  await expect(page.locator(".page-row")).toHaveCount(0);
});

test("未处理页原图导出、取消后重试及窄屏无横向溢出", async ({
  page,
}, testInfo) => {
  await demo(page);
  await revealControl(page, "allowOriginal");
  await page.locator("#allowOriginal").check();
  await revealControl(page, "export");
  await page.locator("#export").click();
  await page.locator("#cancel").click();
  await expect(page.locator("#export")).toBeEnabled();
  await expect(page.locator("#download")).toBeHidden();
  await revealControl(page, "format");
  await page.locator("#format").selectOption("pdf");
  await revealControl(page, "export");
  await page.locator("#export").click();
  await expect(page.locator("#download")).toBeVisible();
  await expect(page.locator("#status")).toContainText("3 页 PDF");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await revealControl(page, "reset");
  await page.locator("#reset").focus();
  await expect(page.locator("#reset")).toBeFocused();
  await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });
  await expect(page.locator("#reset")).toBeVisible();
  await page.emulateMedia({ forcedColors: "none" });
  await page.screenshot({
    path: testInfo.outputPath("mobile.png"),
    fullPage: true,
  });
});

test("损坏文件与伪装扩展名不进入项目", async ({ page }) => {
  await page.goto("/");
  await page.locator("#files").setInputFiles([
    {
      name: "fake.jpg",
      mimeType: "image/jpeg",
      buffer: Buffer.from("not an image"),
    },
    {
      name: "broken.png",
      mimeType: "image/png",
      buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0]),
    },
  ]);
  await expect(page.locator("#add")).toBeEnabled();
  await expect(page.locator(".page-row")).toHaveCount(0);
  await expect(page.locator("#status")).toContainText("fake.jpg");
  await expect(page.locator("#status")).toContainText("broken.png");
});

test("EXIF 旋转方向在导入和预览中一致", async ({ page }) => {
  await page.goto("/");
  const jpeg = await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 200;
    c.height = 100;
    const g = c.getContext("2d")!;
    g.fillStyle = "#f00";
    g.fillRect(0, 0, 100, 100);
    g.fillStyle = "#00f";
    g.fillRect(100, 0, 100, 100);
    return c.toDataURL("image/jpeg").split(",")[1];
  });
  const image = Buffer.from(jpeg, "base64");
  // APP1 / EXIF: little-endian TIFF, orientation=6 (rotate 90° clockwise).
  const marker = Buffer.from([
    255, 225, 0, 34, 69, 120, 105, 102, 0, 0, 73, 73, 42, 0, 8, 0, 0, 0, 1, 0,
    18, 1, 3, 0, 1, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0,
  ]);
  await page.locator("#files").setInputFiles({
    name: "orientation-6.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.concat([image.subarray(0, 2), marker, image.subarray(2)]),
  });
  await expect(page.locator("#add")).toBeEnabled();
  await expect(page.locator("#pageMeta")).toContainText("100 × 200 px");
  await expect(page.locator("#canvasEmpty")).toBeHidden();
  await revealControl(page, "showOriginal");
  await page.locator("#showOriginal").click();
  const colors = await page
    .locator("#previewImage")
    .evaluate(async (img: HTMLImageElement) => {
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const g = c.getContext("2d")!;
      g.drawImage(img, 0, 0);
      return [
        Array.from(g.getImageData(50, 40, 1, 1).data),
        Array.from(g.getImageData(50, 160, 1, 1).data),
      ];
    });
  expect(colors[0][0]).toBeGreaterThan(200);
  expect(colors[1][2]).toBeGreaterThan(200);
});

test("100 张小图导入、101 张限制与整批原图 PDF 导出", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  const png = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 320;
    c.height = 180;
    const g = c.getContext("2d")!;
    g.fillStyle = "#fff";
    g.fillRect(0, 0, 320, 180);
    g.fillStyle = "#101010";
    g.font = "24px sans-serif";
    g.fillText("100 PAGE TEST", 20, 80);
    return c.toDataURL().split(",")[1];
  });
  const buffer = Buffer.from(png, "base64");
  await page.locator("#files").setInputFiles(
    Array.from({ length: 101 }, (_, i) => ({
      name: `report-${String(i + 1).padStart(3, "0")}.png`,
      mimeType: "image/png",
      buffer,
    })),
  );
  await expect(page.locator("#add")).toBeEnabled({ timeout: 60_000 });
  await expect(page.locator(".page-row")).toHaveCount(100);
  await expect(page.locator("#status")).toContainText("report-101.png");
  await revealControl(page, "format");
  await page.locator("#format").selectOption("pdf");
  await revealControl(page, "allowOriginal");
  await page.locator("#allowOriginal").check();
  await revealControl(page, "export");
  await page.locator("#export").click();
  await expect(page.locator("#download")).toBeVisible({ timeout: 60_000 });
  const downloaded = page.waitForEvent("download");
  await page.locator("#download").click();
  const file = await downloaded;
  const path = testInfo.outputPath("hundred-pages.pdf");
  await file.saveAs(path);
  expect(
    readFileSync(path)
      .toString("latin1")
      .match(/\/Type \/Page\b/g)?.length,
  ).toBe(100);
});

test("真实 HEIC 编码样例导入和 PDF 导出（macOS 本地编码器）", async ({
  page,
}, testInfo) => {
  test.skip(process.platform !== "darwin", "HEIC 样例由 macOS sips 生成");
  await page.goto("/");
  const pngPath = testInfo.outputPath("heic-source.png"),
    heicPath = testInfo.outputPath("sample.heic");
  await page.screenshot({ path: pngPath });
  execFileSync("/usr/bin/sips", [
    "-s",
    "format",
    "heic",
    pngPath,
    "--out",
    heicPath,
  ]);
  await page.locator("#files").setInputFiles(heicPath);
  await expect(page.locator("#add")).toBeEnabled({ timeout: 60_000 });
  await expect(page.locator(".page-row")).toHaveCount(1);
  await expect(page.locator("#pageMeta")).toContainText("HEIC");
  await revealControl(page, "allowOriginal");
  await page.locator("#allowOriginal").check();
  await revealControl(page, "format");
  await page.locator("#format").selectOption("pdf");
  await revealControl(page, "export");
  await page.locator("#export").click();
  await expect(page.locator("#download")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator("#status")).toContainText("1 页 PDF");
});
