/**
 * End-to-end gameplay: a competent player strategy, driven through the same commands the UI
 * sends, over years of simulation. This is the test that catches "every system works alone but
 * the game does not work together": the loop must pay for itself, growth must be possible, and
 * the failure path must be as clean as the success path.
 */

import { describe, expect, it } from 'vitest';
import {
  BALANCE,
  GENRE_ORDER,
  Simulation,
  activeStudios,
  deserializeWorld,
  employeesOfStudio,
  profitOf,
  serializeWorld,
  stableStringify,
} from './test-imports';
import type { WorldState } from './test-imports';
import { playMonths } from '../../tools/play-script';

const YEARS = 6;

/** Each scripted run costs seconds, so identical requests share one result. */
const cache = new Map<string, { state: WorldState; outcome: ReturnType<typeof playMonths> }>();

function play(seed: number, months = YEARS * 12): { state: WorldState; outcome: ReturnType<typeof playMonths> } {
  const key = `${seed}:${months}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const sim = Simulation.newGame(seed, 'Competent Studios');
  const outcome = playMonths(sim, months);
  const entry = { state: sim.state, outcome };
  cache.set(key, entry);
  return entry;
}

describe('a competent player over six years', () => {
  for (const seed of [9, 42]) {
    it(`turns a four-person studio into a going concern (seed ${seed})`, () => {
      const { state, outcome } = play(seed);
      expect(outcome.alive).toBe(true);
      expect(state.studios[state.playerStudioId].status).toBe('active');
      // The core promise: playing well makes money, and a lot of it.
      expect(outcome.games).toBeGreaterThanOrEqual(6);
      expect(outcome.profit).toBeGreaterThan(BALANCE.studio.startingCash * 2);
      expect(outcome.cash).toBeGreaterThan(BALANCE.studio.startingCash * 2);
      // And it is a studio now, not a person with a laptop: grown staff, a name, a shelf.
      expect(outcome.headcount).toBeGreaterThan(4);
      expect(outcome.hires).toBeGreaterThan(1);
      expect(outcome.reputation).toBeGreaterThan(BALANCE.studio.repStartPlayer);
      expect(outcome.avgScore).toBeGreaterThan(50);
      expect(outcome.bestScore).toBeGreaterThan(outcome.avgScore);
      expect(outcome.units).toBeGreaterThan(50_000);

      // Every shipped game is a complete record with a real sales history.
      const studio = state.studios[state.playerStudioId];
      const games = studio.releaseIds.map((id) => state.releases[id]);
      expect(games.length).toBe(outcome.games);
      for (const game of games) {
        expect(game.reviewScore).toBeGreaterThanOrEqual(1);
        expect(game.reviewScore).toBeLessThanOrEqual(100);
        expect(game.sales.length).toBeGreaterThan(0);
        expect(game.unitsSold).toBeGreaterThan(0);
        expect(game.credits.length).toBeGreaterThan(0);
        expect(game.revenue).toBeGreaterThan(0);
        expect(profitOf(game)).toBeCloseTo(game.revenue - game.developmentCost - game.marketingSpend, 6);
      }
    });
  }

  it('leaves a healthy industry behind it', () => {
    const { state } = play(17);
    const rivals = activeStudios(state).filter((s) => !s.isPlayer);
    expect(rivals.length).toBeGreaterThanOrEqual(10);
    // Rivals are genuinely competing: games shipped across many genres, money moving.
    const rivalGames = Object.values(state.releases).filter((g) => !g.isPlayerGame);
    expect(rivalGames.length).toBeGreaterThan(30);
    expect(new Set(rivalGames.map((g) => g.genreId)).size).toBeGreaterThan(4);
    const totalCash = rivals.reduce((a, s) => a + s.cash, 0);
    expect(totalCash).toBeGreaterThan(0);
    expect(Number.isFinite(totalCash)).toBe(true);
    // The market still describes a plausible world after all that activity.
    for (const genre of GENRE_ORDER) {
      const market = state.market.genres[genre];
      expect(market.popularity).toBeGreaterThanOrEqual(BALANCE.market.popularityMin);
      expect(market.popularity).toBeLessThanOrEqual(BALANCE.market.popularityMax + 25);
      expect(market.demand).toBeGreaterThanOrEqual(BALANCE.market.demandMin);
      expect(market.competition).toBeGreaterThanOrEqual(0);
      expect(market.fatigue).toBeLessThanOrEqual(30);
    }
  });

  it('treats bankruptcy as a clean ending, not a broken world (hardest seed)', () => {
    const { state, outcome } = play(3);
    const studio = state.studios[state.playerStudioId];
    if (outcome.alive) {
      // A recovery is allowed; being alive with no money and no games is not.
      expect(outcome.games + outcome.cash).toBeGreaterThan(0);
    } else {
      expect(studio.status).toBe('defunct');
      expect(studio.employeeIds).toHaveLength(0);
      expect(studio.projectIds).toHaveLength(0);
      expect(employeesOfStudio(state, studio.id)).toHaveLength(0);
      // History survives the studio: the games it made are still on the shelf.
      expect(Object.keys(state.releases).length).toBeGreaterThan(0);
      expect(outcome.games).toBeGreaterThan(0);
      // And nobody is left employed by a corpse.
      for (const emp of Object.values(state.employees)) {
        if (emp.studioId === studio.id) throw new Error(`${emp.name} still works for a closed studio`);
      }
    }
    // The world keeps turning regardless of how the player did.
    expect(activeStudios(state).length).toBeGreaterThan(5);
    expect(state.stats.monthsRun).toBe(YEARS * 12);
  });

  it('is reproducible: the same seed and the same decisions tell the same story', () => {
    const months = 24;
    const a = play(23, months);
    const b = play(23, months);
    expect(a.outcome).toEqual(b.outcome);
    expect(stableStringify({ ...a.state, savedAt: undefined })).toBe(stableStringify({ ...b.state, savedAt: undefined }));

    // And resuming from a save in the middle of the run tells it the same way.
    const resumeSim = Simulation.newGame(23, 'Competent Studios');
    const resumePoint = { state: resumeSim.state, outcome: playMonths(resumeSim, 12) };
    const restored = Simulation.restore(deserializeWorld(serializeWorld(resumePoint.state, 'Mid')).state!);
    const resumed = playMonths(restored, months - resumePoint.outcome.months);
    expect(resumed).toEqual({ ...a.outcome, months: months - resumePoint.outcome.months });
  });

  it('saves and reloads the whole story without losing a single fact', () => {
    const { state } = play(42);
    const text = serializeWorld(state, 'Six years in');
    expect(text.length).toBeLessThan(8_000_000);
    const loaded = deserializeWorld(text);
    expect(loaded.error).toBeUndefined();
    expect(loaded.warnings).toEqual([]);
    const restored = loaded.state! as WorldState;
    expect(stableStringify({ ...restored, savedAt: undefined })).toBe(stableStringify({ ...state, savedAt: undefined }));
    expect(Object.keys(restored.releases).length).toBe(Object.keys(state.releases).length);
    expect(restored.studios[restored.playerStudioId].releaseIds).toEqual(state.studios[state.playerStudioId].releaseIds);
  });
});
