/**
 * Sales model (pure).
 *
 * One opening-week figure is computed from the market at release, then decayed weekly
 * with a word-of-mouth term. Because the same function is used for the player and every
 * AI studio, and because it consumes live market state (genre demand, competition,
 * install base), competitors genuinely take sales away from you.
 */

import { BALANCE } from '../data/balance';
import { GENRES } from '../data/genres';
import { platformDef } from '../data/platforms';
import { scopeDef } from '../data/scopes';
import type { GenreId, PlatformId, QualityDimensionId, ScopeId } from '../core/types';
import { clamp, saturate } from '../core/math';
import { bugSeverity } from './development-model';

export interface SalesInput {
  genreId: GenreId;
  platformId: PlatformId;
  scopeId: ScopeId;
  quality: Record<QualityDimensionId, number>;
  reviewScore: number;
  receptionScore: number;
  reputation: number;
  marketingSpend: number;
  recommendedMarketing: number;
  /** Install base in millions at the time of release. */
  audienceM: number;
  popularity: number;
  demand: number;
  competition: number;
  completeness: number;
  bugs: number;
  genreStrength: number;
  priceLevel: number;
  /** Marketing share of the audience that has actually seen the game (0..1). */
  awareness: number;
}

export interface SalesWeekResult {
  units: number;
  grossRevenue: number;
  netRevenue: number;
  unitPrice: number;
}

/** Retail price in dollars for a release. */
export function priceFor(scopeId: ScopeId, platformId: PlatformId, genreId: GenreId, priceLevel: number): number {
  const scope = scopeDef(scopeId);
  const platform = platformDef(platformId);
  const genre = GENRES[genreId];
  const raw = scope.price * platform.priceMult * genre.priceMult * (0.75 + 0.25 * priceLevel);
  return Math.round(clamp(raw, 4.99, 79.99) * 100) / 100;
}

/**
 * Opening-week unit sales.
 *
 *  audience  ×  genre pull  ×  appeal  ×  marketing/awareness  ×  reputation
 *            ×  competition penalty  ×  scope reach  ×  price elasticity
 */
export function openingUnits(input: SalesInput): number {
  const genre = GENRES[input.genreId];
  const scope = scopeDef(input.scopeId);
  const platform = platformDef(input.platformId);

  const audience = Math.max(0.05, input.audienceM) * 1_000_000;
  const interested = audience * genre.audienceShare * (platform.kind === 'handheld' ? 1.05 : 1);

  // Market pull: what the genre is worth right now, and how hungry buyers are.
  const popularity = Math.pow(clamp(input.popularity, 5, 110) / 60, 0.85);
  const demand = 0.55 + 0.7 * clamp(input.demand, 0, BALANCE.market.demandMax) / 100;

  // Appeal: a power curve, so quality swings revenue hard rather than nudging it.
  // Critic consensus and player reception both count; neither alone decides the outcome.
  const qualityPull = input.reviewScore * 0.55 + input.receptionScore * 0.45;
  // Steep enough that quality decides careers, shallow enough that a weak first game is
  // a setback rather than a death spiral.
  const appeal = clamp(Math.pow(qualityPull / 60, 1.5), 0.3, 3.0);

  // Marketing: reach and, more importantly, awareness of the game existing.
  const marketingRatio = input.recommendedMarketing > 0 ? input.marketingSpend / input.recommendedMarketing : 0;
  const spend = BALANCE.sales.marketingMinReach + (BALANCE.sales.marketingMaxReach - BALANCE.sales.marketingMinReach) * saturate(marketingRatio, 0.6);
  const awareness = 0.35 + 0.9 * clamp(input.awareness, 0, 1);

  // Reputation is a multiplier on discovery, most of all early in a career.
  const rep = 0.7 + 0.55 * saturate(input.reputation, 38);

  // Crowding: how much else shipped or is shipping in this genre/platform.
  const competition = 1 / (1 + input.competition / BALANCE.sales.competitionHalfPoint);

  const reach = scope.reachMult;

  // Price elasticity relative to the genre's comfort zone.
  const reference = scope.price * platform.priceMult * genre.priceMult;
  const price = priceFor(input.scopeId, input.platformId, input.genreId, input.priceLevel);
  const elasticity = Math.pow(clamp(reference / Math.max(1, price), 0.5, 1.8), 1.15);

  // Quality of life: broken or half-finished games stop selling after week one.
  const shipped = clamp(0.25 + 0.75 * input.completeness, 0, 1);
  const bugs = clamp(1 - bugSeverity(input.bugs, input.scopeId) * 0.35, 0.35, 1);

  const debut = 0.85 + input.genreStrength * 0.3;

  const units =
    interested *
    BALANCE.sales.baseConversion *
    popularity *
    demand *
    appeal *
    spend *
    awareness *
    rep *
    competition *
    reach *
    elasticity *
    shipped *
    bugs *
    debut;

  return Math.max(0, Math.round(units));
}

/**
 * Weekly decay multiplier. Good reception ⇒ long tail (and a word-of-mouth bump),
 * bad reception ⇒ a cliff.
 */
export function weeklyMultiplier(input: SalesInput, week: number, cumulativeUnits: number): number {
  const receptionSwing = (input.receptionScore - 60) * BALANCE.sales.receptionTailFactor;
  let decay = BALANCE.sales.baseWeeklyDecay + receptionSwing;
  if (week === 1 && input.reviewScore >= BALANCE.sales.wordOfMouthThreshold) {
    decay *= BALANCE.sales.wordOfMouthGain;
  }
  if (input.reviewScore < 32) decay *= 0.55;
  decay = clamp(decay, 0.25, 1.02);

  // Market saturation: you cannot sell forever into a fixed install base.
  const penetrationCap = Math.max(1000, input.audienceM * 1_000_000 * GENRES[input.genreId].audienceShare * 0.11);
  const headroom = clamp(1 - cumulativeUnits / penetrationCap, 0.05, 1);
  return decay * clamp(0.35 + 0.65 * headroom, 0.05, 1);
}

/** Convert units into money after platform royalties and manufacturing cost. */
export function revenueFor(units: number, input: { platformId: PlatformId; price: number }): SalesWeekResult {
  const platform = platformDef(input.platformId);
  const gross = units * input.price;
  const manufacturing = units * platform.unitCost;
  const royalty = gross * platform.licenseCut;
  const net = Math.max(0, gross - manufacturing - royalty);
  return {
    units,
    grossRevenue: Math.round(gross),
    netRevenue: Math.round(net),
    unitPrice: input.price,
  };
}

/**
 * Genre demand consumed by selling `units` into an install base of `audienceM` million.
 * Expressed as a share of the addressable audience so it behaves the same in 1990 and 2010.
 */
export function demandConsumed(units: number, audienceM: number, genreShare: number): number {
  const addressable = Math.max(1, audienceM * 1_000_000 * genreShare);
  return clamp((units / addressable) * BALANCE.sales.demandDrainScale, 0, 45);
}

/** Fast total-lifetime estimate (geometric series) for the UI and for AI decisions. */
export function estimateLifetimeUnits(input: SalesInput, weeks = 14): number {
  const opening = openingUnits(input);
  if (opening <= 0) return 0;
  const receptionSwing = (input.receptionScore - 60) * BALANCE.sales.receptionTailFactor;
  const decay = clamp(BALANCE.sales.baseWeeklyDecay + receptionSwing, 0.25, 1.02);
  let total = 0;
  let current = opening;
  for (let w = 0; w < weeks; w++) {
    total += current;
    current *= decay;
    if (current < 25) break;
  }
  return Math.round(total);
}

/**
 * Estimate used by the Create Game screen before a game exists.
 * Deliberately conservative: it uses an "expected quality" input rather than real reviews.
 */
export function estimatePerformance(params: {
  genreId: GenreId;
  platformId: PlatformId;
  scopeId: ScopeId;
  expectedQuality: number;
  reputation: number;
  marketing: number;
  audienceM: number;
  popularity: number;
  demand: number;
  competition: number;
  priceLevel: number;
}): { units: number; revenue: number; price: number; breakEvenUnits: number } {
  const recommended = params.marketing;
  const proxy: SalesInput = {
    genreId: params.genreId,
    platformId: params.platformId,
    scopeId: params.scopeId,
    quality: { gameplay: 0, graphics: 0, story: 0, audio: 0, innovation: 0, polish: 0 },
    reviewScore: params.expectedQuality,
    receptionScore: params.expectedQuality,
    reputation: params.reputation,
    marketingSpend: params.marketing,
    recommendedMarketing: recommended,
    audienceM: params.audienceM,
    popularity: params.popularity,
    demand: params.demand,
    competition: params.competition,
    completeness: 1,
    bugs: 0,
    genreStrength: 0.2,
    priceLevel: params.priceLevel,
    awareness: 0.35,
  };
  const units = estimateLifetimeUnits(proxy);
  const price = priceFor(params.scopeId, params.platformId, params.genreId, params.priceLevel);
  const rev = revenueFor(units, { platformId: params.platformId, price });
  const scope = scopeDef(params.scopeId);
  return {
    units,
    revenue: rev.netRevenue,
    price,
    breakEvenUnits: Math.ceil(scope.recommendedBudget / Math.max(1, price * 0.72)),
  };
}
