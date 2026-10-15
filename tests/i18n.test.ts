import { test } from "node:test";
import assert from "node:assert/strict";
import { setLanguage, t } from "../shared/i18n.js";
test("UI translations preserve interpolation values and original report text", () => {
  setLanguage("en");
  assert.equal(t("设置"), "Settings");
  assert.equal(
    t("第 {0} 页 · {1}", 12, "中文原始照片.jpg"),
    "Page 12 · 中文原始照片.jpg",
  );
  assert.equal(
    t("这些文字属于报告原文，不应翻译。"),
    "这些文字属于报告原文，不应翻译。",
  );
  assert.equal(
    t("已保存 3 / 3 张原图到本地，刷新后可自动恢复。"),
    "Saved 3 / 3 originals locally. Refresh recovery is available.",
  );
  setLanguage("zh");
  assert.equal(t("设置"), "设置");
  assert.equal(
    t("第 {0} 页 · {1}", 12, "中文原始照片.jpg"),
    "第 12 页 · 中文原始照片.jpg",
  );
});
