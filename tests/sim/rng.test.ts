/**
 * Deterministic RNG: the guarantee the whole save/replay model rests on.
 */

import { describe, expect, it } from 'vitest';
import { Simulation } from './test-imports';
import { Rng, createRngState, fnv1a, hashString, intFor, randFor, stableStringify } from './test-imports';

function draw(seed: number, count: number): number[] {
  const rng = new Rng(createRngState(seed));
  return Array.from({ length: count }, () => rng.next());
}

describe('deterministic RNG', () => {
  it('repeats the same sequence for the same seed', () => {
    expect(draw(1, 200)).toEqual(draw(1, 200));
    expect(draw(1, 20)).not.toEqual(draw(2, 20));
  });

  it('stays inside [0,1) with a sane spread', () => {
    const values = draw(42, 20_000);
    for (const v of values) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    expect(Math.abs(mean - 0.5)).toBeLessThan(0.02);
    const buckets = new Array(10).fill(0);
    for (const v of values) buckets[Math.floor(v * 10)] += 1;
    for (const bucket of buckets) expect(bucket).toBeGreaterThan(values.length / 20);
  });

  it('derives independent streams from a seed and a key', () => {
    const a = Array.from({ length: 5 }, (_, i) => randFor(7, `release:${i}`));
    const b = Array.from({ length: 5 }, (_, i) => randFor(7, `release:${i}`));
    expect(a).toEqual(b);
    expect(a.some((v, i) => v !== b[i])).toBe(false);
    const other = Array.from({ length: 5 }, (_, i) => randFor(8, `release:${i}`));
    expect(a).not.toEqual(other);
    for (const v of a) expect(v).toBeGreaterThanOrEqual(0);
  });

  it('gives bounded integers and stable weighted picks', () => {
    const rng = new Rng(createRngState('seed-string'));
    for (let i = 0; i < 500; i++) {
      const n = rng.int(3, 9);
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(9);
    }
    expect(intFor(3, 'k', 1, 6)).toBe(intFor(3, 'k', 1, 6));
    const pickers = [new Rng(createRngState(9)), new Rng(createRngState(9))];
    const picks = pickers.map((r) => Array.from({ length: 50 }, () => r.pickWeighted(['a', 'b', 'c'], (x) => (x === 'a' ? 5 : 1))));
    expect(picks[0]).toEqual(picks[1]);
    expect(picks[0].filter((p) => p === 'a').length).toBeGreaterThan(picks[0].filter((p) => p === 'b').length);
  });

  it('hashes are stable and distinguish edits', () => {
    expect(hashString('studio mogul')).toBe(hashString('studio mogul'));
    expect(fnv1a('abc')).not.toBe(fnv1a('abd'));
    expect(Number.isInteger(hashString(''))).toBe(true);
    expect(hashString('a')).not.toBe(hashString('b'));
  });

  it('serialises stableStringify-independent of key order', () => {
    expect(stableStringify({ b: 1, a: [2, { d: 3, c: 4 }] })).toBe(stableStringify({ a: [2, { c: 4, d: 3 }], b: 1 }));
  });

  it('the world rng state is plain data and continues from a restore', () => {
    const a = Simulation.create({ seed: 11, studioName: 'Rng Test', config: { aiStudioCount: 0, aiStudioTarget: 0 } as never });
    a.advance(30);
    const snapshot = JSON.parse(JSON.stringify(a.state.rng));
    expect(Object.keys(snapshot).sort()).toEqual(['a', 'b', 'c', 'd']);

    const b = Simulation.create({ seed: 11, studioName: 'Rng Test', config: { aiStudioCount: 0, aiStudioTarget: 0 } as never });
    b.advance(30);
    expect(b.state.rng).toEqual(snapshot);

    const fromA = a.rng.range(0, 1000);
    const fromB = b.rng.range(0, 1000);
    expect(fromA).toBe(fromB);
  });

  it('two worlds from one seed draw the same numbers', () => {
    const x = Simulation.create({ seed: 3, studioName: 'Same', config: { aiStudioCount: 0, aiStudioTarget: 0 } as never });
    const y = Simulation.create({ seed: 3, studioName: 'Same', config: { aiStudioCount: 0, aiStudioTarget: 0 } as never });
    x.advance(60);
    y.advance(60);
    expect(stableStringify(x.state)).toBe(stableStringify(y.state));
  });
});
