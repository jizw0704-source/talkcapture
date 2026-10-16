import { validateCorners, type Point } from "./geometry.ts";

type Candidate = { corners: Point[]; score: number };
const cross = (a: Point, b: Point, c: Point) =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
const area = (p: Point[]) =>
  Math.abs(
    p.reduce((s, a, i) => {
      const b = p[(i + 1) % p.length];
      return s + a.x * b.y - a.y * b.x;
    }, 0),
  ) / 2;
function fitBoundary(outline: Point[], quad: Point[], scale: number) {
  const lines = quad.map((a, k) => {
    const b = quad[(k + 1) % 4],
      dx = b.x - a.x,
      dy = b.y - a.y,
      length = Math.hypot(dx, dy);
    let best: { a: Point; b: Point; score: number } | undefined;
    for (let j = 0; j < outline.length; j++) {
      const p = outline[j],
        q = outline[(j + 1) % outline.length],
        ex = q.x - p.x,
        ey = q.y - p.y,
        size = Math.hypot(ex, ey);
      const alignment = (dx * ex + dy * ey) / (length * size);
      const midpoint = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
      const distance =
        Math.abs(dx * (midpoint.y - a.y) - dy * (midpoint.x - a.x)) / length;
      if (alignment < 0.9 || distance > scale * 0.08) continue;
      const score = size * alignment ** 8;
      if (!best || score > best.score) best = { a: p, b: q, score };
    }
    return best;
  });
  if (lines.some((l) => !l)) return quad;
  const refined = lines.map((line, k) => {
    const previous = lines[(k + 3) % 4]!;
    const a = previous.a,
      b = previous.b,
      c = line!.a,
      d = line!.b;
    const dx = b.x - a.x,
      dy = b.y - a.y,
      ex = d.x - c.x,
      ey = d.y - c.y,
      det = dx * ey - dy * ex;
    if (Math.abs(det) < 1e-5) return quad[k];
    const t = ((c.x - a.x) * ey - (c.y - a.y) * ex) / det;
    return { x: a.x + t * dx, y: a.y + t * dy };
  });
  if (
    refined.some(
      (p, k) => Math.hypot(p.x - quad[k].x, p.y - quad[k].y) > scale * 0.15,
    )
  )
    return quad;
  return refined;
}
function hull(points: Point[]) {
  points.sort((a, b) => a.x - b.x || a.y - b.y);
  const chain = (input: Point[]) => {
    const out: Point[] = [];
    for (const p of input) {
      while (
        out.length > 1 &&
        cross(out[out.length - 2], out[out.length - 1], p) <= 0
      )
        out.pop();
      out.push(p);
    }
    return out;
  };
  const lower = chain(points),
    upper = chain([...points].reverse());
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}
function otsu(values: Float32Array) {
  const hist = new Uint32Array(256);
  let sum = 0;
  for (const v of values) {
    const k = Math.round(v);
    hist[k]++;
    sum += k;
  }
  let weight = 0,
    partial = 0,
    best = 0,
    threshold = 127;
  for (let k = 0; k < 255; k++) {
    weight += hist[k];
    partial += k * hist[k];
    if (!weight || weight === values.length) continue;
    const difference =
      partial / weight - (sum - partial) / (values.length - weight);
    const score = weight * (values.length - weight) * difference * difference;
    if (score > best) {
      best = score;
      threshold = k;
    }
  }
  return threshold;
}
// Separable box morphology: close small gaps without joining distant screens.
function filter(
  mask: Uint8Array,
  w: number,
  h: number,
  r: number,
  dilate: boolean,
) {
  const pass = (source: Uint8Array, vertical: boolean) => {
    const out = new Uint8Array(source.length);
    const outer = vertical ? w : h,
      inner = vertical ? h : w;
    const at = (a: number, b: number) => (vertical ? b * w + a : a * w + b);
    for (let a = 0; a < outer; a++) {
      let sum = 0;
      for (let b = -r; b < inner + r; b++) {
        if (b + r < inner) sum += source[at(a, b + r)];
        if (b - r - 1 >= 0) sum -= source[at(a, b - r - 1)];
        if (b >= 0 && b < inner)
          out[at(a, b)] = Number(dilate ? sum > 0 : sum === 2 * r + 1);
      }
    }
    return out;
  };
  return pass(pass(mask, false), true);
}
function regions(mask: Uint8Array, w: number, h: number): Candidate[] {
  const seen = new Uint8Array(mask.length),
    queue = new Int32Array(mask.length),
    candidates: Candidate[] = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    let head = 0,
      tail = 1,
      touches = false;
    queue[0] = start;
    seen[start] = 1;
    const boundary: Point[] = [];
    while (head < tail) {
      const i = queue[head++],
        x = i % w,
        y = Math.floor(i / w);
      if (x <= 2 || y <= 2 || x >= w - 3 || y >= h - 3) touches = true;
      let edge = false;
      for (const [nx, ny] of [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ]) {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) {
          edge = true;
          continue;
        }
        const j = ny * w + nx;
        if (!mask[j]) edge = true;
        else if (!seen[j]) {
          seen[j] = 1;
          queue[tail++] = j;
        }
      }
      if (edge) boundary.push({ x, y });
    }
    if (touches || tail < mask.length * 0.08 || tail > mask.length * 0.94)
      continue;
    const outline = hull(boundary),
      originalArea = area(outline);
    if (outline.length < 4 || tail / originalArea < 0.64) continue;
    const quad = [...outline];
    while (quad.length > 4) {
      let index = 0,
        minimum = Infinity;
      for (let k = 0; k < quad.length; k++) {
        const loss = Math.abs(
          cross(
            quad[(k + quad.length - 1) % quad.length],
            quad[k],
            quad[(k + 1) % quad.length],
          ),
        );
        if (loss < minimum) {
          minimum = loss;
          index = k;
        }
      }
      quad.splice(index, 1);
    }
    const qa = area(quad);
    // Curved/irregular bright objects must not become invented rectangles.
    if (qa / originalArea < 0.95) continue;
    const refined = fitBoundary(outline, quad, Math.max(w, h));
    const first = refined.reduce(
      (best, p, k) =>
        p.x + p.y < refined[best].x + refined[best].y ? k : best,
      0,
    );
    const ordered = [...refined.slice(first), ...refined.slice(0, first)];
    const lengths = ordered.map((p, k) =>
      Math.hypot(p.x - ordered[(k + 1) % 4].x, p.y - ordered[(k + 1) % 4].y),
    );
    const ratio =
      Math.max(lengths[0], lengths[2]) / Math.max(lengths[1], lengths[3]);
    const corners = ordered.map((p) => ({
      x: p.x / (w - 1),
      y: p.y / (h - 1),
    }));
    if (
      ratio < 0.36 ||
      ratio > 2.8 ||
      Math.min(...lengths) < Math.min(w, h) * 0.2 ||
      validateCorners(corners)
    )
      continue;
    candidates.push({ corners, score: qa / (w * h) });
  }
  return candidates;
}
export function regionCandidates(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): Candidate[] {
  // Region segmentation uses a bounded second scale; all results are normalized.
  const scale = Math.min(1, 360 / Math.max(width, height));
  const w = Math.round(width * scale),
    h = Math.round(height * scale);
  if (Math.min(w, h) < 48) return [];
  const gray = new Float32Array(w * h),
    channels = [
      new Float32Array(w * h),
      new Float32Array(w * h),
      new Float32Array(w * h),
    ];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x,
        k =
          (Math.round((y * (height - 1)) / (h - 1)) * width +
            Math.round((x * (width - 1)) / (w - 1))) *
          4;
      const alpha = data[k + 3] / 255;
      const r = data[k] * alpha + 255 * (1 - alpha),
        g = data[k + 1] * alpha + 255 * (1 - alpha),
        b = data[k + 2] * alpha + 255 * (1 - alpha);
      gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
      channels[0][i] = b - r;
      channels[1][i] = b - g;
      channels[2][i] = g - r;
    }
  const threshold = otsu(gray),
    masks: Uint8Array[] = [];
  for (const bright of [true, false])
    masks.push(
      Uint8Array.from(gray, (v) =>
        Number(bright ? v > threshold : v <= threshold),
      ),
    );
  // Add a color cue only when bright and dark populations differ meaningfully.
  let feature: Float32Array | undefined,
    separation = 0,
    sign = 1;
  for (const channel of channels) {
    let hi = 0,
      lo = 0,
      nh = 0,
      nl = 0;
    for (let i = 0; i < gray.length; i++) {
      if (gray[i] > threshold) {
        hi += channel[i];
        nh++;
      } else {
        lo += channel[i];
        nl++;
      }
    }
    if (nh < gray.length * 0.02 || nl < gray.length * 0.02) continue;
    const difference = hi / nh - lo / nl;
    if (Math.abs(difference) > separation) {
      separation = Math.abs(difference);
      feature = channel;
      sign = Math.sign(difference);
    }
  }
  if (feature && separation >= 12)
    for (const cut of [0.35, 0.65])
      masks.push(
        Uint8Array.from(feature, (v) => Number(v * sign > separation * cut)),
      );
  // Equal-luminance colored screens need color populations independent of gray.
  for (const channel of channels) {
    let minimum = Infinity,
      maximum = -Infinity;
    for (const v of channel) {
      minimum = Math.min(minimum, v);
      maximum = Math.max(maximum, v);
    }
    if (maximum - minimum < 24) continue;
    const mapped = Float32Array.from(channel, (v) => (v + 255) / 2);
    const cut = otsu(mapped);
    for (const high of [true, false])
      masks.push(
        Uint8Array.from(mapped, (v) =>
          Number(high ? Math.round(v) > cut : Math.round(v) <= cut),
        ),
      );
  }
  const out: Candidate[] = [];
  for (const mask of masks) {
    const closed = filter(filter(mask, w, h, 2, true), w, h, 2, false);
    for (const candidate of regions(closed, w, h)) {
      if (
        !out.some((c) =>
          c.corners.every(
            (p, k) =>
              Math.hypot(
                p.x - candidate.corners[k].x,
                p.y - candidate.corners[k].y,
              ) < 0.025,
          ),
        )
      )
        out.push(candidate);
    }
  }
  return out.sort((a, b) => b.score - a.score);
}
