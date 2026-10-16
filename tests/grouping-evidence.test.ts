import { test } from "node:test";
import assert from "node:assert/strict";
import { suggestGroups } from "../src/reports.ts";
import {
  groupingEvidence,
  templateSignature,
  layoutDistance,
} from "../src/grouping-evidence.ts";
import type { Photo } from "../src/types.ts";
const p = (
  id: string,
  text: string,
  template?: number[],
  lines?: NonNullable<Photo["reading"]>["lines"],
) =>
  ({
    id,
    name: id + ".jpg",
    corners: [{ x: 1, y: 2 }],
    processed: true,
    reading: { text, digest: id, confidence: 1, template, lines },
  }) as Photo;
const ids = (photos: Photo[]) => suggestGroups(photos).map((g) => g.reportId);
test("不同机构的同领域报告不被会议水印粘在一起", () => {
  const watermark = "第二届太空光伏技术创新论坛\n江苏•苏州\n2026年4月9日";
  const photos = [
    p("a", "甲方光电\n空间太阳电池发展趋势\n" + watermark),
    p("b", "甲方光电\n空间太阳电池效率分析\n" + watermark),
    p("c", "乙方光伏\n空间太阳电池发展趋势\n" + watermark),
    p("d", "乙方光伏\n空间太阳电池效率分析\n" + watermark),
  ];
  const before = structuredClone(photos);
  assert.deepEqual(ids(photos), ["a", "a", "c", "c"]);
  assert.deepEqual(photos, before);
});
test("无报告人标签的封面以标题、公司和署名联合判断", () => {
  const photos = [
    p("a", "已有报告研究成果与实验分析\n批量生产及组件认证"),
    p(
      "b",
      "太空光伏组件测试关键问题与解决方案\n示例电能科技有限公司\n李明\n第二届太空光伏论坛\n2026年4月9日",
    ),
  ];
  assert.equal(groupingEvidence(photos[1]).cover, true);
  assert.deepEqual(ids(photos), ["a", "b"]);
});
test("正文引用机构、图表变化和空白不能单独触发拆组", () => {
  const lines = [
    { text: "参考示例大学", confidence: 1, y: 0.5 },
    { text: "ALPHA ENERGY", confidence: 1, y: 0.95 },
  ];
  const photos = [
    p("a", "ALPHA ENERGY\n器件研究与实验结果", Array(12).fill(255), lines),
    p(
      "b",
      "新的图表和不同的实验结果\n参考示例大学\nALPHA ENERGY",
      Array(12).fill(0),
      lines,
    ),
    p("c", ""),
  ];
  assert.deepEqual(ids(photos), ["a", "a", "a"]);
});
test("有文字位置时仅页眉页脚机构参与身份变化", () => {
  const photos = [
    p("a", "甲方光电\n器件实验分析", undefined, [
      { text: "甲方光电", confidence: 1, y: 0.05 },
    ]),
    p("b", "乙方大学\n甲方光电\n新的实验方法", undefined, [
      { text: "乙方大学", confidence: 1, y: 0.5 },
      { text: "甲方光电", confidence: 1, y: 0.05 },
    ]),
  ];
  assert.deepEqual(ids(photos), ["a", "a"]);
});
test("版式变化与新机构及主题线索组合判断，不把换背景当新报告", () => {
  const photos = [
    p("a", "轨道控制的理论与算法\n参数推导与数学模型", Array(12).fill(255)),
    p("b", "材料界面钝化方法及其应用\n示例大学", Array(12).fill(0)),
    p("c", "电子束辐照实验装置与数据", Array(12).fill(255)),
  ];
  assert.deepEqual(ids(photos), ["a", "b", "b"]);
  assert.match(suggestGroups(photos)[1].reason, /版式/);
});
test("机构 OCR 错字需共同字标佐证，低置信识别不作为标识", () => {
  const photos = [
    p("a", "星海光电\nSTELLAR ENERGY\n光伏组件的研究与测试"),
    p("b", "星每光电\nSTELLAR ENERGY\n光伏组件效率与稳定性研究"),
    p("c", "其他光伏", undefined, [
      { text: "其他光伏", confidence: 0.1, y: 0.05 },
    ]),
  ];
  assert.deepEqual(ids(photos), ["a", "a", "a"]);
});
test("模板签名忽略中间图表，仅比较外围模板", () => {
  const width = 100,
    height = 100,
    a = new Uint8ClampedArray(width * height * 4).fill(255),
    b = a.slice();
  for (let y = 20; y < 80; y++)
    for (let x = 10; x < 90; x++)
      for (let c = 0; c < 3; c++) b[(y * width + x) * 4 + c] = 0;
  assert.deepEqual(
    templateSignature(a, width, height),
    templateSignature(b, width, height),
  );
  assert.equal(layoutDistance(undefined, [1]), 0);
  assert.equal(layoutDistance([0], [255]), 1);
});

test("机构只差一字也不能仅凭编辑距离视为同一家", () => {
  assert.deepEqual(
    ids([
      p("a", "南方大学\n空间太阳电池应用研究"),
      p("b", "北方大学\n空间太阳电池应用研究"),
    ]),
    ["a", "b"],
  );
});
