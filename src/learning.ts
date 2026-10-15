import { validateCorners, type Point } from "./geometry.ts";
export type SceneFeature = { aspect: number; cells: number[] };
export type Correction = {
  feature: SceneFeature;
  corners: Point[];
  time: number;
};
const storageKey = "talkcapture-corrections-v1";
export function loadCorrections(): Correction[] {
  try {
    if (localStorage.getItem(`${storageKey}-enabled`) === "off") return [];
    const saved: unknown = JSON.parse(localStorage.getItem(storageKey) || "[]");
    return Array.isArray(saved) ? saved.filter(validCorrection).slice(-30) : [];
  } catch {
    return [];
  }
}
export function saveCorrections(examples: Correction[]) {
  localStorage.setItem(
    storageKey,
    JSON.stringify(examples.filter(validCorrection).slice(-30)),
  );
}
export function clearCorrections() {
  localStorage.removeItem(storageKey);
}
export function setLearningEnabled(enabled: boolean) {
  localStorage.setItem(`${storageKey}-enabled`, enabled ? "on" : "off");
}
export function learningEnabled() {
  try {
    return localStorage.getItem(`${storageKey}-enabled`) !== "off";
  } catch {
    return false;
  }
}
export function sceneFeature(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): SceneFeature {
  const cells: number[] = [];
  // Coarse luminance layout, not an original image or a trained neural model.
  for (let gy = 0; gy < 8; gy++)
    for (let gx = 0; gx < 12; gx++) {
      let sum = 0,
        count = 0;
      for (
        let y = Math.floor((gy * height) / 8);
        y < Math.floor(((gy + 1) * height) / 8);
        y += 2
      )
        for (
          let x = Math.floor((gx * width) / 12);
          x < Math.floor(((gx + 1) * width) / 12);
          x += 2
        ) {
          const i = (y * width + x) * 4;
          sum +=
            (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) / 255;
          count++;
        }
      cells.push(sum / Math.max(1, count));
    }
  const mean = cells.reduce((s, v) => s + v, 0) / cells.length;
  return {
    aspect: width / height,
    cells: cells.map((v) => Math.round((v - mean) * 1000) / 1000),
  };
}
export function validCorrection(value: unknown): value is Correction {
  const v = value as Correction;
  return (
    !!v &&
    Number.isFinite(v.time) &&
    !!v.feature &&
    Number.isFinite(v.feature.aspect) &&
    v.feature.aspect > 0 &&
    Array.isArray(v.feature.cells) &&
    v.feature.cells.length === 96 &&
    v.feature.cells.every((n) => Number.isFinite(n) && Math.abs(n) <= 1) &&
    Array.isArray(v.corners) &&
    v.corners.every(
      (p) => p && typeof p.x === "number" && typeof p.y === "number",
    ) &&
    !validateCorners(v.corners)
  );
}
export function matchCorrection(
  feature: SceneFeature,
  examples: Correction[],
): Point[] | undefined {
  // Flat scenes have no identifying structure and must not match each other.
  if (Math.sqrt(feature.cells.reduce((s, v) => s + v * v, 0) / 96) < 0.07)
    return;
  const matches = examples
    .filter(validCorrection)
    .filter((e) => Math.abs(e.feature.aspect / feature.aspect - 1) < 0.025)
    .map((e) => ({
      e,
      d: Math.sqrt(
        e.feature.cells.reduce(
          (s, v, i) => s + (v - feature.cells[i]) ** 2,
          0,
        ) / 96,
      ),
    }))
    .sort((a, b) => a.d - b.d);
  const best = matches[0];
  if (!best || best.d > 0.035) return;
  if (
    matches.some(
      (m) =>
        m.d - best.d < 0.01 &&
        m.e.corners.some(
          (p, i) =>
            Math.hypot(p.x - best.e.corners[i].x, p.y - best.e.corners[i].y) >
            0.06,
        ),
    )
  )
    return;
  return best.e.corners.map((p) => ({ ...p }));
}
export function rememberCorrection(
  examples: Correction[],
  correction: Correction,
): Correction[] {
  if (!validCorrection(correction)) return examples;
  return [
    ...examples.filter(
      (e) => validCorrection(e) && !matchCorrection(correction.feature, [e]),
    ),
    correction,
  ].slice(-30);
}
