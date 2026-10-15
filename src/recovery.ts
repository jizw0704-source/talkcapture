import type { Photo } from "./types.ts";
export async function fileDigest(file: Blob): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(hash), (n) =>
    n.toString(16).padStart(2, "0"),
  ).join("");
}
export function recoveryTargets(
  photos: Photo[],
  file: { name: string; size: number },
  digest: string,
  targetId?: string,
): { targets: Photo[]; needsReview: boolean } {
  if (targetId) {
    const target = photos.find((p) => p.id === targetId);
    if (!target || target.file)
      throw Error("补传目标已变化，请重新选择缺原图的页面。");
    return { targets: [target], needsReview: target.digest !== digest };
  }
  const missing = photos.filter((p) => !p.file);
  const exact = missing.filter((p) => p.digest === digest);
  if (exact.length) return { targets: exact, needsReview: false };
  const legacy = missing.filter(
    (p) => !p.digest && p.name === file.name && p.size === file.size,
  );
  if (legacy.length === 1) return { targets: legacy, needsReview: true };
  if (legacy.length > 1 || missing.some((p) => p.name === file.name))
    throw Error(
      "存在同名缺图页，但无法确认对应关系。请选中旧页面，使用“补传当前页”，不要重复添加。",
    );
  return { targets: [], needsReview: false };
}
