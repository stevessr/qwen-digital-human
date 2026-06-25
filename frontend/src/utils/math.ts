/**
 * Shared math utilities for the digital human frontend.
 */

/** Clamp a number between min and max, with an optional fallback for non-finite values. */
export function clampNumber(
  value: number,
  min: number,
  max: number,
  fallback = 0,
): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

/** Linear interpolation between a and b by t [0, 1]. */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.max(0, Math.min(1, t))
}

/** Map a value from one range to another. */
export function mapRange(
  value: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number,
): number {
  if (Math.abs(inMax - inMin) < 1e-8) return outMin
  const t = (value - inMin) / (inMax - inMin)
  return lerp(outMin, outMax, t)
}
