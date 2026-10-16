import test from "node:test";
import assert from "node:assert/strict";
import { detectEdges, detectSlide } from "../src/detection.ts";
import { regionCandidates } from "../src/region-detection.ts";
const quad = [
  { x: 0.15, y: 0.2 },
  { x: 0.86, y: 0.12 },
  { x: 0.81, y: 0.85 },
  { x: 0.22, y: 0.8 },
];
function sample(fill: number[], background: number[], circle = false) {
  const width = 480,
    height = 320,
    data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const inside = circle
        ? Math.hypot(x - 240, y - 160) < 100
        : quad.every((a, k) => {
            const b = quad[(k + 1) % 4];
            return (
              (b.x - a.x) * (y / height - a.y) -
                (b.y - a.y) * (x / width - a.x) >=
              0
            );
          });
      data.set([...(inside ? fill : background), 255], (y * width + x) * 4);
    }
  return { data, width, height };
}
test("区域检测补回亮度接近的彩色屏幕，仍保留透视四角", () => {
  const { data, width, height } = sample([50, 180, 255], [150, 150, 150]);
  assert.equal(detectEdges(data, width, height).status, "not_found");
  const result = detectSlide(data, width, height);
  assert.equal(result.status, "suggested");
  assert.equal(result.source, "region");
  result.corners.forEach((p, k) =>
    assert.ok(Math.hypot(p.x - quad[k].x, p.y - quad[k].y) < 0.025),
  );
});
test("区域补充不把圆形亮物体拟造成四角", () => {
  const { data, width, height } = sample([240, 240, 240], [25, 25, 25], true);
  assert.deepEqual(regionCandidates(data, width, height), []);
  assert.equal(detectSlide(data, width, height).status, "not_found");
});
test("清晰边缘与区域一致时使用原边缘精度，不平均移动四角", () => {
  const { data, width, height } = sample([240, 240, 240], [25, 25, 25]);
  const old = detectEdges(data, width, height),
    now = detectSlide(data, width, height);
  assert.equal(now.source, "agreement");
  assert.deepEqual(now.corners, old.corners);
});

test("区域可见长边可恢复被前景遮挡的下角，不直接把遮挡边当成屏幕角", () => {
  const { data, width, height } = sample([235, 235, 235], [30, 30, 30]);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      if (Math.hypot(x - width * 0.22, y - height * 0.8) < 20) {
        const i = (y * width + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = 30;
      }
    }
  const candidates = regionCandidates(data, width, height);
  assert.ok(candidates.length > 0);
  candidates[0].corners.forEach((p, k) =>
    assert.ok(Math.hypot(p.x - quad[k].x, p.y - quad[k].y) < 0.035),
  );
});
