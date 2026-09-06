/**
 * Project scope. Scope is the single most consequential choice in Phase 1: it
 * sets how much work is required, how much budget is needed, how high quality can
 * climb, and how unforgiving the market is of an unfinished product.
 */

import type { ScopeId } from '../core/types';

export interface ScopeDef {
  id: ScopeId;
  name: string;
  blurb: string;
  /** Work units required (1 unit ~= one average employee-day). */
  workUnits: number;
  /** Recommended budget in dollars for the scope. */
  recommendedBudget: number;
  /** Ceiling on quality dimensions before budget and polish adjust it. */
  qualityCap: number;
  /** Bug pressure multiplier. */
  bugMult: number;
  /** Base retail price. */
  price: number;
  /** Market expectations multiplier (a small game in a big genre is judged gently). */
  expectationMult: number;
  /** Reputation swing multiplier on release. */
  repMult: number;
  /** Multiplier on how much revenue a release can realistically reach. */
  reachMult: number;
  /** Marketing spend that counts as "full reach" for this scope. */
  marketingBase: number;
  /** Minimum sensible team size (used by UI + AI staffing). */
  minTeam: number;
  /** Team size beyond this yields diminishing throughput. */
  optimalTeam: number;
}

export const SCOPES: Record<ScopeId, ScopeDef> = {
  prototype: {
    id: 'prototype',
    name: 'Prototype',
    blurb: 'A few weeks of work. Cheap, low expectations, rarely profitable.',
    workUnits: 100,
    recommendedBudget: 18000,
    qualityCap: 46,
    bugMult: 0.8,
    price: 9.99,
    expectationMult: 0.5,
    repMult: 0.45,
    reachMult: 0.34,
    marketingBase: 7000,
    minTeam: 1,
    optimalTeam: 3,
  },
  small: {
    id: 'small',
    name: 'Small',
    blurb: 'A focused retail-grade release with a short production.',
    workUnits: 340,
    recommendedBudget: 60000,
    qualityCap: 62,
    bugMult: 1.0,
    price: 19.99,
    expectationMult: 0.75,
    repMult: 0.8,
    reachMult: 0.62,
    marketingBase: 18000,
    minTeam: 2,
    optimalTeam: 6,
  },
  medium: {
    id: 'medium',
    name: 'Medium',
    blurb: 'The studio staple: a full game with real production value.',
    workUnits: 1000,
    recommendedBudget: 230000,
    qualityCap: 76,
    bugMult: 1.2,
    price: 29.99,
    expectationMult: 1.0,
    repMult: 1.0,
    reachMult: 1.0,
    marketingBase: 95000,
    minTeam: 4,
    optimalTeam: 12,
  },
  large: {
    id: 'large',
    name: 'Large',
    blurb: 'Retail push with marketing weight behind it. Expensive to fail.',
    workUnits: 4500,
    recommendedBudget: 1150000,
    qualityCap: 86,
    bugMult: 1.45,
    price: 39.99,
    expectationMult: 1.35,
    repMult: 1.4,
    reachMult: 1.75,
    marketingBase: 330000,
    minTeam: 8,
    optimalTeam: 24,
  },
  ambitious: {
    id: 'ambitious',
    name: 'Ambitious',
    blurb: 'A statement project. Huge ceiling, brutal expectations, can sink a studio.',
    workUnits: 9500,
    recommendedBudget: 2600000,
    qualityCap: 94,
    bugMult: 1.7,
    price: 49.99,
    expectationMult: 1.8,
    repMult: 2.0,
    reachMult: 2.8,
    marketingBase: 820000,
    minTeam: 12,
    optimalTeam: 40,
  },
};

export const SCOPE_ORDER: readonly ScopeId[] = ['prototype', 'small', 'medium', 'large', 'ambitious'];

export function scopeDef(id: ScopeId): ScopeDef {
  return SCOPES[id];
}

/** Rough monthly burn for a project at this scope, used by budget estimation. */
export function scopeMonthlyBurn(id: ScopeId): number {
  const def = scopeDef(id);
  return Math.round((def.recommendedBudget / (def.workUnits / 22)) * 1);
}
