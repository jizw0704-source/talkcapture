import test from "node:test";
import assert from "node:assert/strict";
import { recoveryTargets, fileDigest } from "../src/recovery.ts";
import type { Photo } from "../src/types.ts";
const photo = (id: string, extra: Partial<Photo> = {}) =>
  ({
    id,
    name: "旧照片.jpg",
    size: 5,
    modified: 10,
    corners: [{ x: 0.1, y: 0.1 }],
    rotation: 90,
    selection: 7,
    ...extra,
  }) as Photo;
test("内容指纹不依赖文件名与修改时间，多个同源缺图页均可恢复", () => {
  const photos = [photo("a", { digest: "abc" }), photo("b", { digest: "abc" })];
  const result = recoveryTargets(
    photos,
    { name: "新名称.jpg", size: 5 },
    "abc",
  );
  assert.deepEqual(
    result.targets.map((p) => p.id),
    ["a", "b"],
  );
  assert.equal(result.needsReview, false);
  assert.equal(photos[0].rotation, 90);
});
test("旧记录只有唯一同名同大小时允许回退并标记核对，歧义或改内容不猜配", () => {
  assert.equal(
    recoveryTargets([photo("a")], { name: "旧照片.jpg", size: 5 }, "new")
      .needsReview,
    true,
  );
  assert.throws(
    () =>
      recoveryTargets(
        [photo("a"), photo("b")],
        { name: "旧照片.jpg", size: 5 },
        "new",
      ),
    /无法确认/,
  );
  assert.throws(
    () =>
      recoveryTargets(
        [photo("a", { digest: "old" })],
        { name: "旧照片.jpg", size: 5 },
        "new",
      ),
    /无法确认/,
  );
});
test("明确补传目标保留对象，内容有变化时要求重新确认，不替换已就绪页", () => {
  const a = photo("a", { digest: "old" });
  assert.equal(
    recoveryTargets([a], { name: "替换.jpg", size: 8 }, "new", "a").targets[0],
    a,
  );
  assert.equal(
    recoveryTargets([a], { name: "替换.jpg", size: 8 }, "new", "a").needsReview,
    true,
  );
  assert.throws(
    () =>
      recoveryTargets(
        [photo("a", { file: new File(["x"], "x") })],
        { name: "x", size: 1 },
        "x",
        "a",
      ),
    /目标已变化/,
  );
});
test("SHA-256 按文件字节匹配，不受名称时间影响", async () => {
  assert.equal(
    await fileDigest(new File(["abc"], "1.jpg", { lastModified: 1 })),
    await fileDigest(new File(["abc"], "2.jpg", { lastModified: 2 })),
  );
  assert.notEqual(
    await fileDigest(new Blob(["abc"])),
    await fileDigest(new Blob(["abd"])),
  );
});
