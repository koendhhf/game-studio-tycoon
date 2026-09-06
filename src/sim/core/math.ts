/**
 * Numeric/interpolation helpers used across the simulation models.
 * Keeping them here means the balance formulas stay readable and unit-testable.
 */

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * clamp01(t);
}

/** Move `current` toward `target` by at most `step`. */
export function approach(current: number, target: number, step: number): number {
  if (current < target) return Math.min(target, current + step);
  return Math.max(target, current - step);
}

/** Exponential smoothing toward a target; `rate` is the fraction closed per period. */
export function smoothToward(current: number, target: number, rate: number): number {
  return current + (target - current) * clamp01(rate);
}

export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function sum(values: readonly number[]): number {
  let total = 0;
  for (const v of values) total += v;
  return total;
}

export function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : sum(values) / values.length;
}

export function weightedAvg(pairs: readonly [number, number][]): number {
  let num = 0;
  let den = 0;
  for (const [value, weight] of pairs) {
    num += value * weight;
    den += weight;
  }
  return den === 0 ? 0 : num / den;
}

/** Smooth 0..1 curve that is 0 at `edge0` and 1 at `edge1`. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge1 === edge0) return x >= edge1 ? 1 : 0;
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** Saturation curve: strong early returns then flattening.  f(0)=0, f(inf)=max. */
export function saturate(x: number, halfPoint: number, max = 1): number {
  if (x <= 0) return 0;
  return max * (x / (x + halfPoint));
}

export function pct(value: number, of: number): number {
  return of === 0 ? 0 : (value / of) * 100;
}
