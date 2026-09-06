/**
 * Deterministic random number generation.
 *
 * The engine uses sfc32 (Small Fast Counter, 32-bit) whose full internal state
 * is a plain object of four 32-bit integers. That means the RNG is serializable:
 * saving the state saves the RNG exactly, and loading restores the exact same
 * sequence. Every system draws from one shared stream, and all systems iterate
 * entity collections in sorted-id order, so a given (seed, command log) always
 * produces a byte-identical world.
 */

export interface RngState {
  a: number;
  b: number;
  c: number;
  d: number;
}

/** FNV-1a string hash. Used to derive stable numeric seeds from names/keys. */
export function hashString(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Mix a set of integers into one well-distributed 32-bit value. */
export function mixInts(...values: number[]): number {
  let h = 0x9e3779b9;
  for (const v of values) {
    h ^= (v | 0) + 0x6d2b79f5 + (h << 6) + (h >>> 2);
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
  }
  return (h ^ (h >>> 16)) >>> 0;
}

/** splitmix32 — used only to expand a short seed into a full sfc32 state. */
function splitmix32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x9e3779b9) | 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
    return (z ^ (z >>> 15)) >>> 0;
  };
}

export function createRngState(seed: number | string): RngState {
  const numeric = typeof seed === 'string' ? hashString(seed) : seed >>> 0;
  const next = splitmix32(numeric);
  return { a: next(), b: next(), c: next(), d: next() };
}

/**
 * A single draw of sfc32, mutating the state in place.
 * `state` is kept as a plain object so it survives JSON round-trips.
 */
function nextU32(state: RngState): number {
  let t = (state.a + state.b) | 0;
  state.a = (state.b ^ (state.b >>> 9)) | 0;
  state.b = (state.c + (state.c << 3)) | 0;
  state.c = ((state.c << 21) | (state.c >>> 11)) | 0;
  state.d = (state.d + 1) | 0;
  state.c = (state.c + t) | 0;
  t = (t + state.d) | 0;
  return t >>> 0;
}

/** One-shot, order-independent randomness: hash(seed, key) -> [0,1). */
export function randFor(seed: number, key: string | number): number {
  const numeric = typeof key === 'string' ? hashString(key) : key >>> 0;
  const next = splitmix32(mixInts(seed, numeric));
  return next() / 0x100000000;
}

/** One-shot integer in [min,max] derived from (seed, key). */
export function intFor(seed: number, key: string | number, min: number, max: number): number {
  return min + Math.floor(randFor(seed, key) * (max - min + 1));
}

export class Rng {
  constructor(readonly state: RngState) {}

  /** Uniform float in [0, 1). */
  next(): number {
    return nextU32(this.state) / 0x100000000;
  }

  /** Uniform float in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Uniform integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    if (max < min) return min;
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.min(items.length - 1, Math.floor(this.next() * items.length))];
  }

  /** Pick an index with the given weights. */
  weighted(weights: readonly number[]): number {
    let total = 0;
    for (const w of weights) total += Math.max(0, w);
    if (total <= 0) return 0;
    let roll = this.next() * total;
    for (let i = 0; i < weights.length; i++) {
      roll -= Math.max(0, weights[i]);
      if (roll <= 0) return i;
    }
    return weights.length - 1;
  }

  pickWeighted<T>(items: readonly T[], weightOf: (item: T) => number): T {
    const idx = this.weighted(items.map(weightOf));
    return items[idx];
  }

  /** Approximately normal (Irwin–Hall, n=6). Cheap and bounded. */
  gauss(mean: number, sd: number): number {
    let s = 0;
    for (let i = 0; i < 6; i++) s += this.next();
    return mean + ((s - 3) / 1.224744871391589) * sd;
  }

  /** Random sample of up to `count` entries, order preserved-ish and deterministic. */
  sample<T>(items: readonly T[], count: number): T[] {
    const pool = items.slice();
    const out: T[] = [];
    const n = Math.min(count, pool.length);
    for (let i = 0; i < n; i++) {
      const j = this.int(i, pool.length - 1);
      const tmp = pool[i];
      pool[i] = pool[j];
      pool[j] = tmp;
      out.push(pool[i]);
    }
    return out;
  }
}

/**
 * Numeric fingerprint of a value. Used for save-file integrity checks and for
 * cheap "is this world identical to that world" assertions in tests.
 */
export function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
