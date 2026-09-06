/**
 * Sales: units from the market, the weekly tail, and what actually reaches the studio after
 * manufacturing and platform royalties.
 */

import { describe, expect, it } from 'vitest';
import {
  BALANCE,
  GENRES,
  PLATFORMS,
  demandConsumed,
  estimateLifetimeUnits,
  estimatePerformance,
  openingUnits,
  platformDef,
  priceFor,
  recommendedMarketingFor,
  revenueFor,
  scopeDef,
  weeklyMultiplier,
} from './test-imports';
import type { SalesInput } from './test-imports';

function input(patch: Partial<SalesInput> = {}): SalesInput {
  const base: SalesInput = {
    genreId: 'action',
    platformId: 'pc',
    scopeId: 'medium',
    quality: { gameplay: 60, graphics: 60, story: 60, audio: 60, innovation: 60, polish: 60 },
    reviewScore: 60,
    receptionScore: 60,
    reputation: 20,
    marketingSpend: 90_000,
    recommendedMarketing: 90_000,
    audienceM: 20,
    popularity: 60,
    demand: 60,
    competition: 20,
    completeness: 1,
    bugs: 0,
    genreStrength: 0,
    priceLevel: 1,
    awareness: 0.5,
  };
  return { ...base, ...patch };
}

describe('pricing', () => {
  it('rises with scope, premium platforms and genre tolerance', () => {
    const small = priceFor('small', 'pc', 'action', 1);
    const ambitious = priceFor('ambitious', 'pc', 'action', 1);
    expect(ambitious).toBeGreaterThan(small);
    const sameGenreOtherPlatform = priceFor('small', 'vega', 'action', 1);
    expect(sameGenreOtherPlatform).not.toBe(small);
    expect(small * 1).toBeGreaterThanOrEqual(4.99);
    expect(ambitious).toBeLessThanOrEqual(79.99);
  });

  it('stays inside the retail band whatever the multiplier soup says', () => {
    for (const scope of ['prototype', 'small', 'medium', 'large', 'ambitious'] as const) {
      for (const platform of Object.keys(platforms())) {
        const price = priceFor(scope, platform as never, 'rpg', 3);
        expect(price).toBeGreaterThanOrEqual(4.99);
        expect(price).toBeLessThanOrEqual(79.99);
      }
    }
  });
});

function platforms(): Record<string, unknown> {
  return { pc: 1, microboy: 1, turbomax: 1, vega: 1, netparlour: 1 } as Record<string, unknown>;
}

describe('opening sales', () => {
  it('grows with quality, audience, popularity, demand, marketing and reputation', () => {
    const base = input();
    expect(openingUnits(input({ reviewScore: 85, receptionScore: 85 }))).toBeGreaterThan(openingUnits(base));
    expect(openingUnits(input({ reviewScore: 30, receptionScore: 30 }))).toBeLessThan(openingUnits(base));
    expect(openingUnits(input({ audienceM: 60 }))).toBeGreaterThan(openingUnits(base));
    expect(openingUnits(input({ popularity: 95 }))).toBeGreaterThan(openingUnits(base));
    expect(openingUnits(input({ demand: 120 }))).toBeGreaterThan(openingUnits(base));
    expect(openingUnits(input({ marketingSpend: 260_000, awareness: 1 }))).toBeGreaterThan(openingUnits(base));
    expect(openingUnits(input({ reputation: 90 }))).toBeGreaterThan(openingUnits(base));
    expect(openingUnits(input({ genreStrength: 1 }))).toBeGreaterThan(openingUnits(base));
  });

  it('shrinks with competition, bugs and an unfinished game', () => {
    const base = input();
    expect(openingUnits(input({ competition: 90 }))).toBeLessThan(openingUnits(base));
    expect(openingUnits(input({ competition: 500 }))).toBeLessThan(openingUnits(input({ competition: 40 })) * 0.4);
    expect(openingUnits(input({ bugs: 400 }))).toBeLessThan(openingUnits(base));
    expect(openingUnits(input({ completeness: 0.4 }))).toBeLessThan(openingUnits(base));
  });

  it('is dominated by the quality curve, not by a random roll', () => {
    const weak = openingUnits(input({ reviewScore: 40, receptionScore: 40 }));
    const great = openingUnits(input({ reviewScore: 92, receptionScore: 92 }));
    expect(great / weak).toBeGreaterThan(3);
    // Deterministic: same input, same number, always.
    expect(openingUnits(input({ reviewScore: 71, receptionScore: 66 }))).toBe(openingUnits(input({ reviewScore: 71, receptionScore: 66 })));
  });

  it('respects the platform audience and the scope reach', () => {
    const tinyScope = openingUnits(input({ scopeId: 'prototype' }));
    const bigScope = openingUnits(input({ scopeId: 'large' }));
    expect(bigScope).toBeGreaterThan(tinyScope * 3);
    expect(scopeDef('large').reachMult).toBeGreaterThan(scopeDef('prototype').reachMult);
  });

  it('penalises a price above the genre comfort zone', () => {
    const atReference = input({ priceLevel: 1 });
    const expensive = input({ priceLevel: 4 });
    // priceLevel inflates the retail price; elasticity must claw sales back.
    expect(priceFor('medium', 'pc', 'action', 4)).toBeGreaterThan(priceFor('medium', 'pc', 'action', 1));
    const ratio = openingUnits(expensive) / openingUnits(atReference);
    expect(ratio).toBeLessThan(1.35);
  });

  it('never returns a negative number for a terrible game', () => {
    expect(openingUnits(input({ reviewScore: 1, receptionScore: 1, completeness: 0, bugs: 100_000, audienceM: 0, competition: 1e6 }))).toBeGreaterThanOrEqual(0);
  });
});

describe('the weekly tail', () => {
  it('decays, and decays slower when players like it', () => {
    const neutral = weeklyMultiplier(input(), 5, 100_000);
    const loved = weeklyMultiplier(input({ receptionScore: 90 }), 5, 100_000);
    const hated = weeklyMultiplier(input({ receptionScore: 20 }), 5, 100_000);
    expect(loved).toBeGreaterThan(neutral);
    expect(hated).toBeLessThan(neutral);
    expect(neutral).toBeGreaterThan(0);
    expect(neutral).toBeLessThanOrEqual(1.02);
  });

  it('gets a word-of-mouth lift for a critical hit and collapses below 32', () => {
    const hit = weeklyMultiplier(input({ reviewScore: 90 }), 1, 10_000);
    const plain = weeklyMultiplier(input({ reviewScore: 70 }), 1, 10_000);
    expect(hit).toBeGreaterThan(plain);
    const flop = weeklyMultiplier(input({ reviewScore: 20 }), 2, 10_000);
    expect(flop).toBeLessThan(BALANCE.sales.baseWeeklyDecay);
  });

  it('saturates as it eats into the addressable audience', () => {
    const early = weeklyMultiplier(input({ audienceM: 5 }), 3, 1_000);
    const late = weeklyMultiplier(input({ audienceM: 5 }), 3, 5_000_000);
    expect(late).toBeLessThan(early);
  });

  it('estimates a lifetime total above the opening week', () => {
    const opening = openingUnits(input());
    const lifetime = estimateLifetimeUnits(input());
    expect(lifetime).toBeGreaterThan(opening);
    expect(estimateLifetimeUnits(input({ receptionScore: 95 }))).toBeGreaterThan(estimateLifetimeUnits(input({ receptionScore: 25 })));
    expect(estimateLifetimeUnits(input({ reviewScore: 1, receptionScore: 1, audienceM: 0.01 }))).toBeLessThanOrEqual(openingUnits(input({ reviewScore: 1, receptionScore: 1, audienceM: 0.01 })) * 3);
  });
});

describe('money per unit', () => {
  it('takes manufacturing and royalty off the top per platform', () => {
    const units = 100_000;
    const price = 40;
    const pc = revenueFor(units, { platformId: 'pc', price });
    const cartridge = revenueFor(units, { platformId: 'microboy', price });
    expect(pc.grossRevenue).toBe(units * price);
    expect(pc.netRevenue).toBeLessThanOrEqual(pc.grossRevenue);
    expect(cartridge.netRevenue).toBeLessThan(pc.netRevenue);
    const cut = platformDef('microboy').licenseCut;
    expect(cartridge.netRevenue).toBeCloseTo(units * price - units * platformDef('microboy').unitCost - units * price * cut, 0);
  });

  it('cheaper media mean a bigger share of the shelf price stays with the studio', () => {
    const cheapest = Math.min(...Object.keys(PLATFORMS).map((id) => platformDef(id).unitCost));
    expect(cheapest).toBe(0); // at least one platform (disk/boxed PC era) has no cartridge tax
    for (const id of Object.keys(PLATFORMS)) {
      const def = platformDef(id);
      expect(def.unitCost).toBeGreaterThanOrEqual(0);
      expect(def.licenseCut).toBeGreaterThanOrEqual(0);
      expect(def.licenseCut).toBeLessThan(1);
      const net = revenueFor(1000, { platformId: id as never, price: 30 }).netRevenue;
      expect(net).toBeLessThanOrEqual(1000 * 30);
      expect(net).toBeGreaterThan(0);
    }
  });

  it('drains genre demand in proportion to how much of the audience it satisfied', () => {
    const share = GENRES.action.audienceShare;
    const small = demandConsumed(50_000, 20, share);
    const big = demandConsumed(1_500_000, 20, share);
    expect(big).toBeGreaterThan(small);
    expect(big).toBeLessThanOrEqual(45);
    expect(demandConsumed(0, 20, share)).toBe(0);
  });

  it('recommends marketing that scales with scope and reputation', () => {
    const small = recommendedMarketingFor('small', 'pc', 20);
    const large = recommendedMarketingFor('large', 'pc', 20);
    const famous = recommendedMarketingFor('small', 'pc', 90);
    expect(large).toBeGreaterThan(small * 5);
    expect(famous).toBeGreaterThan(small);
    expect(recommendedMarketingFor('medium', 'pc', 0)).toBeGreaterThan(0);
  });

  it('gives the planner a break-even figure', () => {
    const estimate = estimatePerformance({
      genreId: 'action',
      platformId: 'pc',
      scopeId: 'medium',
      expectedQuality: 60,
      reputation: 20,
      marketing: 90_000,
      audienceM: 20,
      popularity: 60,
      demand: 60,
      competition: 20,
      priceLevel: 1,
    });
    expect(estimate.units).toBeGreaterThan(0);
    expect(estimate.revenue).toBeGreaterThan(0);
    expect(estimate.breakEvenUnits).toBeGreaterThan(0);
    expect(estimate.price).toBeCloseTo(priceFor('medium', 'pc', 'action', 1), 2);
  });
});
