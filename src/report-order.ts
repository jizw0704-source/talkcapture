import type { Photo } from "./types.ts";
// Report order never changes the project array or source-page numbering.
export function orderedReport(pages: Photo[]) {
  return pages
    .map((p, index) => ({ p, index }))
    .sort(
      (a, b) =>
        (a.p.reportOrder ?? a.index) - (b.p.reportOrder ?? b.index) ||
        a.index - b.index,
    )
    .map(({ p }) => p);
}
export function reviewSignature(pages: Photo[]) {
  return JSON.stringify(
    orderedReport(pages).map((p) => [p.id, p.reportId || "unassigned"]),
  );
}
export function isReportReviewed(pages: Photo[]) {
  const signature = reviewSignature(pages);
  return pages.length > 0 && pages.every((p) => p.reportReview === signature);
}
export function confirmReport(pages: Photo[]) {
  const signature = reviewSignature(pages);
  pages.forEach((p) => (p.reportReview = signature));
}
export function applyReportOrder(pages: Photo[], ids: string[]) {
  if (
    ids.length !== pages.length ||
    new Set(ids).size !== pages.length ||
    ids.some((id) => !pages.some((p) => p.id === id))
  )
    return false;
  ids.forEach((id, index) => {
    const p = pages.find((p) => p.id === id)!;
    p.reportOrder = index;
    p.reportReview = undefined;
  });
  return true;
}
export function orderWarning(pages: Photo[]) {
  const text = orderedReport(pages)[0]?.reading?.text || "";
  return pages.length > 1 &&
    /^(?:THANK\s*(?:YOU|S)\b|谢谢|感谢聆听|谢谢聆听|致谢)/im.test(text)
    ? "首张可能是结束页，请核对顺序；不会自动重排。"
    : chapterDescending(pages)
      ? "章节编号可能倒排，请核对顺序；不会自动重排。"
      : "";
}
function chapterDescending(pages: Photo[]) {
  const values = orderedReport(pages)
    .map((p) => {
      const m = p.reading?.text
        .split(/\r?\n/)
        .slice(0, 3)
        .join("\n")
        .trim()
        .match(
          /^(\d{1,2})\.(\d{1,2})(?:\.(\d{1,2}))?(?=\s|[A-Za-z\u4e00-\u9fff]|$)/m,
        );
      return m
        ? Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3] || 0)
        : undefined;
    })
    .filter((n): n is number => n !== undefined);
  let down = 0,
    up = 0;
  for (let i = 1; i < values.length; i++) {
    if (values[i] < values[i - 1]) down++;
    if (values[i] > values[i - 1]) up++;
  }
  return values.length >= 3 && down >= 2 && up === 0;
}
// Invalidate a review after membership changes, including exclude/restore.
export function reconcileReportReviews(photos: Photo[]) {
  const groups = new Map<string, Photo[]>();
  for (const p of photos) {
    if (p.excluded) {
      p.reportReview = undefined;
      continue;
    }
    const id = p.reportId || "unassigned";
    groups.set(id, [...(groups.get(id) || []), p]);
  }
  for (const pages of groups.values()) {
    if (!isReportReviewed(pages))
      pages.forEach((p) => (p.reportReview = undefined));
  }
}
