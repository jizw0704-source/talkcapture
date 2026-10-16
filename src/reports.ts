import type { Photo } from "./types.ts";
import {
  groupingEvidence,
  sameInstitution,
  layoutDistance,
} from "./grouping-evidence.ts";
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
// OCR often drops punctuation or puts a presenter's name on the next line.
// Only accept a label at the start of a line, not a mention inside body prose.
export function presenter(text: string) {
  const lines = text
    .normalize("NFKC")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const label =
    /^(?:报告人|报告者|主讲人|主讲|演讲者|演讲人|汇报人|汇报者|讲者|presented\s+by|presenter|speaker|reporter)\s*(?:[:：﹕]\s*|\s+|$)/i;
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(label);
    if (!match) continue;
    const name = (lines[i].slice(match[0].length).trim() || lines[i + 1] || "")
      .split(/[；;，,|｜]/)[0]
      .trim();
    // Unpunctuated English headings such as "Speaker recognition" are body
    // topics, not a reliable presenter label. Keep those attached to the report.
    if (
      /^[a-z]/i.test(match[0]) &&
      !/[:：﹕]/.test(match[0]) &&
      /^[a-z]/.test(name)
    )
      continue;
    if (
      name.length >= 2 &&
      name.length <= 40 &&
      !label.test(name) &&
      !/^https?:|@|\d+$/i.test(name)
    )
      return name;
  }
  return "";
}
const presenterKey = (name: string) =>
  name.toLowerCase().replace(/[\s.·•]/g, "");
export function titleOf(photo: Photo) {
  return (
    photo.reading?.text
      .split("\n")
      .map((s) => s.trim())
      .find(
        (s) =>
          s.length >= 4 &&
          s.length <= 100 &&
          !/^\d+$/.test(s) &&
          !presenter(s) &&
          !/^(报告人|主讲人|演讲者|汇报人|presented by|speaker)\s*[:：]/i.test(
            s,
          ),
      ) || photo.name.replace(/\.[^.]+$/, "")
  );
}
export function suggestGroups(photos: Photo[]) {
  let id = "",
    prior: Photo | undefined,
    lastSpeaker = "";
  let lastInstitutions: string[] = [];
  return photos.map((photo, i) => {
    const text = photo.reading?.text || "";
    const evidence = groupingEvidence(photo);
    const priorEvidence = prior ? groupingEvidence(prior) : undefined;
    const sameBrand = evidence.institutions.some((a) =>
      lastInstitutions.some((b) => sameInstitution(a, b)),
    );
    const brandChanged =
      evidence.institutions.length > 0 &&
      lastInstitutions.length > 0 &&
      !sameBrand;
    const styleChanged =
      layoutDistance(prior?.reading?.template, photo.reading?.template) > 0.16;
    const newSpeaker = presenter(text);
    const cover = Boolean(newSpeaker);
    const oldSpeaker = lastSpeaker;
    if (newSpeaker) lastSpeaker = newSpeaker;
    const speakerChanged =
      !!newSpeaker &&
      !!oldSpeaker &&
      presenterKey(newSpeaker) !== presenterKey(oldSpeaker);
    const gap =
      prior?.captured && photo.captured ? photo.captured - prior.captured : 0;
    const different = prior
      ? similarity(priorEvidence?.content || "", evidence.content) < 0.12
      : false;
    // Conservative suggestions only; never use missing OCR or time alone as a topic boundary.
    const start =
      i === 0 ||
      speakerChanged ||
      brandChanged ||
      (evidence.cover && !sameBrand && (different || styleChanged)) ||
      (styleChanged &&
        different &&
        evidence.institutions.length > 0 &&
        !sameBrand) ||
      (cover && !oldSpeaker && text.length > 20 && different) ||
      (!newSpeaker && text.length > 20 && different && gap > 25 * 60 * 1000);
    if (start) {
      id = photo.id;
      lastSpeaker = newSpeaker;
      lastInstitutions = evidence.institutions;
    } else if (evidence.institutions.length) {
      lastInstitutions = [
        ...new Set([...lastInstitutions, ...evidence.institutions]),
      ].slice(-12);
    }
    prior = photo;
    return {
      photo,
      reportId: id,
      start,
      reason:
        i === 0
          ? "起始页"
          : start
            ? speakerChanged
              ? "发现报告人变化，待核对"
              : brandChanged
                ? "页眉或页脚机构标识变化，待核对"
                : evidence.cover
                  ? "发现新报告封面，待核对"
                  : styleChanged
                    ? "版式与内容线索变化，待核对"
                    : "报告信息或拍摄间隔与主题变化，待核对"
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

export function speakerOf(photos: Photo[]) {
  return (
    photos.map((p) => presenter(p.reading?.text || "")).find(Boolean) || ""
  );
}
export function groupName(photos: Photo[]) {
  const title = photos.map(titleOf).find(Boolean) || "未命名报告";
  const speaker = speakerOf(photos);
  const captured = photos.find((p) => p.captured)?.captured;
  const date = captured ? new Date(captured) : undefined;
  const stamp =
    date && !Number.isNaN(date.getTime())
      ? [
          date.getFullYear(),
          String(date.getMonth() + 1).padStart(2, "0"),
          String(date.getDate()).padStart(2, "0"),
        ].join("-")
      : "";
  return [speaker, title, stamp].filter(Boolean).join("_").slice(0, 100);
}
export function reportGroups(photos: Photo[]) {
  const groups = new Map<string, Photo[]>();
  for (const p of photos.filter((p) => !p.excluded)) {
    const id = p.reportId || "unassigned";
    groups.set(id, [...(groups.get(id) || []), p]);
  }
  return [...groups].map(([id, pages]) => ({
    id,
    pages,
    title:
      pages[0].reportTitle ||
      (id === "unassigned" ? "待分组" : groupName(pages)),
  }));
}
export function reportSourceMarkdown(
  title: string,
  photos: Photo[],
  all: Photo[],
) {
  const clean = (s: string) => s.replace(/[\r\n]+/g, " ").replace(/[<>]/g, "");
  const speaker = speakerOf(photos);
  return `# ${clean(title)}\n\n> 原文资料 · 本地 OCR 识别，可人工修正。未添加 AI 分析或结论。\n\n- 页数：${photos.length}\n- 报告人：${speaker ? clean(speaker) : "未识别，请核对"}\n- 来源页号对应本次照片项目的原始页序。\n- 图表、公式、图片及识别疑点请结合对应 PPT/PDF 和原图核验；Markdown 不包含未拍摄的页面或口头讲述。\n\n## 逐页原文与来源\n\n${photos.map((p, i) => `### 报告第 ${i + 1} 页 · 来源：第 ${all.indexOf(p) + 1} 页\n\n- 原图文件：${clean(p.name)}\n${p.readingError ? "- 识别提示：" + clean(p.readingError) + "\n" : ""}\n${(p.reading?.text || "[未识别，请补充]").replace(/^#/gm, "\\#")}\n`).join("\n")}`;
}
