import type { Photo } from "./types.ts";
export function tokens(text: string): Set<string> {
  const words =
    text.toLowerCase().match(/[a-z]{3,}|[\u4e00-\u9fff]{2,}/g) || [];
  return new Set(
    words.flatMap((w) =>
      /[\u4e00-\u9fff]/.test(w)
        ? Array.from({ length: w.length - 1 }, (_, i) => w.slice(i, i + 2))
        : [w],
    ),
  );
}
export function similarity(a: string, b: string) {
  const x = tokens(a),
    y = tokens(b);
  return x.size && y.size
    ? [...x].filter((t) => y.has(t)).length / Math.min(x.size, y.size)
    : 0;
}
export function titleOf(photo: Photo) {
  return (
    photo.reading?.text
      .split("\n")
      .map((s) => s.trim())
      .find((s) => s.length >= 4 && s.length <= 100 && !/^\d+$/.test(s)) ||
    photo.name.replace(/\.[^.]+$/, "")
  );
}
export function suggestGroups(photos: Photo[]) {
  let id = "",
    prior: Photo | undefined;
  return photos.map((photo, i) => {
    const text = photo.reading?.text || "";
    const cover =
      /(报告人|主讲人|演讲者|汇报人|presented by|speaker\s*:)/i.test(text);
    const speaker = (value: string) =>
      value
        .match(
          /(?:报告人|主讲人|演讲者|汇报人|presented by|speaker)\s*[:：]\s*([^\n；;，,]{2,40})/i,
        )?.[1]
        ?.trim();
    const newSpeaker = speaker(text);
    const oldSpeaker = speaker(prior?.reading?.text || "");
    const speakerChanged =
      !!newSpeaker && !!oldSpeaker && newSpeaker !== oldSpeaker;
    const gap =
      prior?.captured && photo.captured ? photo.captured - prior.captured : 0;
    const different = prior
      ? similarity(prior.reading?.text || "", text) < 0.12
      : false;
    // Conservative suggestions only; never use missing OCR or time alone as a topic boundary.
    const start =
      i === 0 ||
      (text.length > 20 &&
        (speakerChanged || (different && (cover || gap > 25 * 60 * 1000))));
    if (start) id = photo.id;
    prior = photo;
    return {
      photo,
      reportId: id,
      start,
      reason:
        i === 0
          ? "起始页"
          : start
            ? cover
              ? "发现新的报告人信息，主题变化，待核对"
              : "拍摄间隔较长且主题变化，待核对"
            : "沿用前一报告；请核对边界",
    };
  });
}
export function reportMarkdown(title: string, photos: Photo[], all: Photo[]) {
  const page = (p: Photo) => all.indexOf(p) + 1;
  const clean = (s: string) => s.replace(/[\r\n]+/g, " ").replace(/[<>]/g, "");
  const lines = photos.flatMap((p) =>
    (p.reading?.text || "")
      .split("\n")
      .map((t) => t.trim())
      .filter((t) => t.length >= 8)
      .slice(0, 3)
      .map((t) => `- ${clean(t)}（来源：第 ${page(p)} 页）`),
  );
  return `# ${clean(title)}\n\n> 本地 OCR 摘录总结，未经生成式模型解读；请对照原图核验，不能仅凭识别文字推断图表数值。\n\n## 报告概览\n\n共 ${photos.length} 页。主题线索：${photos
    .slice(0, 5)
    .map((p) => clean(titleOf(p)))
    .join(
      "；",
    )}。\n\n## 主要内容摘录\n\n${lines.join("\n") || "未识别到足够文字，请重新识别或补充逐页文字。"}\n\n## 待核实与局限\n\n- 分组为自动建议，请核对报告边界。\n- OCR 可能误读公式、专业术语和图表；摘录不代表作者的完整结论。\n- 演讲者口头内容、未拍摄页面不在本次资料中。\n\n## 逐页内容与来源\n\n${photos.map((p) => `### 第 ${page(p)} 页 · ${clean(p.name)}\n\n${(p.reading?.text || "[未识别，请补充]").replace(/^#/gm, "\\#")}\n`).join("\n")}\n`;
}
