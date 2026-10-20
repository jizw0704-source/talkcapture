import JSZip from "jszip";
import type { Photo, SavedProject } from "./types.ts";
import { createZip, inspectBackupZip } from "./archive.ts";
import { fileDigest } from "./recovery.ts";
import { identify } from "./files.ts";
import { validateCorners } from "./geometry.ts";
const keys = [
  "id",
  "name",
  "size",
  "modified",
  "captured",
  "selection",
  "format",
  "width",
  "height",
  "rotation",
  "corners",
  "brightness",
  "contrast",
  "processed",
  "automated",
  "excluded",
  "warnings",
  "detection",
  "learnedSuggestion",
  "digest",
  "reading",
  "groupingReason",
  "readingError",
  "reportOrder",
  "reportReview",
  "reportId",
  "reportTitle",
  "sourceNeedsReview",
  "boundaryNeedsReview",
  "manuallyAdjusted",
] as const;
export function cleanProject(value: unknown): SavedProject {
  const p = value as SavedProject;
  if (
    !p ||
    p.version !== 1 ||
    typeof p.name !== "string" ||
    p.name.length > 200 ||
    !["wide", "standard"].includes(p.aspect) ||
    !["quality", "compact"].includes(p.quality) ||
    !Array.isArray(p.photos) ||
    !p.photos.length ||
    p.photos.length > 100
  )
    throw Error("备份项目格式不受支持。");
  const ids = new Set<string>();
  const photos = p.photos.map((raw) => {
    if (!raw || typeof raw !== "object") throw Error("备份照片参数无效。");
    const x = Object.fromEntries(
      keys.filter((k) => raw[k] !== undefined).map((k) => [k, raw[k]]),
    ) as unknown as Photo;
    if (
      typeof x.id !== "string" ||
      x.id.length > 128 ||
      !x.id ||
      ids.has(x.id) ||
      typeof x.name !== "string" ||
      !x.name ||
      x.name.length > 255 ||
      typeof x.digest !== "string" ||
      !/^[a-f0-9]{64}$/.test(x.digest)
    )
      throw Error("备份照片标识无效。");
    ids.add(x.id);
    for (const key of [
      "size",
      "modified",
      "selection",
      "width",
      "height",
      "rotation",
      "brightness",
      "contrast",
    ] as const)
      if (!Number.isFinite(x[key])) throw Error("备份照片参数无效。");
    if (
      x.size <= 0 ||
      x.size > 100 * 1024 * 1024 ||
      x.width <= 0 ||
      x.height <= 0 ||
      ![0, 90, 180, 270].includes(x.rotation) ||
      Math.abs(x.brightness) > 100 ||
      Math.abs(x.contrast) > 100 ||
      (x.captured !== null && !Number.isFinite(x.captured)) ||
      typeof x.processed !== "boolean" ||
      typeof x.excluded !== "boolean" ||
      !Array.isArray(x.corners) ||
      x.corners.length > 4 ||
      x.corners.some(
        (c) =>
          !c ||
          !Number.isFinite(c.x) ||
          !Number.isFinite(c.y) ||
          c.x < 0 ||
          c.x > 1 ||
          c.y < 0 ||
          c.y > 1,
      ) ||
      (x.processed && validateCorners(x.corners))
    )
      throw Error("备份选区或照片参数无效。");
    if (
      !Array.isArray(x.warnings) ||
      x.warnings.length > 100 ||
      x.warnings.some((w) => typeof w !== "string" || w.length > 2000)
    )
      throw Error("备份提示无效。");
    for (const key of [
      "format",
      "reportId",
      "reportTitle",
      "reportReview",
      "groupingReason",
      "readingError",
    ] as const)
      if (
        x[key] !== undefined &&
        (typeof x[key] !== "string" || x[key]!.length > 30000)
      )
        throw Error("备份文字参数无效。");
    if (
      x.reportOrder !== undefined &&
      (!Number.isSafeInteger(x.reportOrder) ||
        x.reportOrder < 0 ||
        x.reportOrder > 100)
    )
      throw Error("备份页序无效。");
    if (
      x.reading &&
      (typeof x.reading.text !== "string" ||
        x.reading.text.length > 200000 ||
        !Number.isFinite(x.reading.confidence) ||
        typeof x.reading.digest !== "string")
    )
      throw Error("备份识别文字无效。");
    for (const key of [
      "automated",
      "learnedSuggestion",
      "sourceNeedsReview",
      "boundaryNeedsReview",
      "manuallyAdjusted",
    ] as const)
      if (x[key] !== undefined && typeof x[key] !== "boolean")
        throw Error("备份照片参数无效。");
    if (x.reading) {
      const r = x.reading;
      if (r.confidence < 0 || r.confidence > 1 || r.digest.length > 10000)
        throw Error("备份识别文字无效。");
      const lines = r.lines;
      if (
        lines !== undefined &&
        (!Array.isArray(lines) ||
          lines.length > 10000 ||
          lines.some(
            (l) =>
              !l ||
              typeof l.text !== "string" ||
              l.text.length > 10000 ||
              !Number.isFinite(l.confidence) ||
              [l.x, l.y, l.width, l.height].some(
                (n) =>
                  n !== undefined && (!Number.isFinite(n) || n < 0 || n > 1),
              ),
          ))
      )
        throw Error("备份识别文字无效。");
      if (
        r.template !== undefined &&
        (!Array.isArray(r.template) ||
          r.template.length > 1000 ||
          r.template.some((n) => !Number.isFinite(n) || n < 0 || n > 255))
      )
        throw Error("备份识别文字无效。");
      x.reading = {
        text: r.text,
        confidence: r.confidence,
        digest: r.digest,
        ...(lines
          ? {
              lines: lines.map((l) => ({
                text: l.text,
                confidence: l.confidence,
                x: l.x,
                y: l.y,
                width: l.width,
                height: l.height,
              })),
            }
          : {}),
        ...(r.template ? { template: r.template } : {}),
      };
    }
    x.corners = x.corners.map((c) => ({ x: c.x, y: c.y }));
    return x;
  });
  return {
    version: 1,
    name: p.name,
    aspect: p.aspect,
    quality: p.quality,
    photos,
  };
}
export async function makeBackup(project: SavedProject) {
  if (project.photos.some((p) => !p.file))
    throw Error("部分原图缺失，请先补传再备份。");
  const clean = cleanProject(project);
  const entries: { name: string; blob: Blob | string }[] = [
    {
      name: "manifest.json",
      blob: JSON.stringify({ kind: "TalkCapture", version: 1, project: clean }),
    },
  ];
  for (let i = 0; i < project.photos.length; i++) {
    const file = project.photos[i].file!;
    if (
      file.size !== clean.photos[i].size ||
      (await fileDigest(file)) !== clean.photos[i].digest
    )
      throw Error("原图校验失败，请重新核对后备份。");
    entries.push({
      name: `originals/${String(i).padStart(3, "0")}.bin`,
      blob: file,
    });
  }
  return createZip(entries);
}
export async function readBackup(file: Blob) {
  if (file.size > 512 * 1024 * 1024)
    throw Error("备份文件超过 512 MB，请分项目保存。");
  const data = new Uint8Array(await file.arrayBuffer());
  const names = inspectBackupZip(data);
  const zip = await JSZip.loadAsync(data, { checkCRC32: true });
  const manifest = JSON.parse(await zip.file("manifest.json")!.async("string"));
  if (manifest.kind !== "TalkCapture" || manifest.version !== 1)
    throw Error("不是受支持的报告拾光备份。");
  const project = cleanProject(manifest.project);
  if (names.size !== project.photos.length + 1)
    throw Error("备份原图数量不一致。");
  for (let i = 0; i < project.photos.length; i++) {
    const p = project.photos[i],
      entry = zip.file(`originals/${String(i).padStart(3, "0")}.bin`);
    if (!entry) throw Error("备份缺少原图。");
    const bytes = await entry.async("uint8array");
    const original = new File([bytes as BlobPart], p.name, {
      lastModified: p.modified,
    });
    const identified = await identify(original);
    if (original.size !== p.size || (await fileDigest(original)) !== p.digest)
      throw Error("备份原图校验失败。");
    p.file = new File([identified], p.name, {
      type: identified.type,
      lastModified: p.modified,
    });
  }
  return project;
}
