import { test, expect } from "@playwright/test";
test("English interface persists, preserves user content, and switches back without removing controls", async ({
  page,
}) => {
  await page.route("**/api/settings", (r) =>
    r.fulfill({
      json: {
        model: "MiniMax-M2.5",
        base: "https://api.minimax.cn/v1",
        keyConfigured: true,
      },
    }),
  );
  await page.goto("/");
  await page.locator("#settingsOpen").click();
  await page.locator("#languageChoice").selectOption("en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("#settingsTitle")).toHaveText("Settings");
  await expect(page.locator("#keyState")).toContainText("API key configured");
  await expect(page.locator("#themeChoice")).toBeVisible();
  await expect(page.locator("#modelKey")).toHaveValue("");
  await page.locator("#settingsClose").click();
  await expect(page.locator("#phoneOpen")).toHaveText("Phone transfer");
  await page.locator("#demo").click();
  await expect(page.locator("#cacheStatus")).toContainText("Saved 3 / 3");
  await expect(page.locator("#counts")).toContainText("3 photos");
  await page.locator("#editTools > summary").click();
  await page.locator("#reset").click();
  await expect(page.locator("#cornerPrompt")).toContainText("Top left");
  await page.locator("#whole").click();
  const name = await page.locator("#currentName").textContent();
  await expect(page.locator("#confirm")).toContainText("Correct and confirm");
  await page.locator("#settingsOpen").click();
  await page.locator("#languageChoice").selectOption("zh");
  await expect(page.locator("#settingsTitle")).toHaveText("设置");
  await expect(page.locator("#themeChoice")).toBeVisible();
  await page.locator("#settingsClose").click();
  await expect(page.locator("#currentName")).toHaveText(name!);
  await expect(page.locator("#counts")).toContainText("3 张照片");
  await page.locator("#settingsOpen").click();
  await page.locator("#languageChoice").selectOption("en");
  await page.locator("#settingsClose").click();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("#counts")).toContainText("3 photos");
  await expect(page.locator("#canvasViewport")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(page.locator("#previewImage")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "test-results/language-english-mobile.png",
    fullPage: true,
  });
});

test("phone upload inherits English from QR and can switch languages", async ({
  page,
  browser,
}) => {
  await page.route("**/api/settings", (r) =>
    r.fulfill({
      json: {
        model: "MiniMax-M2.5",
        base: "https://api.minimax.cn/v1",
        keyConfigured: true,
      },
    }),
  );
  await page.goto("/");
  await page.locator("#settingsOpen").click();
  await page.locator("#languageChoice").selectOption("en");
  await page.locator("#settingsClose").click();
  await page.locator("#phoneOpen").click();
  await expect(page.locator("#phoneStatus")).toContainText(/Wi-Fi|network/);
  if (!(await page.locator("#phoneNetwork option").count()))
    test.skip(true, "No LAN address on test machine");
  await page.locator("#phoneStart").click();
  await expect(page.locator("#phoneQr")).toBeVisible();
  const url = await page.locator("#phoneLink").inputValue();
  expect(new URL(url).searchParams.get("lang")).toBe("en");
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const mobile = await context.newPage();
  try {
    await mobile.goto(url);
    await expect(mobile.locator("html")).toHaveAttribute("lang", "en");
    await expect(mobile.locator("#connect")).toHaveText("Request access");
    await mobile.locator("#connect").click();
    await expect(page.locator("#phoneApprove")).toBeVisible();
    await page.locator("#phoneApprove").click();
    await expect(mobile.locator("#photos")).toBeEnabled();
    await expect(mobile.locator("#connection")).toContainText("Access allowed");
    await mobile.locator("[data-language-choice]").selectOption("zh");
    await expect(mobile.locator("#connect")).toHaveText("申请连接电脑");
    await expect(mobile.locator("#photos")).toBeVisible();
    await mobile.locator("[data-language-choice]").selectOption("en");
    await mobile.reload();
    await expect(mobile.locator("html")).toHaveAttribute("lang", "en");
    await mobile.screenshot({
      path: "test-results/language-phone-english.png",
      fullPage: true,
    });
  } finally {
    await context.close();
    await page.locator("#phoneStop").click();
  }
});
