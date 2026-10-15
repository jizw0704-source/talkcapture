export type SourcePage = { page: number; text: string };
export type Evidence = { id: string; page: number; text: string };
const headings = ["概览", "核心观点", "证据与方法", "局限"] as const;
const escape = (text: string) =>
  text.replace(/[\\`*_[\]<>#]/g, "\\$&").replace(/\r?\n/g, " ");
export function buildEvidence(pages: SourcePage[]): Evidence[] {
  const result: Evidence[] = [];
  for (const page of pages) {
    for (const text of page.text
      .split(/\n+|(?<=[。！？])\s*|(?<=[!?])\s+/u)
      .map((s) => s.trim())
      .filter(Boolean)) {
      result.push({ id: `E${result.length + 1}`, page: page.page, text });
    }
  }
  return result;
}
export function groundedMarkdown(raw: string, evidence: Evidence[]) {
  let data: unknown;
  try {
    data = JSON.parse(
      raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""),
    );
  } catch {
    throw Error("MiniMax 未返回可校验的来源格式，请重新解读。");
  }
  const record = data as { sections?: unknown; questions?: unknown };
  if (!record || !Array.isArray(record.sections))
    throw Error("总结缺少结构化来源，未生成引用，请重新解读。");
  const lookup = new Map(evidence.map((e) => [e.id, e]));
  const used = new Map<string, Evidence>();
  let hidden = 0,
    accepted = 0;
  const sections = headings.map((heading) => {
    const lines: string[] = [];
    for (const candidate of record.sections as unknown[]) {
      const section = candidate as { title?: unknown; items?: unknown };
      if (section?.title !== heading || !Array.isArray(section.items)) continue;
      for (const item of section.items) {
        const value = item as {
          evidenceIds?: unknown;
          interpretation?: unknown;
        };
        if (
          !Array.isArray(value?.evidenceIds) ||
          !value.evidenceIds.length ||
          value.evidenceIds.length > 8 ||
          value.evidenceIds.some(
            (id) => typeof id !== "string" || !lookup.has(id),
          )
        ) {
          hidden++;
          continue;
        }
        const sources = [...new Set(value.evidenceIds as string[])].map(
          (id) => lookup.get(id)!,
        );
        accepted++;
        for (const source of sources) {
          used.set(source.id, source);
          lines.push(
            `- 原文：${escape(source.text)} [第${source.page}页 · ${source.id}](#source-${source.id.toLowerCase()})`,
          );
        }
        if (
          typeof value.interpretation === "string" &&
          value.interpretation.trim()
        ) {
          // Model prose is never presented as a source-verified factual statement.
          const text = value.interpretation
            .replace(/\[[^\]]*\]/g, "")
            .trim()
            .slice(0, 1200);
          if (text) lines.push(`  - AI 解读（推断，待核实）：${escape(text)}`);
        }
      }
    }
    return `## ${heading}\n\n${lines.join("\n") || "未提取到可核对的原文依据。"}`;
  });
  if (!accepted)
    throw Error("总结没有可匹配的原文依据，未输出可能错误的引用，请重新解读。");
  const questions = Array.isArray(record.questions)
    ? record.questions
        .filter((q): q is string => typeof q === "string")
        .slice(0, 8)
        .map((q) => `- ${escape(q.replace(/\[[^\]]*\]/g, "").slice(0, 500))}`)
    : [];
  const text = `> 引用页码由程序按输入页面生成，链接指向本文件中的原文片段。原文是 OCR 识别结果，仍需核对照片；AI 解读与问题均为待核实推断，不代表已被原文证明。${hidden ? ` ${hidden} 条内容未通过来源检查，已隐藏。` : ""}\n\n${sections.join("\n\n")}\n\n## 待核实问题（AI 建议）\n\n${questions.join("\n") || "暂无。"}\n\n## 原文依据\n\n${[...used.values()].map((e) => `<a id="source-${e.id.toLowerCase()}"></a>\n\n### 第${e.page}页 · ${e.id}\n\n> ${escape(e.text)}`).join("\n\n")}`;
  return { text, citations: [...used.values()], hiddenItems: hidden };
}
