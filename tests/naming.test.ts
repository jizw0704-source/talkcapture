import test from "node:test";
import assert from "node:assert/strict";
import { suggestReportName } from "../src/naming.ts";
const photo = (name: string, extra = {}) => ({
  name,
  captured: null,
  modified: 0,
  excluded: false,
  ...extra,
});
test("名称使用有意义的共同文件名、拍摄日期和保留页数", () => {
  const date = new Date(2026, 9, 15, 12).getTime();
  assert.equal(
    suggestReportName([
      photo("钙钛矿报告_01.jpg", { captured: date }),
      photo("钙钛矿报告_02.jpg", { captured: date }),
      photo("other.jpg", { excluded: true }),
    ]),
    "钙钛矿报告_2026-10-15_2页",
  );
});
test("相机编号不会冒充主题，无拍摄时间时使用当前日期", () => {
  assert.equal(
    suggestReportName([photo("IMG_1234.HEIC")], new Date(2026, 9, 16, 12)),
    "学术报告_2026-10-16_1页",
  );
});
