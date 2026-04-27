const ASPECT_RATIO_TOLERANCE = 0.02;

export function hasMatchingAspectRatio(
  sourceAR: number,
  outputWidth: number,
  outputHeight: number
): boolean {
  const outputAR = outputWidth / outputHeight;
  return Math.abs(sourceAR - outputAR) / sourceAR < ASPECT_RATIO_TOLERANCE;
}