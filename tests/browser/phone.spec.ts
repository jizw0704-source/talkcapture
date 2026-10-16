import { revealControl, dropOriginalCache } from "./ui";
import { test, expect, type Page } from "@playwright/test";

async function connect(desktop: Page, mobile: Page) {
  await desktop.goto("/");
  await expect(desktop.locator("#add")).toBeEnabled();
  if (!(await desktop.locator("#importScreen").isVisible()))
    await desktop.locator("#stepImport").click();
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
    await page.locator("#stepImport").click();
    await page.locator("#phoneOpen").click();
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
    await expect(mobile.locator("#list")).toContainText(
      "照片无法解码，请检查文件是否损坏。",
    );
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
    await mobile.locator("#filter").selectOption("review");
    await expect(mobile.locator("#list li:visible")).toHaveCount(1);
    await expect(mobile.locator("#list li:visible")).toContainText(
      "边界需在电脑上核对",
    );
    await expect(page.locator("#importReviewSummary")).toContainText(
      "1 张边界待核对",
    );
  } finally {
    await page
      .locator("#phoneHide")
      .click()
      .catch(() => undefined);
    await context.close();
  }
});

test("手机批量上传遇到队列繁忙会等待重试，十二张均导入", async ({
  page,
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const mobile = await context.newPage();
  try {
    await connect(page, mobile);
    let attempts = 0;
    await mobile.route("**/api/upload", async (route) => {
      attempts++;
      if (attempts === 1)
        await route.fulfill({
          status: 429,
          contentType: "application/json",
          body: JSON.stringify({ error: "电脑有较多待导入照片，请稍后重试。" }),
        });
      else await route.continue();
    });
    const buffer = await image(page, true);
    await mobile.locator("#photos").setInputFiles(
      Array.from({ length: 12 }, (_, i) => ({
        name: `连续上传${i + 1}.jpg`,
        mimeType: "image/jpeg",
        buffer,
      })),
    );
    await mobile.locator("#upload").click();
    await expect(page.locator(".page-row")).toHaveCount(12, { timeout: 90000 });
    await expect(
      mobile.locator("#list li").filter({ hasText: "电脑已导入" }),
    ).toHaveCount(12, { timeout: 30000 });
    expect(attempts).toBeGreaterThan(12);
    await page.locator("#phoneStop").click();
  } finally {
    await context.close();
  }
});

test("失败项保留缩略图和原因，其他完成后集中提醒并仅重试失败项", async ({
  page,
  browser,
}, info) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const mobile = await context.newPage();
  try {
    await connect(page, mobile);
    let fail = true;
    await mobile.route("**/api/upload", (route) => {
      if (route.request().headers()["x-photo-name"] === "failed.jpg" && fail) {
        fail = false;
        return route.abort();
      }
      return route.continue();
    });
    const buffer = await image(page, true);
    await mobile.locator("#photos").setInputFiles(
      ["good1.jpg", "failed.jpg", "good2.jpg"].map((name) => ({
        name,
        mimeType: "image/jpeg",
        buffer,
      })),
    );
    await mobile.locator("#upload").click();
    await expect(page.locator(".page-row")).toHaveCount(2);
    await expect(mobile.locator("#failureNotice")).toBeVisible();
    await expect(mobile.locator("#failureHeading")).toContainText(
      "还有 1 张需要重传",
    );
    await expect(mobile.locator("#filter")).toHaveValue("failed");
    await expect(mobile.locator("#list li:visible")).toHaveCount(1);
    await expect(mobile.locator("#list li:visible")).toContainText(
      "failed.jpg",
    );
    await expect(mobile.locator("#list li:visible")).toContainText("网络中断");
    await expect(mobile.locator("#list li:visible img")).toBeVisible();
    for (const width of [390, 320]) {
      await mobile.setViewportSize({ width, height: 844 });
      expect(
        await mobile.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      await mobile.screenshot({
        path: info.outputPath(`phone-failed-${width}.png`),
        fullPage: true,
      });
    }
    await mobile.getByRole("button", { name: "只重试这张" }).click();
    await expect(page.locator(".page-row")).toHaveCount(3);
    await expect(mobile.locator("#failureNotice")).toBeHidden();
    await expect(mobile.locator("#batchCounts")).toContainText("已导入 3");
    await mobile.locator("#filter").selectOption("all");
    await expect(mobile.locator("#list li")).toHaveCount(3);
    await mobile.emulateMedia({
      forcedColors: "active",
      reducedMotion: "reduce",
    });
    await expect(mobile.locator("#filter")).toBeVisible();
  } finally {
    await page
      .locator("#phoneHide")
      .click()
      .catch(() => undefined);
    await context.close();
  }
});

test("连接过期时等待导入的照片标明结果未确认，不遗留无限等待", async ({
  page,
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const mobile = await context.newPage();
  try {
    await connect(page, mobile);
    await page.route("**/api/phone/ack/**", (route) => route.abort());
    let expired = false;
    await mobile.route("**/api/status", (route) =>
      expired
        ? route.fulfill({
            status: 410,
            contentType: "application/json",
            body: JSON.stringify({ error: "连接已过期" }),
          })
        : route.continue(),
    );
    await mobile.locator("#photos").setInputFiles({
      name: "pending.jpg",
      mimeType: "image/jpeg",
      buffer: await image(page, true),
    });
    await mobile.locator("#upload").click();
    await expect(mobile.locator("#list")).toContainText("等待导入");
    expired = true;
    await expect(mobile.locator("#list")).toContainText("导入结果未确认");
    await expect(mobile.locator("#failureNotice")).toBeVisible();
    await expect(mobile.locator("#batchCounts")).toContainText("待完成 0");
  } finally {
    await page
      .locator("#phoneHide")
      .click()
      .catch(() => undefined);
    await context.close();
  }
});

test("上传中连接失效仍显示失效原因，不被取消提示覆盖", async ({
  page,
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const mobile = await context.newPage();
  try {
    await connect(page, mobile);
    let expired = false;
    await mobile.route("**/api/upload", () => {});
    await mobile.route("**/api/status", (route) =>
      expired
        ? route.fulfill({
            status: 410,
            contentType: "application/json",
            body: JSON.stringify({ error: "连接已过期" }),
          })
        : route.continue(),
    );
    await mobile.locator("#photos").setInputFiles({
      name: "sending.jpg",
      mimeType: "image/jpeg",
      buffer: await image(page, true),
    });
    await mobile.locator("#upload").click();
    await expect(mobile.locator("#list")).toContainText("上传中");
    expired = true;
    await expect(mobile.locator("#list")).toContainText(
      "连接已失效，导入结果未确认",
    );
    await expect(mobile.locator("#failureNotice")).toBeVisible();
    await expect(mobile.locator("#batchCounts")).toContainText("待完成 0");
  } finally {
    await page
      .locator("#phoneHide")
      .click()
      .catch(() => undefined);
    await context.close();
  }
});

test("手机定向补传只恢复指定旧页，并在下次刷新自动恢复原图", async ({
  page,
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const mobile = await context.newPage();
  try {
    await connect(page, mobile);
    const buffer = await image(page, true);
    await mobile
      .locator("#photos")
      .setInputFiles({ name: "原报告.jpg", mimeType: "image/jpeg", buffer });
    await mobile.locator("#upload").click();
    await expect(page.locator("#cacheStatus")).toContainText(
      "已保存 1 / 1 张原图",
    );
    await dropOriginalCache(page);
    await page.reload();
    await expect(page.locator("#replaceSource")).toBeVisible();
    await connect(page, mobile);
    await revealControl(page, "replaceFromPhone");
    await page.locator("#replaceFromPhone").click();
    await expect(page.locator("#phoneReplacementNotice")).toContainText(
      "原报告.jpg",
    );
    await mobile.locator("#photos").setInputFiles({
      name: "改名后的原报告.jpg",
      mimeType: "image/jpeg",
      buffer,
    });
    await mobile.locator("#upload").click();
    await expect(page.locator("#cacheStatus")).toContainText(
      "已保存 1 / 1 张原图",
    );
    await expect(page.locator(".page-row")).toHaveCount(1);
    await expect(page.locator(".photo-name")).toContainText("原报告.jpg");
    await expect(mobile.locator("#list")).toContainText("电脑已导入");
    await page.reload();
    await expect(page.locator("#cacheStatus")).toContainText(
      "已保存 1 / 1 张原图",
    );
    await expect(page.locator(".missing")).toHaveCount(0);
  } finally {
    if (await page.locator("#phonePanel").isVisible())
      await page
        .locator("#phoneHide")
        .click()
        .catch(() => undefined);
    await context.close();
  }
});
