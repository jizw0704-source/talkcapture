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

test("原文 Markdown 按组选取完整原文和原始页号，不混入摘要或其他组", async () => {
  const { reportSourceMarkdown, groupName } = await import("../src/reports.ts");
  const ps = [
    photo("a", "别的报告"),
    photo("b", "机器人方法研究\n报告人：李老师\n短句\n原文完整段落。"),
    photo("c", ""),
    photo("d", "第四页原文"),
  ];
  const md = reportSourceMarkdown("机器人的报告", [ps[1], ps[3]], ps);
  assert.match(md, /# 机器人的报告\n\n/);
  assert.match(md, /来源：第 2 页/);
  assert.match(md, /来源：第 4 页/);
  assert.match(md, /短句/);
  assert.match(md, /原文完整段落/);
  assert.doesNotMatch(md, /别的报告|主要内容摘录|主题线索/);
  assert.match(groupName([ps[1]]), /李老师_机器人方法研究/);
});

test("中间内容页未重复报告人时也能识别下一位报告人的报告", () => {
  const ps = [
    photo("a", "共同主题材料研究及测试结果\n报告人：张老师"),
    photo("b", "共同主题材料研究及测试结果"),
    photo("c", "共同主题材料研究及测试结果\n报告人：李老师"),
  ];
  assert.deepEqual(
    suggestGroups(ps).map((g) => g.reportId),
    ["a", "a", "c"],
  );
});

test("简短封面上的明确报告人变化也应拆组", () => {
  const ps = [
    photo("a", "报告人：张老师"),
    photo("b", "内容"),
    photo("c", "报告人：李老师"),
  ];
  assert.deepEqual(
    suggestGroups(ps).map((g) => g.reportId),
    ["a", "a", "c"],
  );
});

test("报告人标记支持 OCR 丢冒号、换行、中英文与全角字符", async () => {
  const { presenter, speakerOf, groupName } = await import("../src/reports.ts");
  for (const text of [
    "报告者 李老师",
    "主讲人\n李老师",
    "Speaker：李老师",
    "Presented by\n李老师",
    "汇报者: 李老师",
  ]) {
    assert.equal(presenter(text), "李老师", text);
    assert.equal(speakerOf([photo("x", text)]), "李老师");
  }
  assert.match(
    groupName([photo("x", "材料研究新进展\n报告者 李老师")]),
    /^李老师_/,
  );
});
test("同领域报告即使内容相近也按不同报告人拆分", () => {
  const common = "钙钛矿太阳能电池效率与稳定性研究";
  const ps = [
    photo("a", common + "\n报告者 张老师"),
    photo("b", common),
    photo("c", common + "\n主讲人\n李老师"),
    photo("d", common),
  ];
  assert.deepEqual(
    suggestGroups(ps).map((g) => g.reportId),
    ["a", "a", "c", "c"],
  );
});
test("同一报告人不同格式、时间间隔和内容变化不误拆", () => {
  const ps = [
    photo("a", "材料研究的新进展\nSpeaker: Alice Smith", 1),
    photo(
      "b",
      "机器人运动控制的理论与实验分析\nPresented by: ALICE  SMITH",
      4000000,
    ),
  ];
  assert.deepEqual(
    suggestGroups(ps).map((g) => g.reportId),
    ["a", "a"],
  );
});
test("正文提到另一位报告人不作为封面身份", async () => {
  const { presenter } = await import("../src/reports.ts");
  assert.equal(presenter("我们参考了报告人：李老师的相关工作"), "");
  assert.equal(presenter("Speaker recognition methods"), "");
});

test("前一报告缺报告人时保留明确新封面与主题变化的边界", () => {
  const ps = [
    photo("a", "机器人运动控制与轨迹规划研究"),
    photo("b", "钙钛矿太阳能电池效率与稳定性研究\n报告者 李老师"),
  ];
  assert.deepEqual(
    suggestGroups(ps).map((g) => g.reportId),
    ["a", "b"],
  );
});
