type NamePhoto = {
  name: string;
  captured: number | null;
  modified: number;
  excluded: boolean;
};
// Metadata only: never pretend a camera filename contains the report topic.
export function suggestReportName(
  photos: NamePhoto[],
  now = new Date(),
): string {
  const included = photos.filter((p) => !p.excluded);
  const dates = included
    .map((p) => p.captured)
    .filter(
      (t): t is number => typeof t === "number" && Number.isFinite(t) && t > 0,
    );
  const date = dates.length ? new Date(Math.min(...dates)) : now;
  const stamp = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const stems = included.map((p) =>
    p.name
      .replace(/\.[^.]+$/, "")
      .replace(/[\s_-]*\d+$/, "")
      .replace(/[\\/:*?"<>|]/g, "")
      .trim(),
  );
  const topic =
    stems.length &&
    stems.every((s) => s === stems[0]) &&
    /[\p{L}]/u.test(stems[0]) &&
    !/^(IMG|DSC|DSCF|DCIM|PXL|IMAGE|PHOTO|照片|图片|示例报告)$/i.test(stems[0])
      ? stems[0].slice(0, 36)
      : "学术报告";
  return `${topic}_${stamp}_${included.length}页`;
}
