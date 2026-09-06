/**
 * Sales system: weekly, applies to every game still on sale — player and AI alike.
 *
 * The launch week is frozen at release; every following week decays according to live
 * reception, word of mouth, price erosion and how much of the install base has already
 * bought in. Because revenue flows in week by week, a flop actually hurts cash flow.
 */

import { BALANCE } from '../data/balance';
import { yearFraction, type CalendarState } from '../core/calendar';
import { platformAudience } from '../data/platforms';
import { GENRES } from '../data/genres';
import { clamp } from '../core/math';
import type { ReleasedGame } from '../entities/game';
import { recommendedMarketingFor } from '../models/review-model';
import { demandConsumed, revenueFor, weeklyMultiplier, type SalesInput } from '../models/sales-model';
import { credit, emit } from '../operations';
import type { WorldState } from '../state/world';
import type { System, SystemContext } from './types';

/** Unit price decays with age — the budget bin is a real part of this industry. */
export function effectivePrice(game: ReleasedGame): number {
  if (game.weeksOnSale >= 78) return Math.round(game.price * 0.35 * 100) / 100;
  if (game.weeksOnSale >= 52) return Math.round(game.price * 0.55 * 100) / 100;
  if (game.weeksOnSale >= 26) return Math.round(game.price * 0.78 * 100) / 100;
  return game.price;
}

export function buildSalesInput(state: WorldState, game: ReleasedGame): SalesInput {
  const marketGenre = state.market.genres[game.genreId];
  const cal = state.calendar;
  return {
    genreId: game.genreId,
    platformId: game.platformId,
    scopeId: game.scope,
    quality: game.quality,
    reviewScore: game.reviewScore,
    receptionScore: game.reception.score,
    reputation: state.studios[game.studioId]?.reputation ?? 20,
    marketingSpend: game.marketingSpend,
    recommendedMarketing: recommendedMarketingFor(game.scope, game.platformId, state.studios[game.studioId]?.reputation ?? 20),
    audienceM: platformAudience(game.platformId, yearFraction(cal)),
    popularity: marketGenre?.popularity ?? 50,
    demand: marketGenre?.demand ?? 60,
    competition: marketGenre?.competition ?? 20,
    completeness: game.completeness,
    bugs: game.bugsAtRelease,
    genreStrength: state.studios[game.studioId]?.genreStrength[game.genreId] ?? 0,
    priceLevel: state.economy.priceLevel,
    awareness: 0.4,
  };
}

const MILESTONES = [5000, 10000, 25000, 50000, 100000, 250000, 500000, 1000000, 2500000, 5000000, 10000000];

function runWeek(state: WorldState, game: ReleasedGame): void {
  const studio = state.studios[game.studioId];
  const input = buildSalesInput(state, game);

  let units: number;
  if (game.weeksOnSale === 0) {
    units = game.openingUnits;
  } else {
    const prev = game.sales.length > 0 ? game.sales[game.sales.length - 1].units : game.openingUnits;
    const mult = weeklyMultiplier(input, game.weeksOnSale, game.unitsSold);
    units = Math.round(prev * mult);
  }
  units = Math.max(0, units);

  const money = revenueFor(units, { platformId: game.platformId, price: effectivePrice(game) });
  game.sales.push({ week: game.weeksOnSale + 1, units, revenue: money.netRevenue });
  if (game.sales.length > BALANCE.sales.maxWeeks + 8) game.sales.splice(0, game.sales.length - (BALANCE.sales.maxWeeks + 8));

  game.weeksOnSale += 1;
  game.unitsSold += units;
  game.revenue += money.netRevenue;
  game.grossRevenue += money.grossRevenue;
  game.peakWeeklyUnits = Math.max(game.peakWeeklyUnits, units);

  if (studio && money.netRevenue > 0) credit(state, studio, 'revenue', money.netRevenue);
  if (studio) studio.finances.lifetime.unitsSold += units;

  // Selling into a genre consumes its unsatisfied demand: real competition for money.
  const marketGenre = state.market.genres[game.genreId];
  if (marketGenre) {
    const drained = demandConsumed(units, input.audienceM, GENRES[game.genreId].audienceShare);
    marketGenre.demand = clamp(marketGenre.demand - drained, BALANCE.market.demandMin, BALANCE.market.demandMax);
  }

  if (studio?.isPlayer) {
    for (const threshold of MILESTONES) {
      if (game.unitsSold >= threshold && game.unitsSold - units < threshold) {
        emit(state, {
          category: 'finance',
          tone: 'positive',
          studioIds: [studio.id],
          title: `"${game.title}" passes ${formatUnits(threshold)} units sold`,
          detail: `${formatUnits(game.unitsSold)} lifetime units, ${formatMoney(game.revenue)} net revenue.`,
        });
        break;
      }
    }
  }

  const dying = units < Math.max(25, game.openingUnits * 0.015);
  if (game.weeksOnSale >= BALANCE.sales.maxWeeks || (dying && game.weeksOnSale > 4)) {
    game.status = 'retired';
    const cost = game.developmentCost + game.marketingSpend;
    game.roi = cost > 0 ? Math.round((game.revenue / cost) * 100) / 100 : 0;
    game.legacy = clamp((game.reviewScore - 55) / 45 + (game.unitsSold > 250000 ? 0.6 : 0) + (game.unitsSold > 1000000 ? 0.8 : 0), 0, 3);
    if (studio?.isPlayer) {
      const profit = game.revenue - cost;
      emit(state, {
        category: 'finance',
        tone: profit >= 0 ? 'positive' : 'negative',
        studioIds: [studio.id],
        title: `"${game.title}" is no longer selling`,
        detail: `${formatUnits(game.unitsSold)} units, ${profit >= 0 ? 'profit' : 'loss'} of ${formatMoney(Math.abs(profit))}.`,
      });
    }
  }
}

export function formatUnits(units: number): string {
  if (units >= 1_000_000) return `${(units / 1_000_000).toFixed(units >= 10_000_000 ? 1 : 2)}M`;
  if (units >= 1_000) return `${(units / 1_000).toFixed(units >= 100_000 ? 0 : 1)}k`;
  return String(Math.round(units));
}

export function formatMoney(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `$${(value / 1_000).toFixed(1)}k`;
  return `$${Math.round(value)}`;
}

export const salesSystem: System = {
  id: 'sales',
  order: 30,
  tick(ctx: SystemContext) {
    if (!ctx.cadence.weekEnd) return;
    const state: WorldState = ctx.state;
    for (const id of ctx.sortedIds(state.releases)) {
      const game = state.releases[id];
      if (!game || game.status !== 'selling') continue;
      runWeek(state, game);
    }
  },
};
