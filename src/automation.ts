import { validateCorners, type Point } from "./geometry.ts";
import type { SlideDetection } from "./detection.ts";
import type { Photo } from "./types.ts";

export type AutomaticIssue = { photoId: string; reason: string };

// Run only after the user explicitly selects batch automation. A geometric
// suggestion is usable here, but is never presented as a human confirmation.
export async function organizeAutomatically<T>(
  photos: Photo[],
  options: {
    signal: AbortSignal;
    detect: (photo: Photo) => Promise<SlideDetection>;
    prepare: (photo: Photo, corners: Point[]) => Promise<T>;
    commit: (photo: Photo, result: T) => void;
    progress: (done: number, total: number, label: string) => void;
    changed: () => void;
  },
): Promise<AutomaticIssue[]> {
  const included = photos.filter((photo) => !photo.excluded);
  const issues: AutomaticIssue[] = [];
  const check = () => {
    if (options.signal.aborted) throw Error("自动整理已取消。");
  };
  for (let i = 0; i < included.length; i++) {
    check();
    const photo = included[i];
    options.progress(
      i,
      included.length,
      `自动整理第 ${i + 1} / ${included.length} 页`,
    );
    try {
      if (!photo.file) throw Error("缺少原图，请重新导入或排除此页。");
      if (photo.sourceNeedsReview && !photo.processed)
        throw Error(
          "补传原图的内容未能与旧文件核验，请人工核对并确认已有选区。",
        );
      if (photo.learnedSuggestion && !photo.processed)
        throw Error("本地经验选区需要人工核对并确认。");
      let corners = photo.corners.map((point) => ({ ...point }));
      if (photo.processed) {
        const error = validateCorners(corners);
        if (error) throw Error(error);
        continue;
      }
      let detection: SlideDetection | undefined;
      // Existing manual edits and saved suggestions take precedence. Never
      // replace incomplete or invalid manual points with a different rectangle.
      if (!corners.length) {
        detection = await options.detect(photo);
        check();
        if (detection.status !== "suggested") {
          photo.detection = detection.status;
          options.changed();
          throw Error(
            detection.status === "ambiguous"
              ? "发现多个候选画面，请选择要保留的四角。"
              : "未找到完整 PPT 边界，请手动选四角。",
          );
        }
        if (detection.source === "local-correction") {
          photo.corners = detection.corners.map((p) => ({ ...p }));
          photo.detection = detection.status;
          photo.learnedSuggestion = true;
          options.changed();
          throw Error("已找到本地经验选区，请人工核对并确认。");
        }
        corners = detection.corners.map((point) => ({ ...point }));
      }
      const error = validateCorners(corners);
      if (error) throw Error(`请检查四角：${error}`);
      check();
      const result = await options.prepare(photo, corners);
      check();
      options.commit(photo, result);
      photo.corners = corners;
      if (detection) photo.detection = detection.status;
      photo.processed = true;
      photo.automated = true;
      options.changed();
    } catch (error) {
      check();
      issues.push({ photoId: photo.id, reason: (error as Error).message });
    }
  }
  check();
  options.progress(included.length, included.length, "自动整理完成");
  return issues;
}
