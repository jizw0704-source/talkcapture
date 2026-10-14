import { revealControl } from "./ui";
import { test, expect, type Page } from "@playwright/test";

async function connect(desktop: Page, mobile: Page) {
  await desktop.goto("/");
  await desktop.locator("#phoneOpen").click();
  await expect(desktop.locator("#phoneStatus")).toHaveText(
    /选择电脑的 Wi-Fi 地址|没有可用的局域网地址/,
  );
  if (!(await desktop.locator("#phoneNetwork option").count()))
    test.skip(true, "测试机器没有可用局域网地址");
  await desktop.locator("#phoneStart").click();
  await expect(desktop.locator("#phoneQr")).toBeVisible();
  const url = await desktop.locator("#phoneLink").inputValue();
  await mobile.goto(url);
  await mobile.locator("#connect").click();
  await expect(desktop.locator("#phoneApprove")).toBeVisible();
  await expect(mobile.locator("#photos")).toBeDisabled();
  await desktop.locator("#phoneApprove").click();
  await expect(mobile.locator("#photos")).toBeEnabled();
  await mobile.locator("#photos").focus();
  await expect(mobile.locator(".picker")).toHaveCSS("outline-width", "3px");
}
async function image(page: Page, screen = false) {
  return Buffer.from(
    await page.evaluate((screen) => {
      const c = document.createElement("canvas");
      c.width = 1200;
      c.height = 800;
      const g = c.getContext("2d")!;
      g.fillStyle = screen ? "#252525" : "#fff";
      g.fillRect(0, 0, 1200, 800);
      if (screen) {
        g.fillStyle = "#ededed";
        g.beginPath();
        g.moveTo(120, 120);
        g.lineTo(1080, 80);
        g.lineTo(1030, 710);
        g.lineTo(180, 670);
        g.closePath();
        g.fill();
      }
      g.fillStyle = "#101010";
      g.font = "48px sans-serif";
      g.fillText("LAN PHOTO TEST", screen ? 260 : 90, screen ? 260 : 160);
      return c.toDataURL("image/jpeg").split(",")[1];
    }, screen),
    "base64",
  );
}
test("手机申请、电脑批准、两张照片自动定位并确认导出 PDF", async ({
  page,
  browser,
}, info) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const mobile = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  mobile.on("pageerror", (e) => errors.push(e.message));
  try {
    await connect(page, mobile);
    const buffer = await image(page, true);
    await mobile.locator("#photos").setInputFiles([
      { name: "报告照片1.jpg", mimeType: "image/jpeg", buffer },
      { name: "报告照片2.jpg", mimeType: "image/jpeg", buffer },
    ]);
    await mobile.locator("#upload").click();
    await expect(page.locator(".page-row")).toHaveCount(2);
    await expect(mobile.locator("#list")).toContainText("电脑已导入");
    await expect(page.locator("#add")).toBeEnabled();
    await expect(
      page.locator(".page-row").filter({ hasText: "自动定位" }),
    ).toHaveCount(2);
    await expect(page.locator("#previewImage")).toBeVisible();
    await expect(page.locator("#counts")).toContainText("0 页已确认");
    await revealControl(page, "confirm");
    await page.locator("#confirm").click();
    await expect(page.locator("#counts")).toContainText("1 页已确认");
    await revealControl(page, "confirm");
    await page.locator("#confirm").click();
    await expect(page.locator("#counts")).toContainText("2 页已确认");
    await revealControl(page, "format");
    await page.locator("#format").selectOption("pdf");
    await revealControl(page, "export");
    await page.locator("#export").click();
    await expect(page.locator("#download")).toBeVisible();
    await expect(page.locator("#status")).toContainText("2 页 PDF");
    expect(
      await mobile.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await mobile.screenshot({
      path: info.outputPath("phone-upload.png"),
      fullPage: true,
    });
    await page.screenshot({
      path: info.outputPath("desktop-pairing.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath("desktop-narrow-pairing.png"),
      fullPage: true,
    });
    await page.locator("#phoneStop").click();
    await expect(page.locator("#phoneQr")).toBeHidden();
    await expect(mobile.locator("#connection")).toContainText("无法连接");
    expect(errors).toEqual([]);
  } finally {
    await page
      .locator("#phoneHide")
      .click()
      .catch(() => undefined);
    await context.close();
  }
});
test("手机损坏照片被明确拒绝，新二维码重新配对，上传中断可重试", async ({
  page,
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const mobile = await context.newPage();
  try {
    await connect(page, mobile);
    await mobile.locator("#photos").setInputFiles({
      name: "broken.jpg",
      mimeType: "image/jpeg",
      buffer: Buffer.from("not a photo"),
    });
    await mobile.locator("#upload").click();
    await expect(mobile.locator("#list")).toContainText("不是支持的照片");
    await expect(page.locator(".page-row")).toHaveCount(0);
    await mobile.locator("#photos").setInputFiles({
      name: "incomplete.jpg",
      mimeType: "image/jpeg",
      buffer: Buffer.from([255, 216, 255, 1, 2, 3, 4, 5]),
    });
    await mobile.locator("#upload").click();
    await expect(mobile.locator("#list")).toContainText("电脑未能导入");
    await expect(page.locator(".page-row")).toHaveCount(0);
    await page.locator("#phoneStop").click();
    await expect(page.locator("#phoneStart")).toBeVisible();
    await connect(page, mobile);
    let interrupted = false;
    await mobile.route("**/api/upload", (route) => {
      if (!interrupted) {
        interrupted = true;
        return route.abort();
      }
      return route.continue();
    });
    await mobile.locator("#photos").setInputFiles({
      name: "valid.jpg",
      mimeType: "image/jpeg",
      buffer: await image(page),
    });
    await mobile.locator("#upload").click();
    await expect(mobile.locator("#list")).toContainText("网络中断");
    await expect(page.locator(".page-row")).toHaveCount(0);
    await mobile.locator("#retry").click();
    await expect(page.locator(".page-row")).toHaveCount(1);
    await expect(mobile.locator("#list")).toContainText("电脑已导入");
  } finally {
    await page
      .locator("#phoneHide")
      .click()
      .catch(() => undefined);
    await context.close();
  }
});
