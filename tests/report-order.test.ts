import { test } from "node:test";
import assert from "node:assert/strict";
import {
  orderedReport,
  applyReportOrder,
  confirmReport,
  isReportReviewed,
  orderWarning,
} from "../src/report-order.ts";
import type { Photo } from "../src/types.ts";
test("report ordering preserves project source slots and crop metadata", () => {
  const pages = [1, 2, 3].map(
    (n) =>
      ({
        id: String(n),
        reportId: "a",
        corners: [{ x: n, y: 0 }],
        processed: true,
        reading: { text: n === 1 ? "THANK YOU" : "Body" },
      }) as Photo,
  );
  const before = pages.map((p) => JSON.stringify([p.corners, p.processed]));
  assert.ok(orderWarning(pages));
  confirmReport(pages);
  assert.ok(isReportReviewed(pages));
  assert.equal(applyReportOrder(pages, ["3", "2", "1"]), true);
  assert.deepEqual(
    pages.map((p) => p.id),
    ["1", "2", "3"],
  );
  assert.deepEqual(
    orderedReport(pages).map((p) => p.id),
    ["3", "2", "1"],
  );
  assert.deepEqual(
    pages.map((p) => JSON.stringify([p.corners, p.processed])),
    before,
  );
  assert.equal(isReportReviewed(pages), false);
  confirmReport(pages);
  assert.ok(isReportReviewed(JSON.parse(JSON.stringify(pages))));
  assert.equal(isReportReviewed(pages.slice(1)), false);
  const snapshot = JSON.stringify(pages);
  assert.equal(applyReportOrder(pages, ["1", "1", "3"]), false);
  assert.equal(JSON.stringify(pages), snapshot);
});
test("order warnings require explicit closing or repeated descending chapters", () => {
  const pages = (texts: string[]) =>
    texts.map((text, i) => ({ id: String(i), reading: { text } }) as Photo);
  assert.ok(orderWarning(pages(["谢谢", "正文"])));
  assert.ok(
    orderWarning(pages(["2.2.2 Cost", "2.2成本", "2.1.2 Power", "1.1 Start"])),
  );
  assert.equal(
    orderWarning(pages(["2026 results", "2025 background", "2024 data"])),
    "",
  );
  assert.equal(
    orderWarning(pages(["1.1 Start", "1.2 Methods", "1.3 Results"])),
    "",
  );
});
