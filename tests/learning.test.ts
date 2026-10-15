import test from "node:test";
import assert from "node:assert/strict";
import {
  sceneFeature,
  matchCorrection,
  rememberCorrection,
  validCorrection,
} from "../src/learning.ts";
import { fullCorners } from "../src/geometry.ts";
const feature = {
  aspect: 1.5,
  cells: Array.from({ length: 96 }, (_, i) => (i % 2 ? 0.3 : -0.3)),
};
const correction = { feature, corners: fullCorners(), time: 1 };
test("纠正经验匹配相似构图，返回独立四角而不改写样本", () => {
  const points = matchCorrection(
    { ...feature, cells: feature.cells.map((v) => v + 0.005) },
    [correction],
  );
  assert.deepEqual(points, fullCorners());
  points![0].x = 0.1;
  assert.equal(correction.corners[0].x, 0);
});
test("不同构图、方向、平面和矛盾经验不产生建议", () => {
  assert.equal(
    matchCorrection({ ...feature, aspect: 0.66 }, [correction]),
    undefined,
  );
  assert.equal(
    matchCorrection({ ...feature, cells: feature.cells.map((v) => -v) }, [
      correction,
    ]),
    undefined,
  );
  assert.equal(
    matchCorrection({ ...feature, cells: Array(96).fill(0) }, [correction]),
    undefined,
  );
  const other = {
    ...correction,
    corners: fullCorners().map((p) => ({
      x: 0.2 + p.x * 0.6,
      y: 0.2 + p.y * 0.6,
    })),
  };
  assert.equal(matchCorrection(feature, [correction, other]), undefined);
  assert.equal(validCorrection({}), false);
});
test("相同构图更新纠正经验，容量有界且无效输入不保存", () => {
  const updated = rememberCorrection([correction], { ...correction, time: 2 });
  assert.equal(updated.length, 1);
  assert.equal(updated[0].time, 2);
  assert.equal(
    rememberCorrection(Array(40).fill(correction), {
      ...correction,
      feature: { ...feature, aspect: 2 },
    }).length,
    30,
  );
  assert.deepEqual(rememberCorrection([], { ...correction, corners: [] }), []);
});
test("构图特征不保存原像素，均匀亮度差不改变布局", () => {
  const raster = (offset: number) =>
    Uint8ClampedArray.from({ length: 24 * 16 * 4 }, (_, i) =>
      i % 4 === 3 ? 255 : (Math.floor(i / 4) % 24 < 12 ? 40 : 180) + offset,
    );
  const a = sceneFeature(raster(0), 24, 16),
    b = sceneFeature(raster(20), 24, 16);
  assert.equal(a.cells.length, 96);
  assert.ok(a.cells.every((v, i) => Math.abs(v - b.cells[i]) < 0.002));
});
