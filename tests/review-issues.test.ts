import { test } from "node:test";
import assert from "node:assert/strict";
import { collectReviewIssues } from "../src/review-issues.ts";
import type { Photo } from "../src/types.ts";
const p = () =>
  ({
    id: "a",
    file: {} as File,
    processed: true,
    excluded: false,
    corners: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ],
  }) as Photo;
test("统一问题按页去重并保留自动失败原因，不把已排除页列为阻碍", () => {
  const a = {
    ...p(),
    processed: false,
    previewError: "failed",
    sourceNeedsReview: true,
  };
  const before = structuredClone(a);
  const result = collectReviewIssues(
    [a, { ...a, id: "excluded", excluded: true }],
    [{ photoId: "a", reason: "定位失败" }],
  );
  assert.equal(result.length, 1);
  assert.ok(result[0].reasons.length >= 3);
  assert.deepEqual(a, before);
  assert.equal(
    collectReviewIssues([p()], [{ photoId: "a", reason: "旧失败" }]).length,
    0,
  );
  assert.match(
    collectReviewIssues([{ ...p(), file: undefined }])[0].reasons.join(" "),
    /补传原图/,
  );
});
