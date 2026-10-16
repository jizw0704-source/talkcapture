export type Fingerprint = { width: number; height: number; pixels: number[] };
// Conservative image similarity, never a decision to remove a page.
export function looksSimilar(a: Fingerprint, b: Fingerprint) {
  if (
    Math.abs(Math.log(a.width / a.height / (b.width / b.height))) > 0.025 ||
    a.pixels.length !== b.pixels.length ||
    !a.pixels.length
  )
    return false;
  let difference = 0,
    changed = 0,
    minimum = 255,
    maximum = 0;
  for (let i = 0; i < a.pixels.length; i++) {
    const d = Math.abs(a.pixels[i] - b.pixels[i]);
    difference += d;
    if (d > 18) changed++;
    if (difference > a.pixels.length * 3 || changed > a.pixels.length * 0.012)
      return false;
    minimum = Math.min(minimum, a.pixels[i]);
    maximum = Math.max(maximum, a.pixels[i]);
  }
  // Blank slides and low-information frames are not useful duplicate evidence.
  return (
    maximum - minimum >= 35 &&
    difference / a.pixels.length <= 3 &&
    changed / a.pixels.length <= 0.012
  );
}
