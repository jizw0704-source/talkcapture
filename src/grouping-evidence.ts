import type { Photo } from "./types.ts";
export type ReadingLine = {
  text: string;
  confidence: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
};
const normalize = (s: string) =>
  s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, "");
const eventLine = (s: string) =>
  /论坛|会议|峰会|大会|conference|symposium|summit|copyright|版权所有|^\d{4}[年/.-]|^[\u4e00-\u9fff]{2,4}\s*[•·]/i.test(
    s,
  );
const institution = (s: string) => {
  if (
    eventLine(s) ||
    s.length > 55 ||
    /参考|引用|来源|文献|et al|https?:|www\./i.test(s)
  )
    return "";
  const chinese = s.match(
    /^[\u4e00-\u9fff]{2,18}?(?:有限公司|大学|研究院|研究所|实验室)/,
  )?.[0];
  if (chinese) return normalize(chinese);
  if (/^[\u4e00-\u9fff]{2,8}(?:光电|光伏|科技)$/.test(s)) return normalize(s);
  // A short upper-case wordmark in a header/footer is useful even when OCR
  // cannot recover its full legal company name. Do not treat units as brands.
  if (
    /^[A-Z][A-Z\s&-]{5,30}$/.test(s) &&
    !/^(?:AM\d|IEC|ISS|NASA|SPACE|SPECIFIC|POWER)/.test(s)
  )
    return normalize(s);
  return "";
};
export function groupingEvidence(photo: Photo) {
  const lines = (photo.reading?.text || "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const geometry = photo.reading?.lines;
  const edges = geometry?.some((l) => Number.isFinite(l.y))
    ? geometry
        .filter(
          (l) =>
            l.confidence >= 0.5 && ((l.y ?? 0.5) < 0.22 || (l.y ?? 0.5) > 0.82),
        )
        .map((l) => l.text.trim())
    : [...lines.slice(0, 5), ...lines.slice(-4)];
  let institutions = [...new Set(edges.map(institution).filter(Boolean))];
  const content = lines.filter((s) => !eventLine(s));
  const coverInstitutions = [
    ...new Set(content.map(institution).filter(Boolean)),
  ];
  const name = content.find(
    (s) =>
      /^[\u4e00-\u9fff]{2,4}$/.test(s) &&
      !institution(s) &&
      !/^(光伏|行研|中国|美国|江苏|苏州|第二届|谢谢|目录|背景|总结|结论|前言|展望|方法|结果|讨论)$/.test(
        s,
      ),
  );
  const title = content.find(
    (s) =>
      s.length >= 10 &&
      s.length <= 70 &&
      !institution(s) &&
      !/^(报告人|主讲|汇报|speaker|present)/i.test(s),
  );
  const cover = Boolean(
    title && coverInstitutions.length && name && content.length <= 12,
  );
  if (cover)
    institutions = [...new Set([...institutions, ...coverInstitutions])];
  return { institutions, cover, content: content.join("\n") };
}
export function sameInstitution(a: string, b: string) {
  if (
    a === b ||
    (Math.min(a.length, b.length) >= 5 && (a.includes(b) || b.includes(a)))
  )
    return true;
  // A single different character can name a different institution. OCR
  // variants need another matching wordmark; edit distance alone is unsafe.
  return false;
}
export function layoutDistance(a?: number[], b?: number[]) {
  if (
    !a?.length ||
    a.length !== b?.length ||
    !a.every(Number.isFinite) ||
    !b.every(Number.isFinite)
  )
    return 0;
  return a.reduce((sum, n, i) => sum + Math.abs(n - b[i]), 0) / a.length / 255;
}
// Only the outer template bands, not the central charts and photos, are sampled.
// Quantiles make the signature less sensitive to individual text strokes.
export function templateSignature(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
) {
  const signature: number[] = [];
  for (const [x0, y0, x1, y1] of [
    [0, 0, 1, 0.12],
    [0, 0.88, 1, 1],
    [0, 0.12, 0.04, 0.88],
    [0.96, 0.12, 1, 0.88],
  ]) {
    for (let channel = 0; channel < 3; channel++) {
      const values: number[] = [];
      for (let y = Math.floor(y0 * height); y < Math.floor(y1 * height); y++)
        for (let x = Math.floor(x0 * width); x < Math.floor(x1 * width); x++)
          values.push(rgba[(y * width + x) * 4 + channel]);
      values.sort((a, b) => a - b);
      signature.push(values[Math.floor(values.length * 0.7)] ?? 255);
    }
  }
  return signature;
}
export async function readTemplate(blob: Blob) {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 96;
    canvas.height = 64;
    const context = canvas.getContext("2d", { willReadFrequently: true })!;
    context.drawImage(bitmap, 0, 0, 96, 64);
    return templateSignature(context.getImageData(0, 0, 96, 64).data, 96, 64);
  } finally {
    bitmap.close();
  }
}
