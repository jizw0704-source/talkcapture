import { test } from "node:test";
import assert from "node:assert/strict";
import {
  setReportName,
  suggestReportNameForGroup,
} from "../src/report-name.ts";
import type { Photo } from "../src/types.ts";
test("不同入口只改同一组的名称，排除页的组名同步，选区页序分组不变", () => {
  const photos = [
    {
      id: "a",
      reportId: "g",
      reportTitle: "旧名称",
      corners: [{ x: 2, y: 3 }],
      processed: true,
    },
    { id: "b", reportId: "other", reportTitle: "另一组" },
    { id: "c", reportId: "g", excluded: true, reportTitle: "旧名称" },
  ] as Photo[];
  const original = structuredClone(photos);
  assert.equal(setReportName(photos, "g", " 新名称 "), "新名称");
  assert.equal(photos[2].reportTitle, "新名称");
  assert.equal(photos[1].reportTitle, "另一组");
  assert.deepEqual(
    photos.map(({ reportTitle, ...p }) => p),
    original.map(({ reportTitle, ...p }) => p),
  );
  setReportName(photos, "g", "");
  assert.equal(photos[0].reportTitle, "新名称");
  assert.ok(suggestReportNameForGroup(photos, "g"));
});

test("未分组集合改名也只写名称，不替它分配报告 ID", () => {
  const photos = [
    { id: "a", name: "a.jpg" },
    { id: "b", name: "b.jpg", reportId: "kept", reportTitle: "保留" },
  ] as Photo[];
  setReportName(photos, "unassigned", "待归类资料");
  assert.equal(photos[0].reportTitle, "待归类资料");
  assert.equal(photos[0].reportId, undefined);
  assert.equal(photos[1].reportTitle, "保留");
});
