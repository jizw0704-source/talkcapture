import { test } from "node:test";
import assert from "node:assert/strict";
import { suggestGroups, reportMarkdown } from "../src/reports.ts";
import type { Photo } from "../src/types.ts";
const photo = (id: string, text: string, captured = 0) =>
  ({
    id,
    name: id + ".jpg",
    captured,
    reading: { text, digest: id, confidence: 1 },
  }) as Photo;
test("new speaker and topic suggest a boundary while blank pages remain", () => {
  const ps = [
    photo(
      "a",
      "钙钛矿太阳能电池的效率提升\n报告人：张老师\n界面钝化和光伏器件性能",
    ),
    photo("b", "钙钛矿太阳能电池的界面钝化\n光伏器件效率提升"),
    photo(
      "c",
      "机器人运动控制研究与应用\n报告人：李老师\n机械臂轨迹规划与强化学习",
    ),
    photo("d", ""),
  ];
  assert.deepEqual(
    suggestGroups(ps).map((g) => g.reportId),
    ["a", "a", "c", "c"],
  );
});
test("time alone does not split the same topic", () => {
  const ps = [
    photo("a", "材料表面分析方法与实验结果", 1),
    photo("b", "材料表面分析方法与实验结果", 4000000),
  ];
  assert.deepEqual(
    suggestGroups(ps).map((g) => g.reportId),
    ["a", "a"],
  );
});
test("markdown cites original page order and retains missing content", () => {
  const ps = [
    photo("a", "这是第一份报告的重要观点"),
    photo("b", "这是第二份报告的重要观点"),
    photo("c", ""),
  ];
  const md = reportMarkdown("第二份报告", ps.slice(1), ps);
  assert.match(md, /来源：第 2 页/);
  assert.match(md, /第 3 页/);
  assert.match(md, /未识别，请补充/);
  assert.match(md, /未经生成式模型解读/);
  assert.doesNotMatch(md, /第一份报告的重要观点/);
});
