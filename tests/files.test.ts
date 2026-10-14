import test from "node:test";
import assert from "node:assert/strict";
import { identify } from "../src/files.ts";

test("按内容识别格式，不相信扩展名和 MIME", async () => {
  const jpeg = new File([new Uint8Array([255, 216, 255, 0])], "wrong.txt", {
    type: "text/plain",
  });
  assert.equal((await identify(jpeg)).type, "image/jpeg");
  const png = new File(
    [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])],
    "wrong.jpg",
  );
  assert.equal((await identify(png)).type, "image/png");
});
test("普通文件和伪装扩展名被拒绝", async () => {
  await assert.rejects(
    identify(new File(["not an image"], "fake.heic")),
    /仅支持/,
  );
});
test("HEIC 容器签名可以被识别", async () => {
  const file = new File(
    [
      new Uint8Array([0, 0, 0, 24]),
      "ftypheic",
      new Uint8Array([0, 0, 0, 0]),
      "mif1",
    ],
    "photo.heic",
  );
  assert.equal((await identify(file)).type, "image/heic");
});

test("含兼容 mif1 标记的 AVIF 不冒充 HEIC", async () => {
  const file = new File(
    [
      new Uint8Array([0, 0, 0, 24]),
      "ftypavif",
      new Uint8Array([0, 0, 0, 0]),
      "mif1",
    ],
    "not-heic.heic",
  );
  await assert.rejects(identify(file), /仅支持/);
});
