import test from "node:test";
import assert from "node:assert/strict";
import { organizeAutomatically } from "../src/automation.ts";
import { fullCorners } from "../src/geometry.ts";
import type { Photo } from "../src/types.ts";

function photo(id: string, values: Partial<Photo> = {}): Photo {
  return {
    id,
    name: `${id}.jpg`,
    size: 4,
    modified: 0,
    captured: null,
    selection: 0,
    format: "JPEG",
    width: 1000,
    height: 800,
    rotation: 0,
    corners: [],
    brightness: 0,
    contrast: 0,
    processed: false,
    excluded: false,
    warnings: [],
    file: new File(["test"], `${id}.jpg`),
    ...values,
  };
}
function runner(signal = new AbortController().signal) {
  const detected: string[] = [],
    prepared: string[] = [],
    committed: string[] = [];
  const options: Parameters<typeof organizeAutomatically<string>>[1] = {
    signal,
    detect: async (p) => {
      detected.push(p.id);
      return { status: "suggested", corners: fullCorners() };
    },
    prepare: async (p) => {
      prepared.push(p.id);
      return p.id;
    },
    commit: (p) => {
      committed.push(p.id);
    },
    progress: () => {},
    changed: () => {},
  };
  return {
    detected,
    prepared,
    committed,
    options,
  };
}

test("自动整理遵守当前页序、排除和已有编辑，人工确认不被重新处理", async () => {
  const manual = photo("manual", {
    corners: fullCorners(),
    rotation: 90,
    brightness: 5,
  });
  manual.corners[0] = { x: 0.12, y: 0.05 };
  const before = structuredClone(manual.corners);
  const confirmed = photo("confirmed", {
    corners: fullCorners(),
    processed: true,
  });
  const photos = [
    photo("second"),
    confirmed,
    photo("excluded", { excluded: true, file: undefined }),
    manual,
  ];
  const r = runner();
  assert.deepEqual(await organizeAutomatically(photos, r.options), []);
  assert.deepEqual(r.detected, ["second"]);
  assert.deepEqual(r.prepared, ["second", "manual"]);
  assert.deepEqual(manual.corners, before);
  assert.equal(manual.rotation, 90);
  assert.equal(manual.brightness, 5);
  assert.equal(manual.automated, true);
  assert.equal(confirmed.automated, undefined);
  assert.equal(photos[2].processed, false);
});

test("未找到、多候选和不完整手动选区集中列出，其余页继续处理", async () => {
  const photos = [
    photo("blank"),
    photo("multiple"),
    photo("partial", { corners: [{ x: 0.1, y: 0.1 }] }),
    photo("valid"),
  ];
  const r = runner();
  r.options.detect = async (p) => ({
    status:
      p.id === "blank"
        ? "not_found"
        : p.id === "multiple"
          ? "ambiguous"
          : "suggested",
    corners: p.id === "valid" ? fullCorners() : [],
  });
  const issues = await organizeAutomatically(photos, r.options);
  assert.deepEqual(
    issues.map((issue) => issue.photoId),
    ["blank", "multiple", "partial"],
  );
  assert.deepEqual(r.prepared, ["valid"]);
  assert.equal(photos[0].processed, false);
  assert.equal(photos[1].detection, "ambiguous");
  assert.equal(photos[2].corners.length, 1);
});

test("校正失败不写入新选区或完成状态，重试可继续", async () => {
  const p = photo("retry");
  const r = runner();
  const failed = {
    ...r.options,
    prepare: async () => {
      throw Error("解码失败");
    },
  };
  assert.match(
    (await organizeAutomatically([p], failed))[0].reason,
    /解码失败/,
  );
  assert.deepEqual(p.corners, []);
  assert.equal(p.processed, false);
  assert.deepEqual(r.committed, []);
  assert.deepEqual(await organizeAutomatically([p], r.options), []);
  assert.equal(p.processed, true);
});

test("处理中取消保留已完成页，不提交取消时正在处理的页面", async () => {
  const controller = new AbortController();
  const photos = [photo("done"), photo("cancelled"), photo("untouched")];
  const r = runner(controller.signal);
  r.options.prepare = async (p) => {
    if (p.id === "cancelled") controller.abort();
    return p.id;
  };
  await assert.rejects(organizeAutomatically(photos, r.options), /取消/);
  assert.equal(photos[0].processed, true);
  assert.deepEqual(photos[1].corners, []);
  assert.equal(photos[1].processed, false);
  assert.equal(photos[2].processed, false);
  assert.deepEqual(r.committed, ["done"]);
});

test("缺少原图和失效的已确认选区不会被放行", async () => {
  const photos = [
    photo("missing", {
      file: undefined,
      processed: true,
      corners: fullCorners(),
    }),
    photo("invalid", { processed: true }),
    photo("good", { processed: true, corners: fullCorners() }),
  ];
  const r = runner();
  const issues = await organizeAutomatically(photos, r.options);
  assert.deepEqual(
    issues.map((issue) => issue.photoId),
    ["missing", "invalid"],
  );
  assert.deepEqual(r.detected, []);
  assert.deepEqual(r.prepared, []);
});

test("本地纠正建议必须人工确认，不能静默自动生成", async () => {
  const p = photo("learned");
  const r = runner();
  r.options.detect = async () => ({
    status: "suggested",
    corners: fullCorners(),
    source: "local-correction",
  });
  const issues = await organizeAutomatically([p], r.options);
  assert.equal(issues.length, 1);
  assert.equal(p.learnedSuggestion, true);
  assert.equal(p.processed, false);
  assert.deepEqual(r.prepared, []);
  assert.equal((await organizeAutomatically([p], r.options)).length, 1);
});

test("局部遮挡的边界建议需确认，重试也不能跳过检查直接导出", async () => {
  const p = photo("occluded");
  const r = runner();
  r.options.detect = async () => ({
    status: "suggested",
    corners: fullCorners(),
    source: "partial-edge",
  });
  assert.equal((await organizeAutomatically([p], r.options)).length, 1);
  assert.equal(p.boundaryNeedsReview, true);
  assert.equal(p.processed, false);
  assert.deepEqual(r.prepared, []);
  assert.equal((await organizeAutomatically([p], r.options)).length, 1);
  assert.deepEqual(r.prepared, []);
});

test("区域补充建议需人工确认，不能由快速导出静默确认", async () => {
  const p = photo("region");
  const r = runner();
  r.options.detect = async () => ({
    status: "suggested",
    corners: fullCorners(),
    source: "region",
  });
  assert.equal((await organizeAutomatically([p], r.options)).length, 1);
  assert.equal(p.boundaryNeedsReview, true);
  assert.equal(p.processed, false);
  assert.deepEqual(r.prepared, []);
  assert.equal((await organizeAutomatically([p], r.options)).length, 1);
});
