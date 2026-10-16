import type { Photo } from "./types.ts";
// Review state is independent of local-cache state and export readiness.
export function photoStatus(p: Photo) {
  if (p.excluded) return "已排除 · 原图保留";
  if (!p.file) return "需处理 · 原图缺失，请重新选择原图";
  if (p.previewError) return "需处理 · 预览失败，可重试";
  if (p.automated) return "待核对 · 自动校正";
  if (p.processed) return "已确认";
  if (p.sourceNeedsReview) return "待核对 · 补传原图";
  if (p.learnedSuggestion) return "待核对 · 本机经验选区";
  if (p.boundaryNeedsReview || p.detection === "suggested")
    return "待核对 · 自动定位";
  if (p.detection) return "待核对 · 需手动选四角";
  return "待核对";
}
