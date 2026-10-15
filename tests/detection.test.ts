import test from "node:test";
import assert from "node:assert/strict";
import { detectSlide } from "../src/detection.ts";
import { validateCorners, type Point } from "../src/geometry.ts";

const screen: Point[] = [
  { x: 0.15, y: 0.2 },
  { x: 0.86, y: 0.12 },
  { x: 0.81, y: 0.85 },
  { x: 0.22, y: 0.8 },
];
function raster(
  polygons: Point[][],
  background = 35,
  fill = 235,
  noise = false,
) {
  const width = 480,
    height = 320,
    data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const inside = polygons.some((points) =>
        points.every((p, k) => {
          const q = points[(k + 1) % points.length];
          return (
            (q.x - p.x) * (y / height - p.y) -
              (q.y - p.y) * (x / width - p.x) >=
            0
          );
        }),
      );
      const value =
        (inside ? fill : background) +
        (noise ? ((x * 23 + y * 17) % 11) - 5 : 0);
      const i = (y * width + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = value;
      data[i + 3] = 255;
    }
  return { data, width, height };
}
function run(
  polygons: Point[][],
  background?: number,
  fill?: number,
  noise?: boolean,
) {
  const { data, width, height } = raster(polygons, background, fill, noise);
  return detectSlide(data, width, height);
}
test("自动定位明亮投影画面的四角，并保留透视形状", () => {
  const result = run([screen]);
  assert.equal(result.status, "suggested");
  assert.equal(validateCorners(result.corners), null);
  result.corners.forEach((p, i) =>
    assert.ok(Math.hypot(p.x - screen[i].x, p.y - screen[i].y) < 0.025),
  );
});
test("暗底幻灯片和轻微噪声仍可给出完整四角建议", () => {
  for (const result of [run([screen], 190, 40), run([screen], 35, 235, true)])
    assert.equal(result.status, "suggested");
});
test("不会用内部图表的边框替代更大的投影边界", () => {
  const { data, width, height } = raster([screen]);
  for (let y = 130; y < 220; y++)
    for (let x = 155; x < 330; x++) {
      if (y > 134 && y < 216 && x > 159 && x < 326) continue;
      const i = (y * width + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 10;
    }
  const result = detectSlide(data, width, height);
  assert.equal(result.status, "suggested");
  result.corners.forEach((p, i) =>
    assert.ok(Math.hypot(p.x - screen[i].x, p.y - screen[i].y) < 0.025),
  );
});
test("空白、整图背景和圆形不能伪报完整 PPT 四角", () => {
  for (const polygons of [
    [],
    [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ],
  ])
    assert.equal(
      run(polygons.length ? [polygons as Point[]] : []).status,
      "not_found",
    );
  const { data, width, height } = raster([]);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (Math.hypot(x - 240, y - 160) < 110) {
        const i = (y * width + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = 230;
      }
  assert.equal(detectSlide(data, width, height).status, "not_found");
});
test("四角出框时回退手动，不夹取图像边缘补造四角", () => {
  const cropped = [
    { x: -0.05, y: 0.1 },
    { x: 0.9, y: 0.1 },
    { x: 0.9, y: 0.9 },
    { x: -0.05, y: 0.9 },
  ];
  assert.equal(run([cropped]).status, "not_found");
});
test("两个相近大小的投影候选提示人工选择", () => {
  const left = [
    { x: 0.04, y: 0.2 },
    { x: 0.46, y: 0.2 },
    { x: 0.46, y: 0.78 },
    { x: 0.04, y: 0.78 },
  ];
  const right = left.map((p) => ({ x: p.x + 0.5, y: p.y }));
  assert.equal(run([left, right]).status, "ambiguous");
});
test("分析不修改输入像素，且相同输入给出相同结果", () => {
  const { data, width, height } = raster([screen]);
  const original = data.slice();
  const first = detectSlide(data, width, height);
  assert.deepEqual(data, original);
  assert.deepEqual(detectSlide(data, width, height), first);
});
test("小图与无效维度安全回退或明确拒绝", () => {
  assert.equal(
    detectSlide(new Uint8ClampedArray(16 * 16 * 4), 16, 16).status,
    "not_found",
  );
  assert.throws(
    () => detectSlide(new Uint8ClampedArray(4), 480, 320),
    /分析图/,
  );
  assert.throws(() => detectSlide(new Uint8ClampedArray(4), NaN, 1), /分析图/);
});

test("低对比度投影保留完整边界，不因固定梯度阈值漏检", () => {
  const result = run([screen], 110, 120, true);
  assert.equal(result.status, "suggested");
  result.corners.forEach((p, i) =>
    assert.ok(Math.hypot(p.x - screen[i].x, p.y - screen[i].y) < 0.03),
  );
});

test("投影只占照片约十分之一时仍可定位完整边界", () => {
  const small = screen.map((p) => ({
    x: 0.5 + (p.x - 0.5) * 0.46,
    y: 0.5 + (p.y - 0.5) * 0.7,
  }));
  const result = run([small]);
  assert.equal(result.status, "suggested");
  result.corners.forEach((p, i) =>
    assert.ok(Math.hypot(p.x - small[i].x, p.y - small[i].y) < 0.03),
  );
});
