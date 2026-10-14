import { validateCorners, type Point } from "./geometry.ts";

export type SlideDetection = {
  status: "suggested" | "not_found" | "ambiguous";
  corners: Point[];
};
type Line = { a: number; b: number; r: number; votes: number };
type Edge = { x: number; y: number; angle: number };
const radians = Math.PI / 180;
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
function intersection(a: Line, b: Line): Point | undefined {
  const det = a.a * b.b - a.b * b.a;
  if (Math.abs(det) < 0.015) return;
  return { x: (a.r * b.b - a.b * b.r) / det, y: (a.a * b.r - a.r * b.a) / det };
}
function nearby(a: Line, b: Line) {
  const dot = a.a * b.a + a.b * b.b;
  return (
    Math.abs(dot) > Math.cos(5 * radians) &&
    Math.abs(a.r - (dot < 0 ? -b.r : b.r)) < 5
  );
}
function clockwise(points: Point[]) {
  const cx = points.reduce((s, p) => s + p.x, 0) / 4;
  const cy = points.reduce((s, p) => s + p.y, 0) / 4;
  const sorted = [...points].sort(
    (a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx),
  );
  const first = sorted.reduce(
    (best, p, i) => (p.x + p.y < sorted[best].x + sorted[best].y ? i : best),
    0,
  );
  return [...sorted.slice(first), ...sorted.slice(0, first)];
}

// A geometric candidate detector, not a semantic PPT recognizer or calibrated probability.
export function detectSlide(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): SlideDetection {
  const empty: SlideDetection = { status: "not_found", corners: [] };
  if (
    ![width, height].every((n) => Number.isInteger(n) && n > 0 && n <= 720) ||
    data.length !== width * height * 4
  )
    throw Error("自动定位需要有效且最长边不超过 720 像素的分析图。");
  if (Math.min(width, height) < 64) return empty;
  const count = width * height,
    gray = new Float32Array(count),
    blur = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const alpha = data[i * 4 + 3] / 255;
    gray[i] =
      (data[i * 4] * 0.299 +
        data[i * 4 + 1] * 0.587 +
        data[i * 4 + 2] * 0.114) *
        alpha +
      255 * (1 - alpha);
  }
  for (let y = 1; y < height - 1; y++)
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      blur[i] =
        (gray[i - width - 1] +
          gray[i - width + 1] +
          gray[i + width - 1] +
          gray[i + width + 1] +
          2 * (gray[i - 1] + gray[i + 1] + gray[i - width] + gray[i + width]) +
          4 * gray[i]) /
        16;
    }
  const magnitude = new Float32Array(count),
    directions = new Uint8Array(count);
  let maximum = 0;
  for (let y = 2; y < height - 2; y++)
    for (let x = 2; x < width - 2; x++) {
      const i = y * width + x;
      const gx =
        -blur[i - width - 1] -
        2 * blur[i - 1] -
        blur[i + width - 1] +
        blur[i - width + 1] +
        2 * blur[i + 1] +
        blur[i + width + 1];
      const gy =
        -blur[i - width - 1] -
        2 * blur[i - width] -
        blur[i - width + 1] +
        blur[i + width - 1] +
        2 * blur[i + width] +
        blur[i + width + 1];
      magnitude[i] = Math.hypot(gx, gy);
      directions[i] = (Math.round(Math.atan2(gy, gx) / radians) + 360) % 180;
      maximum = Math.max(maximum, magnitude[i]);
    }
  const threshold = Math.max(28, maximum * 0.04),
    edges: Edge[] = [];
  for (let y = 2; y < height - 2; y++)
    for (let x = 2; x < width - 2; x++) {
      const i = y * width + x;
      if (magnitude[i] >= threshold)
        edges.push({
          x: x - width / 2,
          y: y - height / 2,
          angle: directions[i],
        });
    }
  if (edges.length < 80) return empty;
  const stride = Math.max(1, Math.ceil(edges.length / 14000));
  const sampled = edges.filter((_, i) => i % stride === 0);
  const radius = Math.ceil(Math.hypot(width, height) / 2),
    bins = radius * 2 + 1;
  const votes = new Uint32Array(180 * bins);
  const cos = Float64Array.from({ length: 180 }, (_, i) =>
    Math.cos(i * radians),
  );
  const sin = Float64Array.from({ length: 180 }, (_, i) =>
    Math.sin(i * radians),
  );
  for (const edge of sampled)
    for (let d = -5; d <= 5; d++) {
      const angle = (edge.angle + d + 180) % 180;
      const r = Math.round(edge.x * cos[angle] + edge.y * sin[angle]) + radius;
      votes[angle * bins + r]++;
    }
  const peaks: { angle: number; r: number; votes: number }[] = [];
  const minVotes = Math.max(16, (Math.min(width, height) * 0.16) / stride);
  for (let angle = 0; angle < 180; angle++)
    for (let r = 1; r < bins - 1; r++) {
      const i = angle * bins + r;
      if (
        votes[i] >= minVotes &&
        votes[i] >= votes[i - 1] &&
        votes[i] > votes[i + 1]
      )
        peaks.push({ angle, r: r - radius, votes: votes[i] });
    }
  peaks.sort((a, b) => b.votes - a.votes);
  const lines: Line[] = [];
  for (const peak of peaks) {
    let line: Line = {
      a: cos[peak.angle],
      b: sin[peak.angle],
      r: peak.r,
      votes: peak.votes,
    };
    if (lines.some((existing) => nearby(existing, line))) continue;
    const support = sampled.filter(
      (p) =>
        Math.abs(p.x * line.a + p.y * line.b - line.r) <= 2.5 &&
        Math.abs(cos[p.angle] * line.a + sin[p.angle] * line.b) > 0.94,
    );
    if (support.length < minVotes) continue;
    const mx = support.reduce((s, p) => s + p.x, 0) / support.length;
    const my = support.reduce((s, p) => s + p.y, 0) / support.length;
    let xx = 0,
      xy = 0,
      yy = 0,
      low = Infinity,
      high = -Infinity;
    for (const p of support) {
      xx += (p.x - mx) ** 2;
      xy += (p.x - mx) * (p.y - my);
      yy += (p.y - my) ** 2;
      const along = -p.x * line.b + p.y * line.a;
      low = Math.min(low, along);
      high = Math.max(high, along);
    }
    if (high - low < Math.min(width, height) * 0.2) continue;
    const direction = Math.atan2(2 * xy, xx - yy) / 2;
    let a = -Math.sin(direction),
      b = Math.cos(direction);
    if (a * line.a + b * line.b < 0) {
      a = -a;
      b = -b;
    }
    line = { a, b, r: a * mx + b * my, votes: support.length };
    if (!lines.some((existing) => nearby(existing, line))) lines.push(line);
    if (lines.length === 28) break;
  }
  const pairs: { a: Line; b: Line; votes: number }[] = [];
  for (let i = 0; i < lines.length; i++)
    for (let j = i + 1; j < lines.length; j++) {
      const a = lines[i],
        b = lines[j],
        dot = a.a * b.a + a.b * b.b;
      if (
        Math.abs(dot) < Math.cos(35 * radians) ||
        Math.abs(a.r - (dot < 0 ? -b.r : b.r)) < Math.min(width, height) * 0.25
      )
        continue;
      const crossing = intersection(a, b);
      if (
        crossing &&
        Math.abs(crossing.x) < width * 0.55 &&
        Math.abs(crossing.y) < height * 0.55
      )
        continue;
      pairs.push({ a, b, votes: a.votes + b.votes });
    }
  pairs.sort((a, b) => b.votes - a.votes);
  pairs.splice(80);
  const candidates: { corners: Point[]; score: number }[] = [];
  const sampleGray = (x: number, y: number) =>
    gray[
      Math.max(0, Math.min(height - 1, Math.round(y))) * width +
        Math.max(0, Math.min(width - 1, Math.round(x)))
    ];
  for (let i = 0; i < pairs.length; i++)
    for (let j = i + 1; j < pairs.length; j++) {
      const a = pairs[i],
        b = pairs[j];
      if (
        [a.a, a.b].some((line) => line === b.a || line === b.b) ||
        Math.abs(a.a.a * b.a.a + a.a.b * b.a.b) > 0.78
      )
        continue;
      const points = [
        intersection(a.a, b.a),
        intersection(a.a, b.b),
        intersection(a.b, b.b),
        intersection(a.b, b.a),
      ];
      if (
        points.some(
          (p) =>
            !p ||
            Math.abs(p.x) > width / 2 - 2 ||
            Math.abs(p.y) > height / 2 - 2,
        )
      )
        continue;
      const pixel = clockwise(
        (points as Point[]).map((p) => ({
          x: p.x + width / 2,
          y: p.y + height / 2,
        })),
      );
      const corners = pixel.map((p) => ({
        x: p.x / (width - 1),
        y: p.y / (height - 1),
      }));
      if (validateCorners(corners)) continue;
      const area =
        Math.abs(
          corners.reduce(
            (s, p, k) =>
              s + p.x * corners[(k + 1) % 4].y - p.y * corners[(k + 1) % 4].x,
            0,
          ),
        ) / 2;
      if (area < 0.12 || area > 0.95) continue;
      const lengths = pixel.map((p, k) => distance(p, pixel[(k + 1) % 4]));
      const ratio =
        Math.max(lengths[0], lengths[2]) / Math.max(lengths[1], lengths[3]);
      if (
        Math.min(...lengths) < Math.min(width, height) * 0.2 ||
        ratio < 0.36 ||
        ratio > 2.8
      )
        continue;
      let coverage = 0,
        contrast = 0,
        valid = true;
      for (let k = 0; k < 4; k++) {
        const p = pixel[k],
          q = pixel[(k + 1) % 4],
          length = lengths[k];
        const nx = -(q.y - p.y) / length,
          ny = (q.x - p.x) / length;
        const samples = Math.min(80, Math.ceil(length / 3));
        let supported = 0,
          gap = 0,
          longestGap = 0,
          difference = 0;
        for (let s = 0; s < samples; s++) {
          const t = (s + 0.5) / samples,
            x = p.x + (q.x - p.x) * t,
            y = p.y + (q.y - p.y) * t;
          let strength = 0;
          for (let d = -3; d <= 3; d++) {
            const xx = Math.round(x + nx * d),
              yy = Math.round(y + ny * d);
            if (xx >= 2 && yy >= 2 && xx < width - 2 && yy < height - 2)
              strength = Math.max(strength, magnitude[yy * width + xx]);
          }
          if (strength >= threshold) {
            supported++;
            gap = 0;
          } else {
            gap++;
            longestGap = Math.max(longestGap, gap);
          }
          difference += Math.abs(
            sampleGray(x + nx * 5, y + ny * 5) -
              sampleGray(x - nx * 5, y - ny * 5),
          );
        }
        if (supported / samples < 0.55 || longestGap / samples > 0.32) {
          valid = false;
          break;
        }
        coverage += supported / samples / 4;
        contrast += difference / samples / 4;
      }
      if (!valid || coverage < 0.78) continue;
      const score =
        coverage * 0.62 +
        Math.sqrt(area) * 0.22 +
        Math.min(1, contrast / 48) * 0.16;
      if (score < 0.74) continue;
      const duplicate = candidates.find((existing) =>
        existing.corners.every((p, k) => distance(p, corners[k]) < 0.04),
      );
      if (duplicate) {
        if (duplicate.score < score)
          Object.assign(duplicate, { corners, score });
      } else candidates.push({ corners, score });
    }
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  if (!best) return empty;
  const other = candidates[1];
  if (other && best.score - other.score < 0.035) {
    const center = (points: Point[]) => ({
      x: points.reduce((s, p) => s + p.x, 0) / 4,
      y: points.reduce((s, p) => s + p.y, 0) / 4,
    });
    if (distance(center(best.corners), center(other.corners)) > 0.18)
      return { status: "ambiguous", corners: [] };
  }
  return { status: "suggested", corners: best.corners };
}
