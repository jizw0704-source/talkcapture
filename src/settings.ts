import { t, uiText, uiAttr, getLanguage } from "../shared/i18n.js";
declare const __APP_VERSION__: string;
declare const __BUILD_VERSION__: string;
export function setupSettings() {
  const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
    document.getElementById(id) as T;
  const dialog = $<HTMLDialogElement>("settingsPanel"),
    open = $("settingsOpen"),
    close = $("settingsClose");
  const theme = $<HTMLSelectElement>("themeChoice"),
    font = $<HTMLSelectElement>("fontChoice"),
    model = $<HTMLInputElement>("modelChoice"),
    base = $<HTMLSelectElement>("modelRegion"),
    key = $<HTMLInputElement>("modelKey");
  const status = $("settingsStatus"),
    save = $<HTMLButtonElement>("saveModelSettings"),
    test = $<HTMLButtonElement>("testModelSettings");
  const media = matchMedia("(prefers-color-scheme: dark)");
  let themeValue = "system",
    fontValue = "standard",
    pending = false,
    loaded = false;
  try {
    const saved = JSON.parse(
      localStorage.getItem("talkcapture-display") || "{}",
    );
    if (["system", "light", "dark"].includes(saved.theme))
      themeValue = saved.theme;
    if (["standard", "large", "larger"].includes(saved.font))
      fontValue = saved.font;
  } catch {}
  function apply() {
    document.documentElement.dataset.theme =
      themeValue === "system" ? (media.matches ? "dark" : "light") : themeValue;
    document.documentElement.dataset.fontSize = fontValue;
    theme.value = themeValue;
    font.value = fontValue;
  }
  function store() {
    apply();
    try {
      localStorage.setItem(
        "talkcapture-display",
        JSON.stringify({ theme: themeValue, font: fontValue }),
      );
    } catch {
      uiText(status, () =>
        t("显示设置已应用，但浏览器无法保存，下次打开可能需要重新选择。"),
      );
    }
  }
  theme.onchange = () => {
    themeValue = theme.value;
    store();
  };
  font.onchange = () => {
    fontValue = font.value;
    store();
  };
  media.addEventListener("change", apply);
  apply();
  uiText($("versionInfo"), () =>
    t("软件版本 {0} \u00B7 本地开发版", __APP_VERSION__),
  );
  uiText($("buildInfo"), () =>
    t(
      "构建于 {0}",
      new Date(__BUILD_VERSION__).toLocaleString(
        getLanguage() === "en" ? "en-US" : "zh-CN",
      ),
    ),
  );
  async function request(path: string, method = "GET", value?: unknown) {
    const response = await fetch(path, {
      method,
      headers: {
        "x-desktop-client": "1",
        ...(value ? { "Content-Type": "application/json" } : {}),
      },
      body: value ? JSON.stringify(value) : undefined,
      signal: AbortSignal.timeout(180000),
    });
    const data = await response.json();
    if (!response.ok) throw Error(data.error || "操作失败，请重试。");
    return data;
  }
  function lock(v: boolean) {
    pending = v;
    save.disabled = v || !loaded;
    test.disabled = v || !loaded;
    model.disabled = v || !loaded;
    base.disabled = v || !loaded;
    key.disabled = v || !loaded;
  }
  async function load() {
    loaded = false;
    lock(true);
    uiText(status, () => t("正在读取电脑端配置\u2026"));
    try {
      const data = await request("/api/settings");
      model.value = data.model;
      base.value = data.base;
      uiText($("keyState"), () =>
        data.keyConfigured
          ? t("已配置密钥；留空可保留当前密钥。")
          : t("尚未配置密钥。"),
      );
      loaded = true;
      uiText(status, () =>
        data.environmentOverride
          ? t("当前使用启动环境变量，页面保存前需移除环境变量。")
          : t("密钥只保存在这台电脑；解读仅发送选中报告文字及来源页码。"),
      );
    } catch (e) {
      uiText(status, () => (e as Error).message + t(" 可关闭后重新打开重试。"));
    } finally {
      lock(false);
    }
  }
  open.onclick = () => {
    dialog.showModal();
    void load();
  };
  close.onclick = () => dialog.close();
  dialog.addEventListener("close", () => {
    key.value = "";
    open.focus();
  });
  save.onclick = async () => {
    if (pending || !loaded) return;
    lock(true);
    uiText(status, () => t("正在保存到电脑端\u2026"));
    try {
      const data = await request("/api/settings", "PUT", {
        model: model.value.trim(),
        base: base.value,
        ...(key.value ? { key: key.value } : {}),
      });
      key.value = "";
      uiText($("keyState"), () =>
        data.keyConfigured
          ? t("已配置密钥；留空可保留当前密钥。")
          : t("尚未配置密钥。"),
      );
      uiText(status, () => t("模型配置已保存，下次解读立即生效。"));
    } catch (e) {
      uiText(status, () => (e as Error).message);
    } finally {
      lock(false);
    }
  };
  test.onclick = async () => {
    if (pending || !loaded) return;
    if (key.value) {
      uiText(status, () => t("请先保存新密钥，再测试已保存的配置。"));
      return;
    }
    lock(true);
    uiText(status, () => t("正在测试已保存配置，不发送报告内容\u2026"));
    try {
      const data = await request("/api/settings/test", "POST");
      uiText(status, () => data.message);
    } catch (e) {
      uiText(status, () => (e as Error).message);
    } finally {
      lock(false);
    }
  };
}
