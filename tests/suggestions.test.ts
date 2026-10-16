import test from "node:test";
import assert from "node:assert/strict";
import { suggestCorners } from "../src/suggestions.ts";
import { sceneFeature } from "../src/learning.ts";
import { detectSlide } from "../src/detection.ts";

test("人工纠正也用于已有几何候选的后续照片，但仍明确标记待核对经验建议", () => {
  const width = 240,
    height = 160,
    data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4,
        v = x > 35 && x < 205 && y > 25 && y < 135 ? 230 : 30;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  assert.equal(detectSlide(data, width, height).status, "suggested");
  const corners = [
    { x: 0.18, y: 0.18 },
    { x: 0.82, y: 0.18 },
    { x: 0.82, y: 0.8 },
    { x: 0.18, y: 0.8 },
  ];
  const result = suggestCorners(data, width, height, [
    { feature: sceneFeature(data, width, height), corners, time: 1 },
  ]);
  assert.equal(result.source, "local-correction");
  assert.deepEqual(result.corners, corners);
  assert.notEqual(
    suggestCorners(data, width, height).source,
    "local-correction",
  );
});
