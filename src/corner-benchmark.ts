import { readProject } from "./storage";
import { processImage } from "./processor";
import { validateCorners, type Point } from "./geometry";
import type { SlideDetection } from "./detection";
const $ = (id: string) => document.getElementById(id)!;
type Metrics = {
  status: string;
  meanCornerError: number | null;
  overlap: number | null;
  source?: string;
};
function measure(
  result: SlideDetection,
  reference: Point[],
  width: number,
  height: number,
): Metrics {
  if (result.status !== "suggested")
    return { status: result.status, meanCornerError: null, overlap: null };
  const diagonal = Math.hypot(width, height);
  const meanCornerError =
    result.corners.reduce(
      (sum, p, k) =>
        sum +
        Math.hypot(
          (p.x - reference[k].x) * width,
          (p.y - reference[k].y) * height,
        ) /
          diagonal,
      0,
    ) / 4;
  const contains = (p: Point[], x: number, y: number) =>
    p.every((a, k) => {
      const b = p[(k + 1) % 4];
      return (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x) >= 0;
    });
  let intersection = 0,
    union = 0;
  for (let y = 0; y < 120; y++)
    for (let x = 0; x < 160; x++) {
      const a = contains(reference, (x + 0.5) / 160, (y + 0.5) / 120),
        b = contains(result.corners, (x + 0.5) / 160, (y + 0.5) / 120);
      if (a && b) intersection++;
      if (a || b) union++;
    }
  return {
    status: result.status,
    meanCornerError,
    overlap: union ? intersection / union : 0,
    source: result.source,
  };
}
const button = $("run") as HTMLButtonElement,
  download = $("download") as HTMLButtonElement;
let report: unknown;
button.onclick = async () => {
  button.disabled = true;
  download.disabled = true;
  $("results").replaceChildren();
  $("summary").textContent = "";
  try {
    const saved = await readProject();
    const before = JSON.stringify(
      saved?.photos.map(({ file, thumb, result, ...p }) => p),
    );
    const eligible =
      saved?.photos.filter(
        (p) =>
          p.processed && !p.excluded && p.file && !validateCorners(p.corners),
      ) ?? [];
    const rows = [];
    for (const [index, p] of eligible.entries()) {
      $("status").textContent = `正在对比 ${index + 1} / ${eligible.length}`;
      try {
        const r = await processImage({
          kind: "compare",
          blob: p.file!,
          rotation: p.rotation,
          corners: [],
          maxEdge: 640,
          brightness: 0,
          contrast: 0,
          examples: [],
        });
        const pair = r.comparison!;
        const old = measure(
            pair.old,
            p.corners,
            r.sourceWidth!,
            r.sourceHeight!,
          ),
          current = measure(
            pair.current,
            p.corners,
            r.sourceWidth!,
            r.sourceHeight!,
          ),
          region = measure(
            pair.region,
            p.corners,
            r.sourceWidth!,
            r.sourceHeight!,
          );
        rows.push({
          page: saved!.photos.indexOf(p) + 1,
          id: p.id,
          old,
          current,
          region,
          corners: {
            reference: p.corners,
            old: pair.old.corners,
            current: pair.current.corners,
            region: pair.region.corners,
          },
          oldMs: pair.oldMs,
          currentMs: pair.currentMs,
        });
        const section = document.createElement("article"),
          title = document.createElement("h2");
        title.textContent = `第 ${saved!.photos.indexOf(p) + 1} 页`;
        section.append(title);
        const views = document.createElement("div");
        views.className = "views";
        const image = await createImageBitmap(r.blob);
        for (const [label, detection, metrics] of [
          ["旧版", pair.old, old],
          ["新版", pair.current, current],
          ["区域候选（诊断）", pair.region, region],
        ] as const) {
          const figure = document.createElement("figure"),
            canvas = document.createElement("canvas"),
            caption = document.createElement("figcaption");
          canvas.width = image.width * 2;
          canvas.height = image.height * 2;
          const ctx = canvas.getContext("2d")!;
          ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
          for (const [points, color, dashed] of [
            [p.corners, "#ffffff", true],
            [detection.corners, "#ffcc00", false],
          ] as const) {
            if (points.length !== 4) continue;
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.setLineDash(dashed ? [6, 4] : []);
            ctx.beginPath();
            points.forEach((v, k) =>
              k
                ? ctx.lineTo(
                    v.x * (canvas.width - 1),
                    v.y * (canvas.height - 1),
                  )
                : ctx.moveTo(
                    v.x * (canvas.width - 1),
                    v.y * (canvas.height - 1),
                  ),
            );
            ctx.closePath();
            ctx.stroke();
          }
          caption.textContent = `${label}：${metrics.status === "suggested" ? `平均角点偏差 ${(metrics.meanCornerError! * 100).toFixed(2)}% · 选区重合 ${(metrics.overlap! * 100).toFixed(1)}%` : metrics.status === "ambiguous" ? "需要人工检查" : "未定位"}（白虚线为已确认选区，黄实线为建议）`;
          figure.append(canvas, caption);
          views.append(figure);
        }
        image.close();
        section.append(views);
        $("results").append(section);
      } catch (error) {
        rows.push({
          page: saved!.photos.indexOf(p) + 1,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    const after = await readProject();
    const preserved =
      before ===
      JSON.stringify(after?.photos.map(({ file, thumb, result, ...p }) => p));
    const pairs = rows.filter(
      (r): r is Extract<typeof r, { old: Metrics }> => "old" in r,
    );
    const good = (side: "old" | "current") =>
      pairs.filter(
        (r) =>
          r[side].overlap !== null &&
          r[side].overlap! >= 0.9 &&
          r[side].meanCornerError! <= 0.02,
      ).length;
    const average = (side: "old" | "current") => {
      const values = pairs.flatMap((r) =>
        r[side].meanCornerError === null ? [] : [r[side].meanCornerError!],
      );
      return values.length
        ? values.reduce((a, b) => a + b, 0) / values.length
        : null;
    };
    const summary = {
      total: eligible.length,
      completed: pairs.length,
      oldGood: good("old"),
      currentGood: good("current"),
      oldMeanError: average("old"),
      currentMeanError: average("current"),
      preserved,
      criteria:
        "IoU >= 0.90 AND mean corner distance <= 2% of image diagonal; reference = user-confirmed selection",
      oldSuggested: pairs.filter((r) => r.old.status === "suggested").length,
      currentSuggested: pairs.filter((r) => r.current.status === "suggested")
        .length,
    };
    report = { version: 1, summary, rows };
    $("summary").textContent =
      `共 ${eligible.length} 页，完成 ${pairs.length} 页。达到对照标准：旧版 ${summary.oldGood} 页，新版 ${summary.currentGood} 页。${preserved ? "已确认选区及项目参数保持不变。" : "项目记录在对比期间有变化，请检查是否在其他页面编辑。"}标准：选区重合≥90%，且平均角点偏差≤照片对角线2%。`;
    $("status").textContent = eligible.length
      ? "对比完成；这是当前批次的对照结果，不代表通用准确率。"
      : "没有同时具备原图和有效确认选区的页面。";
    download.disabled = false;
  } catch (error) {
    $("status").textContent =
      error instanceof Error ? error.message : String(error);
  } finally {
    button.disabled = false;
  }
};
download.onclick = () => {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "talkcapture-corner-comparison.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
