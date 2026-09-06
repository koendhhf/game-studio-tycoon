/**
 * Market state: per-genre popularity / demand / competition, plus transient
 * modifiers (platform launches, genre crazes). Everything is plain data so the
 * market can be snapshotted, saved and diffed cheaply.
 */

import type { GenreId } from '../core/types';
import { GENRE_ORDER } from '../data/genres';
import { GENRES } from '../data/genres';
import { industryAudienceFor } from '../data/platforms';
import { clamp } from '../core/math';
import { BALANCE } from '../data/balance';

export type TrendDirection = 'rising' | 'falling' | 'flat';

export interface GenreMarketState {
  genreId: GenreId;
  /** 0..100 — how much attention the genre has right now. */
  popularity: number;
  /** 0..130 — unsatisfied appetite. Drained by releases, refilled monthly. */
  demand: number;
  /** 0..100 — supply pressure from concurrent projects and recent releases. */
  competition: number;
  /** Popularity one quarter ago, for trend arrows. */
  popularityQuarterAgo: number;
  /** Monthly popularity history (capped length) for charts. */
  history: number[];
  /** Saturation from too many releases of the same genre back to back. */
  fatigue: number;
}

export interface MarketModifier {
  id: string;
  kind: 'genrePopularity' | 'genreDemand' | 'platformAudience';
  targetId: string;
  /** Additive delta applied while active. */
  amount: number;
  /** Multiplicative factor applied while active. */
  factor: number;
  expiresMonthIndex: number;
  label: string;
}

export interface MarketState {
  genres: Record<GenreId, GenreMarketState>;
  modifiers: MarketModifier[];
  /** Combined install base of every live platform, in millions. */
  industryAudience: number;
  industryAudienceLastYear: number;
  /** Id of the current "it" game, shown on the dashboard. */
  talkingAboutReleaseId: string | null;
  talkingAboutLabel: string;
  lastUpdatedMonthIndex: number;
}

export function createMarketState(startYear: number, seed: number, rand: (key: string) => number): MarketState {
  const genres = {} as Record<GenreId, GenreMarketState>;
  for (const id of GENRE_ORDER) {
    const def = GENRES[id];
    const jitter = (rand(`pop-${id}`) - 0.5) * 12;
    const popularity = clamp(def.basePopularity + jitter, BALANCE.market.popularityMin, 92);
    genres[id] = {
      genreId: id,
      popularity,
      demand: clamp(BALANCE.market.demandMax - popularity * 0.35 + (rand(`dem-${id}`) - 0.5) * 20, 40, BALANCE.market.demandMax),
      competition: 12 + Math.round(rand(`comp-${id}`) * 18),
      popularityQuarterAgo: popularity,
      history: Array.from({ length: 3 }, () => Math.round(popularity)),
      fatigue: 0,
    };
  }
  void seed;
  return {
    genres,
    modifiers: [],
    // Known from day one: the hiring market and the Industry screen both read this.
    industryAudience: industryAudienceFor(startYear),
    industryAudienceLastYear: 0,
    talkingAboutReleaseId: null,
    talkingAboutLabel: '',
    lastUpdatedMonthIndex: 0,
  };
}

export function genreMarket(state: MarketState, genreId: GenreId): GenreMarketState {
  return state.genres[genreId];
}

export function trendOf(genre: GenreMarketState): TrendDirection {
  const delta = genre.popularity - genre.popularityQuarterAgo;
  if (delta > 3) return 'rising';
  if (delta < -3) return 'falling';
  return 'flat';
}

/** Combined additive/multiplicative effect of active modifiers on a genre. */
export function genreModifiers(market: MarketState, genreId: GenreId, monthIndex: number): { popAdd: number; demandAdd: number } {
  let popAdd = 0;
  let demandAdd = 0;
  for (const mod of market.modifiers) {
    if (mod.expiresMonthIndex <= monthIndex) continue;
    if (mod.targetId !== genreId) continue;
    if (mod.kind === 'genrePopularity') popAdd += mod.amount * mod.factor;
    if (mod.kind === 'genreDemand') demandAdd += mod.amount * mod.factor;
  }
  return { popAdd, demandAdd };
}

export function platformAudienceModifier(market: MarketState, platformId: string, monthIndex: number): number {
  let factor = 1;
  for (const mod of market.modifiers) {
    if (mod.expiresMonthIndex <= monthIndex) continue;
    if (mod.kind !== 'platformAudience' || mod.targetId !== platformId) continue;
    factor *= mod.factor;
  }
  return factor;
}
