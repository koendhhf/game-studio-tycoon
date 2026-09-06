/**
 * Market system: monthly evolution of genre popularity, demand and competition.
 *
 * Popularity is a mean-reverting random walk with genre-specific volatility; demand is a
 * shared resource that releases consume and time refills; competition is computed from what
 * the whole industry (player included) actually has in development and on shelves.
 */

import { yearFraction } from '../core/calendar';
import { BALANCE } from '../data/balance';
import { GENRE_ORDER, GENRES } from '../data/genres';
import { PLATFORMS, PLATFORM_ORDER, industryAudienceFor, isPlatformAvailable, platformAudience } from '../data/platforms';
import { clamp } from '../core/math';
import type { Rng } from '../core/rng';
import { compareIds } from '../core/ids';
import { genreModifiers } from '../entities/market';
import type { MarketState } from '../entities/market';
import { allocateId, type WorldState } from '../state/world';
import { emit } from '../operations';

import type { System, SystemContext } from './types';

export function activeProjectsInGenre(state: WorldState, genreId: string): number {
  let count = 0;
  for (const id of Object.keys(state.projects).sort(compareIds)) {
    const p = state.projects[id];
    if (!p) continue;
    if (p.genreId !== genreId) continue;
    if (p.status === 'released' || p.status === 'cancelled') continue;
    if (state.studios[p.studioId]?.status !== 'active') continue;
    count += 1;
  }
  return count;
}

export function recentReleasesInGenre(state: WorldState, genreId: string, days: number): number {
  let count = 0;
  const cutoff = state.calendar.tick - days;
  for (const id of Object.keys(state.releases).sort(compareIds)) {
    const g = state.releases[id];
    if (g && g.genreId === genreId && g.releaseTick >= cutoff) count += 1;
  }
  return count;
}

function refreshAudience(state: WorldState): void {
  state.market.industryAudience = industryAudienceFor(yearFraction(state.calendar));
}

function applyMonthlyGenre(state: WorldState, market: MarketState, genreId: (typeof GENRE_ORDER)[number], rng: Rng): void {
  const genre = GENRES[genreId];
  const m = market.genres[genreId];
  if (!genre || !m) return;
  const cal = state.calendar;
  const mods = genreModifiers(market, genreId, cal.monthIndex);

  const projects = activeProjectsInGenre(state, genreId);
  const recent = recentReleasesInGenre(state, genreId, BALANCE.market.competitionDecayDays);
  m.competition = clamp(
    projects * BALANCE.market.competitionPerProject + recent * BALANCE.market.competitionPerRecentRelease - 6,
    0,
    100,
  );

  // Oversupply sours buyers a little; a hit refreshes them.
  m.fatigue = clamp(m.fatigue + recent * 1.1 - 3.5, 0, 30);

  const target = genre.basePopularity + mods.popAdd - m.fatigue * 0.35 - m.competition * 0.035;
  const drift = rng.next() * 2 - 1;
  m.popularity = clamp(
    m.popularity + (target - m.popularity) * BALANCE.market.popularityReversion + drift * genre.volatility * BALANCE.market.popularityDrift * 0.5,
    BALANCE.market.popularityMin + mods.popAdd * 0.5,
    BALANCE.market.popularityMax + Math.max(0, mods.popAdd),
  );

  const regen = BALANCE.market.demandRegen * (0.55 + m.popularity / 140) * (1 + market.industryAudience / 260);
  m.demand = clamp(m.demand + regen * 0.55 + mods.demandAdd, BALANCE.market.demandMin, BALANCE.market.demandMax);

  m.history.push(Math.round(m.popularity));
  if (m.history.length > 84) m.history.shift();
  if (cal.month % 3 === 0) m.popularityQuarterAgo = m.popularity;
}

/** Occasional industry news that moves the market for a while. */
function rollMarketEvents(state: WorldState, ctx: SystemContext): void {
  const market = state.market;
  const rng = ctx.rng;
  market.modifiers = market.modifiers.filter((mod) => mod.expiresMonthIndex > state.calendar.monthIndex);
  if (!rng.chance(BALANCE.market.eventChance)) return;

  const kind = rng.weighted([40, 30, 18, 12]);
  const months = rng.int(4, 9);
  const expire = state.calendar.monthIndex + months;

  if (kind === 0) {
    const genreId = rng.pick(GENRE_ORDER);
    const amount = rng.range(9, 17);
    market.modifiers.push({
      id: allocateId(state, 'mod'),
      kind: 'genrePopularity',
      targetId: genreId,
      amount,
      factor: 1,
      expiresMonthIndex: expire,
      label: `${GENRES[genreId].name} craze`,
    });
    emit(state, {
      category: 'market',
      tone: 'positive',
      title: `${GENRES[genreId].name} is the genre everyone wants`,
      detail: `Retailers are reordering shelf space for ${GENRES[genreId].name.toLowerCase()} titles. Expect ${Math.round(months)} months of heat.`,
    });
  } else if (kind === 1) {
    const genreId = rng.pick(GENRE_ORDER);
    market.modifiers.push({
      id: allocateId(state, 'mod'),
      kind: 'genrePopularity',
      targetId: genreId,
      amount: -rng.range(7, 13),
      factor: 1,
      expiresMonthIndex: expire,
      label: `${GENRES[genreId].name} fatigue`,
    });
    emit(state, {
      category: 'market',
      tone: 'negative',
      title: `Buyers are tiring of ${GENRES[genreId].name.toLowerCase()}`,
      detail: `Too many similar releases. The shelf is crowded and the reviews are bored.`,
    });
  } else if (kind === 2) {
    const live = PLATFORM_ORDER.filter((id) => isPlatformAvailable(id, state.calendar.year));
    if (live.length === 0) return;
    const platformId = rng.pick(live);
    const factor = rng.range(1.05, 1.22);
    market.modifiers.push({
      id: allocateId(state, 'mod'),
      kind: 'platformAudience',
      targetId: platformId,
      amount: 0,
      factor,
      expiresMonthIndex: expire,
      label: `${PLATFORMS[platformId].name} price cut`,
    });
    emit(state, {
      category: 'market',
      tone: 'positive',
      title: `${PLATFORMS[platformId].name} gets a price cut`,
      detail: `Hardware bundles are moving; expect a wider audience for ${PLATFORMS[platformId].name} software.`,
    });
  } else {
    const live = PLATFORM_ORDER.filter((id) => isPlatformAvailable(id, state.calendar.year));
    if (live.length === 0) return;
    const platformId = rng.pick(live);
    market.modifiers.push({
      id: allocateId(state, 'mod'),
      kind: 'platformAudience',
      targetId: platformId,
      amount: 0,
      factor: rng.range(0.82, 0.94),
      expiresMonthIndex: expire,
      label: `${PLATFORMS[platformId].name} shortage`,
    });
    emit(state, {
      category: 'market',
      tone: 'negative',
      title: `Distribution crunch hits ${PLATFORMS[platformId].name}`,
      detail: `Shelf space and cartridges are tight. Sales on that machine will lag for a while.`,
    });
  }
}

export const marketSystem: System = {
  id: 'market',
  order: 40,
  tick(ctx: SystemContext) {
    if (!ctx.cadence.monthStart) return;
    const state = ctx.state;
    const market = state.market;
    market.lastUpdatedMonthIndex = state.calendar.monthIndex;

    refreshAudience(state);
    for (const genreId of GENRE_ORDER) applyMonthlyGenre(state, market, genreId, ctx.rng);
    rollMarketEvents(state, ctx);

    if (ctx.cadence.yearStart) {
      market.industryAudienceLastYear = market.industryAudience;
      const growth = market.industryAudienceLastYear > 0 ? market.industryAudience / market.industryAudienceLastYear - 1 : 0;
      if (Math.abs(growth) > 0.02) {
        emit(state, {
          category: 'market',
          tone: growth > 0 ? 'positive' : 'negative',
          title: `Industry install base ${growth > 0 ? 'grew' : 'shrank'} ${(Math.abs(growth) * 100).toFixed(1)}% over the year`,
          detail: `Total reachable audience across live platforms is now ${market.industryAudience.toFixed(1)}M machines.`,
        });
      }
    }
  },
};
