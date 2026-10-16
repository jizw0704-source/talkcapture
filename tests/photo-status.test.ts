import { test } from "node:test";
import assert from "node:assert/strict";
import { photoStatus } from "../src/photo-status.ts";
import type { Photo } from "../src/types.ts";
test("自动校正不冒充人工已确认，原图和预览异常显示需处理", () => {
  const p = { file: {} as File, processed: true, automated: true } as Photo;
  assert.equal(photoStatus(p), "待核对 · 自动校正");
  assert.equal(photoStatus({ ...p, automated: false }), "已确认");
  assert.match(photoStatus({ ...p, file: undefined }), /^需处理/);
  assert.match(photoStatus({ ...p, previewError: "failed" }), /^需处理/);
  assert.match(photoStatus({ ...p, excluded: true }), /^已排除/);
  assert.equal(
    photoStatus({ ...p, processed: false, automated: false }),
    "待核对",
  );
});
