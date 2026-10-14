import test from "node:test";
import assert from "node:assert/strict";
import {
  fullCorners,
  validateCorners,
  targetSize,
  homography,
  contain,
  rotatedCorners,
  safeName,
} from "../src/geometry.ts";

test("完整四角为有效的顺时针凸四边形", () =>
  assert.equal(validateCorners(fullCorners()), null));
test("不足四点不能确认", () =>
  assert.match(validateCorners(fullCorners().slice(0, 3))!, /四个角/));
test("交叉四角被拒绝", () => {
  const p = fullCorners();
  [p[1], p[2]] = [p[2], p[1]];
  assert.ok(validateCorners(p));
});
test("凹角被拒绝", () =>
  assert.ok(
    validateCorners([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0.2, y: 0.2 },
      { x: 0, y: 1 },
    ]),
  ));
test("越界和非有限坐标被拒绝", () => {
  for (const x of [-0.1, 1.1, NaN, Infinity]) {
    const p = fullCorners();
    p[0].x = x;
    assert.ok(validateCorners(p));
  }
});
test("退化及极小选区被拒绝", () => {
  assert.ok(validateCorners(fullCorners().map(() => ({ x: 0.5, y: 0.5 }))));
  assert.ok(
    validateCorners(
      fullCorners().map((p) => ({ x: p.x * 0.02, y: p.y * 0.02 })),
    ),
  );
});
test("不放大低分辨率图片", () =>
  assert.deepEqual(targetSize(fullCorners(), 800, 600, 3200), {
    width: 800,
    height: 600,
  }));
test("最长边限制保持输出比例", () =>
  assert.deepEqual(targetSize(fullCorners(), 6000, 4000, 3200), {
    width: 3200,
    height: 2133,
  }));
test("异常长宽比被拒绝", () =>
  assert.throws(() => targetSize(fullCorners(), 5000, 100, 3200), /比例异常/));
test("透视映射准确连接四个目标角和源角", () => {
  const source = [
    { x: 0.13, y: 0.12 },
    { x: 0.85, y: 0.08 },
    { x: 0.9, y: 0.87 },
    { x: 0.07, y: 0.8 },
  ];
  const m = homography(source);
  fullCorners().forEach(({ x, y }, i) => {
    const d = m[6] * x + m[7] * y + 1;
    assert.ok(Math.abs((m[0] * x + m[1] * y + m[2]) / d - source[i].x) < 1e-10);
    assert.ok(Math.abs((m[3] * x + m[4] * y + m[5]) / d - source[i].y) < 1e-10);
  });
});
test("退化透视矩阵不能求解", () =>
  assert.throws(
    () => homography(fullCorners().map(() => ({ x: 0, y: 0 }))),
    /透视变换/,
  ));
test("四次顺时针旋转恢复原坐标", () => {
  let points = fullCorners();
  for (let i = 0; i < 4; i++) points = rotatedCorners(points);
  assert.deepEqual(points, fullCorners());
});
test("旋转保持凸四边形与顶点顺序", () =>
  assert.equal(
    validateCorners(
      rotatedCorners([
        { x: 0.1, y: 0.2 },
        { x: 0.9, y: 0.1 },
        { x: 0.8, y: 0.9 },
        { x: 0.2, y: 0.8 },
      ]),
    ),
    null,
  ));
test("宽图完整放入页面且不拉伸", () => {
  const p = contain(2000, 1000, 10, 7.5);
  assert.deepEqual(p, { x: 0, y: 1.25, w: 10, h: 5 });
});
test("竖图居中完整放入页面", () => {
  const p = contain(1000, 2000, 10, 7.5);
  assert.deepEqual(p, { x: 3.125, y: 0, w: 3.75, h: 7.5 });
});
test("导出名称移除非法字符并提供默认名称", () => {
  assert.equal(safeName("a/b:c*?. "), "a_b_c__");
  assert.equal(safeName(""), "学术报告");
  assert.equal(safeName("x".repeat(100)).length, 80);
});
