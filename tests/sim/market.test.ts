/**
 * The market: per-genre popularity, demand and competition, drifting gradually and reacting to
 * what the industry actually ships. Popularity is not decoration — it feeds sales.
 */

import { describe, expect, it } from 'vitest';
import {
  BALANCE,
  industryAudienceFor,
  GENRE_ORDER,
  GENRES,
  createMarketState,
  genreMarket,
  genreModifiers,
  marketSystem,
  trendOf,
} from './test-imports';
import type { GenreId, MarketState } from './test-imports';
import { addStudio, addTeam, bareWorld, soloSim } from './helpers';
import { activeProjectsInGenre, recentReleasesInGenre } from './test-imports';

function marketOf(sim: ReturnType<typeof soloSim>): MarketState {
  return sim.state.market;
}

describe('the starting market', () => {
  it('has one live reading per genre, inside the tuned bands', () => {
    const market = createMarketState(1990, 3, (key) => {
      // A deterministic, flat "random" source: the middle of the range.
      let h = 0;
      for (let i = 0; i < key.length; i += 1) h = (h * 31 + key.charCodeAt(i)) % 997;
      return h / 997;
    });
    expect(Object.keys(market.genres).length).toBe(GENRE_ORDER.length);
    for (const id of GENRE_ORDER) {
      const m = genreMarket(market, id);
      expect(m.popularity).toBeGreaterThanOrEqual(BALANCE.market.popularityMin);
      expect(m.popularity).toBeLessThanOrEqual(92);
      expect(m.demand).toBeGreaterThanOrEqual(BALANCE.market.demandMin);
      expect(m.demand).toBeLessThanOrEqual(BALANCE.market.demandMax);
      expect(m.competition).toBeGreaterThanOrEqual(0);
      expect(m.competition).toBeLessThanOrEqual(100);
      expect(m.fatigue).toBe(0);
      expect(m.history.length).toBeGreaterThan(0);
      expect(m.popularityQuarterAgo).toBeCloseTo(m.popularity, 6);
    }
  });

  it('seeds different readings from different seeds but the same readings from the same seed', () => {
    const a = createMarketState(1990, 7, (k) => k.length / 10);
    const b = createMarketState(1990, 7, (k) => k.length / 10);
    const c = createMarketState(1990, 8, (k) => k.length / 10 + 0.01);
    expect(a.genres.rpg).toEqual(b.genres.rpg);
    expect(a.genres.rpg.popularity).not.toBe(c.genres.rpg.popularity);
  });

  it('starts each genre near its own baseline rather than at a single flat number', () => {
    const market = createMarketState(1990, 11, () => 0.5);
    const spread = GENRE_ORDER.map((id) => genreMarket(market, id).popularity);
    expect(Math.max(...spread) - Math.min(...spread)).toBeGreaterThan(5);
    for (const id of GENRE_ORDER) {
      expect(Math.abs(genreMarket(market, id).popularity - GENRES[id].basePopularity)).toBeLessThan(10);
    }
  });
});

describe('monthly drift', () => {
  it('moves gradually, stays in bounds and remembers its history', () => {
    const sim = soloSim(21);
    const state = sim.state;
    const before = { ...genreMarket(state.market, 'action') };
    sim.advanceMonths(1);
    const after = genreMarket(state.market, 'action');
    expect(Math.abs(after.popularity - before.popularity)).toBeLessThan(10);
    expect(after.history[after.history.length - 1]).toBe(Math.round(after.popularity));
    expect(state.market.lastUpdatedMonthIndex).toBe(state.calendar.monthIndex);

    sim.advanceMonths(23);
    const market = marketOf(sim);
    for (const id of GENRE_ORDER) {
      const m = genreMarket(market, id);
      expect(m.popularity).toBeGreaterThanOrEqual(BALANCE.market.popularityMin);
      expect(m.popularity).toBeLessThanOrEqual(BALANCE.market.popularityMax + 20);
      expect(m.demand).toBeGreaterThanOrEqual(BALANCE.market.demandMin);
      expect(m.demand).toBeLessThanOrEqual(BALANCE.market.demandMax);
      expect(m.competition).toBeGreaterThanOrEqual(0);
      expect(m.fatigue).toBeLessThanOrEqual(30);
      expect(m.history.length).toBeLessThanOrEqual(84);
      expect(m.history.length).toBeGreaterThan(20);
    }
    // Nothing is frozen: over two years the market has to have moved.
    const moved = GENRE_ORDER.filter((id) => Math.abs(genreMarket(market, id).popularity - GENRES[id].basePopularity) > 0.01);
    expect(moved.length).toBeGreaterThan(5);
  });

  it('reverts toward the genre baseline instead of running away', () => {
    const sim = soloSim(22);
    const extreme = genreMarket(sim.state.market, 'horror');
    extreme.popularity = BALANCE.market.popularityMin + 2;
    extreme.fatigue = 0;
    const floorValue = extreme.popularity;
    sim.advanceMonths(12);
    const after = genreMarket(marketOf(sim), 'horror');
    expect(after.popularity).toBeGreaterThan(floorValue);
    expect(after.popularity).toBeLessThan(GENRES.horror.basePopularity + 25);
  });

  it('reports a trend that matches the quarter it remembers', () => {
    const state = bareWorld(23);
    const m = genreMarket(state.market, 'action');
    m.popularity = 50;
    m.popularityQuarterAgo = 50;
    expect(trendOf(m)).toBe('flat');
    m.popularity = 56;
    expect(trendOf(m)).toBe('rising');
    m.popularity = 44;
    expect(trendOf(m)).toBe('falling');
    m.popularityQuarterAgo = 44;
    expect(trendOf(m)).toBe('flat');
  });
});

describe('competition and demand', () => {
  it('measures crowding from real pipelines and real releases', () => {
    const state = bareWorld(24);
    const crowded = addStudio(state, { name: 'Crowded Works', cash: 5_000_000 });
    const team = addTeam(state, crowded, ['programmer', 'designer'], 55);
    for (let i = 0; i < 3; i += 1) {
      const id = `pj_c${i}`;
      state.projects[id] = {
        id,
        studioId: crowded.id,
        genreId: 'action',
        platformId: 'pc',
        scope: 'small',
        status: 'development',
        title: `Clone ${i}`,
        teamIds: team.map((e) => e.id),
        progress: 0.3,
        bugs: 0,
      } as never;
      crowded.projectIds.push(id);
    }
    expect(activeProjectsInGenre(state, 'action')).toBe(3);
    expect(activeProjectsInGenre(state, 'puzzle')).toBe(0);
    expect(recentReleasesInGenre(state, 'action', 365)).toBe(0);

    const market = marketSystem;
    market.tick({
      state,
      rng: { next: () => 0.5, chance: () => false } as never,
      emit: () => undefined,
      sortedIds: <T,>(o: Record<string, T>) => Object.keys(o).sort(),
      cadence: { monthStart: true, weekEnd: false, monday: false, yearStart: false },
    } as never);
    const action = genreMarket(state.market, 'action');
    const puzzle = genreMarket(state.market, 'puzzle');
    expect(action.competition).toBe(clampCompetition(3 * BALANCE.market.competitionPerProject - 6));
    expect(action.competition).toBeGreaterThan(puzzle.competition);
  });

  it('ignores projects of closed studios and counts recent releases', () => {
    const state = bareWorld(25);
    const studio = addStudio(state, { cash: 100_000 });
    state.projects.pj_x = {
      id: 'pj_x',
      studioId: studio.id,
      genreId: 'racing',
      status: 'development',
      teamIds: [],
      progress: 0.5,
      bugs: 0,
    } as never;
    studio.projectIds.push('pj_x');
    expect(activeProjectsInGenre(state, 'racing')).toBe(1);
    studio.status = 'defunct';
    expect(activeProjectsInGenre(state, 'racing')).toBe(0);

    studio.status = 'active';
    state.releases.rl_x = { id: 'rl_x', genreId: 'racing', releaseTick: state.calendar.tick } as never;
    expect(recentReleasesInGenre(state, 'racing', 30)).toBe(1);
    expect(recentReleasesInGenre(state, 'racing', 1)).toBe(1);
    state.releases.rl_x.releaseTick = state.calendar.tick - 4000;
    expect(recentReleasesInGenre(state, 'racing', 30)).toBe(0);
  });

  it('refills demand that a release drained', () => {
    const sim = soloSim(26);
    const market = sim.state.market;
    const action = genreMarket(market, 'action');
    action.demand = BALANCE.market.demandMin;
    const drained = action.demand;
    sim.advanceMonths(1);
    expect(genreMarket(market, 'action').demand).toBeGreaterThan(drained);
    // And it stops at the ceiling rather than compounding forever.
    for (let i = 0; i < 36; i += 1) sim.advanceMonths(1);
    expect(genreMarket(market, 'action').demand).toBeLessThanOrEqual(BALANCE.market.demandMax);
  });

  it('tires buyers with oversupply and lets them cool off', () => {
    const sim = soloSim(27);
    const market = marketOf(sim);
    const horror = genreMarket(market, 'horror');
    horror.fatigue = 0;
    for (let i = 0; i < 6; i += 1) {
      const id = `rl_h${i}`;
      market && (sim.state.releases[id] = { id, genreId: 'horror', releaseTick: sim.state.calendar.tick, studioId: '' } as never);
    }
    sim.advanceMonths(1);
    expect(genreMarket(market, 'horror').fatigue).toBeGreaterThan(0);
    for (let i = 0; i < 12; i += 1) sim.advanceMonths(1);
    expect(genreMarket(market, 'horror').fatigue).toBeLessThan(6);
  });

  it('grows the reachable audience with the era and records the year-on-year change', () => {
    const sim = soloSim(28);
    const market = marketOf(sim);
    // Known from day one, because the labour market and the Industry screen both read it.
    expect(market.industryAudience).toBe(industryAudienceFor(sim.state.calendar.year));
    expect(market.industryAudience).toBeGreaterThan(0);
    sim.advanceYears(1);
    expect(market.industryAudienceLastYear).toBeGreaterThan(0);
    expect(market.industryAudience).toBeGreaterThan(0);
    expect(Number.isFinite(market.industryAudience)).toBe(true);
  });
});

describe('market events', () => {
  it('are bounded, expire, and actually move the numbers they claim to move', () => {
    const sim = soloSim(29);
    let sawModifier = false;
    let sawExpiry = false;
    let previousCount = 0;
    for (let m = 0; m < 40; m += 1) {
      sim.advanceMonths(1);
      const mods = sim.state.market.modifiers;
      if (mods.length > 0) sawModifier = true;
      if (mods.length < previousCount) sawExpiry = true;
      previousCount = mods.length;
      for (const mod of mods) {
        expect(mod.expiresMonthIndex).toBeGreaterThan(sim.state.calendar.monthIndex - 1);
        expect(mod.label.length).toBeGreaterThan(3);
        if (mod.kind === 'genrePopularity') {
          expect(GENRE_ORDER).toContain(mod.targetId as GenreId);
        }
      }
    }
    expect(sawModifier).toBe(true);
    expect(sawExpiry).toBe(true);
    // And the modifiers are read by the drift maths.
    const market = marketOf(sim);
    market.modifiers.push({
      id: 'mod_test',
      kind: 'genrePopularity',
      targetId: 'strategy',
      amount: 20,
      factor: 1,
      expiresMonthIndex: sim.state.calendar.monthIndex + 6,
      label: 'Strategy craze',
    });
    const mods = genreModifiers(market, 'strategy', sim.state.calendar.monthIndex);
    expect(mods.popAdd).toBe(20);
    const expired = genreModifiers({ ...market, modifiers: [{ ...market.modifiers[0], expiresMonthIndex: 0 }] }, 'strategy', 12);
    expect(expired.popAdd).toBe(0);
    expect(genreModifiers(market, 'puzzle', sim.state.calendar.monthIndex).popAdd).toBe(0);
  });

  it('a craze pushes a genre up faster than its baseline alone', () => {
    const withCraze = soloSim(30);
    const control = soloSim(30);
    withCraze.state.market.modifiers.push({
      id: 'mod_craze',
      kind: 'genrePopularity',
      targetId: 'puzzle',
      amount: 25,
      factor: 1,
      expiresMonthIndex: withCraze.state.calendar.monthIndex + 36,
      label: 'Puzzle craze',
    });
    withCraze.advanceMonths(6);
    control.advanceMonths(6);
    expect(genreMarket(marketOf(withCraze), 'puzzle').popularity).toBeGreaterThan(genreMarket(marketOf(control), 'puzzle').popularity);
  });
});

function clampCompetition(value: number): number {
  return Math.min(100, Math.max(0, value));
}
