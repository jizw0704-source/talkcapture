import { detectSlide, type SlideDetection } from "./detection.ts";
import { sceneFeature, matchCorrection, type Correction } from "./learning.ts";

// Confirmed local examples can correct a plausible but inaccurate detector
// result too. They remain suggestions, never human confirmations.
export function suggestCorners(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  examples: Correction[] = [],
): SlideDetection {
  const learned = examples.length
    ? matchCorrection(sceneFeature(pixels, width, height), examples)
    : undefined;
  if (learned)
    return {
      status: "suggested",
      corners: learned,
      source: "local-correction",
    };
  return detectSlide(pixels, width, height);
}
