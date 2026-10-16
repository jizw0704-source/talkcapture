import type { Photo } from "./types.ts";
import { validateCorners } from "./geometry.ts";
export function collectReviewIssues(
  photos: Photo[],
  automatic: { photoId: string; reason: string }[] = [],
) {
  return photos
    .filter((p) => !p.excluded)
    .flatMap((p) => {
      const reasons: string[] = [];
      if (!p.file) reasons.push("原图缺失，请补传原图");
      else {
        if (p.previewError) reasons.push("预览失败，点击重试");
        if (validateCorners(p.corners))
          reasons.push("四角无效或不完整，请重新核对");
        if (!p.processed) {
          if (p.sourceNeedsReview) reasons.push("补传原图需核对");
          if (p.learnedSuggestion) reasons.push("经验选区需确认");
          if (p.boundaryNeedsReview) reasons.push("边界建议需确认");
        }
      }
      if (!p.processed || !p.file || validateCorners(p.corners))
        for (const issue of automatic.filter((i) => i.photoId === p.id))
          reasons.push(issue.reason);
      return reasons.length
        ? [{ photoId: p.id, reasons: [...new Set(reasons)] }]
        : [];
    });
}
