import { test, expect } from "@playwright/test";
test("settings dialog, saved display preferences, masked credentials and mobile dark mode", async ({
  page,
}) => {
  await page.route("**/api/settings", async (route) => {
    if (route.request().method() === "PUT") {
      expect(route.request().postDataJSON().key).toBe("test-only-key");
      return route.fulfill({ json: { saved: true, keyConfigured: true } });
    }
    return route.fulfill({
      json: {
        model: "MiniMax-M2.5",
        base: "https://api.minimax.cn/v1",
        keyConfigured: true,
      },
    });
  });
  await page.route("**/api/settings/test", (r) =>
    r.fulfill({ json: { message: "MiniMax 已响应，连接正常。" } }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await expect(page.locator("#settingsPanel")).toBeVisible();
  await expect(page.locator("#keyState")).toContainText("已配置");
  await expect(page.locator("#modelKey")).toHaveValue("");
  await page.locator("#modelSettings > summary").click();
  await page.locator("#modelKey").fill("test-only-key");
  await page.locator("#saveModelSettings").click();
  await expect(page.locator("#settingsStatus")).toContainText("已保存");
  await expect(page.locator("#modelKey")).toHaveValue("");
  await page.locator("#testModelSettings").click();
  await expect(page.locator("#settingsStatus")).toContainText("连接正常");
  await page.locator("#themeChoice").selectOption("dark");
  await page.locator("#fontChoice").selectOption("larger");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(
    await page.evaluate(
      () => getComputedStyle(document.documentElement).fontSize,
    ),
  ).toBe("18px");
  await page.locator("#settingsPanel").press("Escape");
  await expect(page.locator("#settingsOpen")).toBeFocused();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("html")).toHaveAttribute(
    "data-font-size",
    "larger",
  );
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(
    "test-only-key",
  );
  await page.locator("#settingsOpen").click();
  await expect(page.locator("#versionInfo")).toContainText("0.1.0");
  await expect(page.locator("#buildInfo")).toContainText("构建于");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({ path: "test-results/settings-dark-mobile.png" });
  await page.locator("#themeChoice").selectOption("system");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.locator("#fontChoice").selectOption("standard");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: "test-results/settings-light-desktop.png" });
});

test("settings isolate photo shortcuts and remain usable at 320px with large text", async ({
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
  await page.locator("#demo").click();
  await expect(page.locator("#cacheStatus")).toContainText("已保存 3 / 3");
  await page.locator("#settingsOpen").click();
  await expect(page.locator("#modelChoice")).toHaveValue("MiniMax-M2.5");
  await page.locator("#settingsClose").focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#currentName")).toContainText("示例报告_1");
  await page.locator("#themeChoice").selectOption("dark");
  await page.locator("#fontChoice").selectOption("larger");
  await page.setViewportSize({ width: 320, height: 780 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.locator("#settingsPanel").press("Escape");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  await page.locator("#settingsOpen").click();
  await expect(page.locator("#settingsClose")).toBeVisible();
});
