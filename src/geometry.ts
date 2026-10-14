export type Point = { x: number; y: number };
export const fullCorners = (): Point[] => [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];
export function validateCorners(points: Point[]): string | null {
  if (points.length !== 4) return "请先选完四个角。";
  if (
    points.some(
      (p) =>
        !Number.isFinite(p.x) ||
        !Number.isFinite(p.y) ||
        p.x < 0 ||
        p.x > 1 ||
        p.y < 0 ||
        p.y > 1,
    )
  )
    return "控制点必须在照片范围内。";
  const crosses = points.map((p, i) => {
    const q = points[(i + 1) % 4],
      r = points[(i + 2) % 4];
    return (q.x - p.x) * (r.y - q.y) - (q.y - p.y) * (r.x - q.x);
  });
  if (crosses.some((c) => c <= 1e-6))
    return "四点须按左上、右上、右下、左下顺时针排列，不能交叉或形成凹角。";
  const area =
    Math.abs(
      points.reduce(
        (s, p, i) =>
          s + p.x * points[(i + 1) % 4].y - p.y * points[(i + 1) % 4].x,
        0,
      ),
    ) / 2;
  if (area < 0.0025) return "选区过小，请重新确定报告画面的四角。";
  if (
    points.some(
      (p, i) =>
        Math.hypot(p.x - points[(i + 1) % 4].x, p.y - points[(i + 1) % 4].y) <
        0.01,
    )
  )
    return "相邻控制点距离过近。";
  return null;
}
export function targetSize(
  points: Point[],
  width: number,
  height: number,
  maxEdge: number,
) {
  const p = points.map((p) => ({ x: p.x * width, y: p.y * height }));
  const distance = (a: number, b: number) =>
    Math.hypot(p[a].x - p[b].x, p[a].y - p[b].y);
  const w = Math.max(distance(0, 1), distance(3, 2)),
    h = Math.max(distance(0, 3), distance(1, 2));
  if (w < 2 || h < 2 || w / h > 20 || h / w > 20)
    throw Error("选区比例异常，请检查四点位置。");
  const scale = Math.min(1, maxEdge / Math.max(w, h));
  return {
    width: Math.max(2, Math.round(w * scale)),
    height: Math.max(2, Math.round(h * scale)),
  };
}
// Maps coordinates in the target unit square to source coordinates.
export function homography(points: Point[]): number[] {
  const dst = fullCorners();
  const rows: number[][] = [];
  points.forEach((p, i) => {
    const { x, y } = dst[i];
    rows.push([x, y, 1, 0, 0, 0, -x * p.x, -y * p.x, p.x]);
    rows.push([0, 0, 0, x, y, 1, -x * p.y, -y * p.y, p.y]);
  });
  for (let col = 0; col < 8; col++) {
    let pivot = col;
    for (let r = col + 1; r < 8; r++)
      if (Math.abs(rows[r][col]) > Math.abs(rows[pivot][col])) pivot = r;
    [rows[col], rows[pivot]] = [rows[pivot], rows[col]];
    const d = rows[col][col];
    if (Math.abs(d) < 1e-12)
      throw Error("四点无法形成有效透视变换，请重新选择。");
    for (let j = col; j <= 8; j++) rows[col][j] /= d;
    for (let r = 0; r < 8; r++) {
      if (r === col) continue;
      const factor = rows[r][col];
      for (let j = col; j <= 8; j++) rows[r][j] -= factor * rows[col][j];
    }
  }
  return rows.map((r) => r[8]);
}
export function contain(
  imageW: number,
  imageH: number,
  pageW: number,
  pageH: number,
) {
  const scale = Math.min(pageW / imageW, pageH / imageH);
  const w = imageW * scale,
    h = imageH * scale;
  return { x: (pageW - w) / 2, y: (pageH - h) / 2, w, h };
}
export function rotatedCorners(points: Point[]) {
  return points.length === 4
    ? [points[3], points[0], points[1], points[2]].map((p) => ({
        x: 1 - p.y,
        y: p.x,
      }))
    : [];
}
export function safeName(name: string) {
  return (
    name
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
      .replace(/[. ]+$/g, "")
      .slice(0, 80) || "学术报告"
  );
}
