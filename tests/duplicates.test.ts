import test from "node:test";
import assert from "node:assert/strict";
import { looksSimilar } from "../src/duplicates.ts";
const picture = {
  width: 1600,
  height: 900,
  pixels: Array.from({ length: 6144 }, (_, i) => i % 256),
};
test("轻微编码差异只给相似建议，大范围内容变化或不同比例不匹配", () => {
  assert.equal(
    looksSimilar(picture, {
      ...picture,
      pixels: picture.pixels.map((v) => Math.min(255, v + 1)),
    }),
    true,
  );
  assert.equal(
    looksSimilar(picture, {
      ...picture,
      pixels: picture.pixels.map((v) => 255 - v),
    }),
    false,
  );
  assert.equal(
    looksSimilar(picture, { ...picture, width: 900, height: 1600 }),
    false,
  );
});
test("内容局部明显变化及空白页不报告为重复", () => {
  const changed = [...picture.pixels];
  for (let i = 0; i < 300; i++) changed[i] = 255 - changed[i];
  assert.equal(looksSimilar(picture, { ...picture, pixels: changed }), false);
  assert.equal(
    looksSimilar(
      { ...picture, pixels: Array(6144).fill(255) },
      { ...picture, pixels: Array(6144).fill(255) },
    ),
    false,
  );
});
