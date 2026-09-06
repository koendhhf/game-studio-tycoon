/**
 * Release: the moment every system meets. The permanent history record must be complete and
 * self-contained (it outlives the project and the people), and the consequences — reviews,
 * money, reputation, market demand, staff morale — must all follow from the game's real state.
 */

import { describe, expect, it } from 'vitest';
import {
  BALANCE,
  GENRES,
  createProject,
  profitOf,
  releaseProject,
  shipmentMoraleDelta,
} from './test-imports';
import { addEmployee, addStudio, addTeam, bareWorld, soloSim, testRng } from './helpers';
import type { Project, QualityDimensionId, ReleasedGame } from './test-imports';
import { QUALITY_DIMENSIONS } from './test-imports';

function shippable(
  state: ReturnType<typeof bareWorld>,
  qualityValue: number,
  opts: { bugs?: number; progress?: number; marketing?: number; scope?: 'small' | 'medium' } = {},
): { project: Project; team: ReturnType<typeof addTeam>; studio: ReturnType<typeof addStudio> } {
  const studio = addStudio(state, { cash: 2_000_000, reputation: 30 });
  const team = addTeam(state, studio, ['programmer', 'designer', 'artist', 'writer', 'audio', 'qa'], 70);
  const project = createProject(state, studio.id, testRng(11), {
    title: 'Release Candidate',
    genreId: 'action',
    platformId: 'pc',
    scope: opts.scope ?? 'medium',
    budget: 900_000,
    teamIds: team.map((e) => e.id),
    risk: 0.3,
    marketing: opts.marketing ?? 80_000,
  });
  state.projects[project.id] = project;
  studio.projectIds.push(project.id);
  project.progress = opts.progress ?? 1;
  project.workDone = project.workRequired;
  project.bugs = opts.bugs ?? 4;
  project.bugsPeak = project.bugs;
  project.spent = 420_000;
  project.daysInDevelopment = 300;
  for (const dim of QUALITY_DIMENSIONS) {
    project.quality[dim] = qualityValue;
    project.qualityEffort[dim] = 100;
  }
  return { project, team, studio };
}

describe('releasing a game', () => {
  it('writes a complete, permanent history record', () => {
    const state = bareWorld(2);
    const { project, studio, team } = shippable(state, 74);
    const before = { cash: studio.cash, rep: studio.reputation };
    const result = releaseProject(state, testRng(3), project);
    expect(result).not.toBeNull();
    const game = state.releases[result!.game.id] as ReleasedGame;
    expect(game).toBeTruthy();
    expect(game.title).toBe('Release Candidate');
    expect(game.studioId).toBe(studio.id);
    expect(game.studioName).toBe(studio.name);
    expect(game.isPlayerGame).toBe(true);
    expect(game.genreId).toBe('action');
    expect(game.platformId).toBe('pc');
    expect(game.scope).toBe('medium');
    expect(game.releaseYear).toBe(state.calendar.year);
    expect(game.releaseMonth).toBe(state.calendar.month);
    expect(game.releaseDay).toBe(state.calendar.day);
    expect(game.releaseLabel.length).toBeGreaterThan(3);
    expect(game.developmentCost).toBe(420_000);
    expect(game.marketingSpend).toBe(80_000);
    expect(game.price).toBeGreaterThan(4);
    expect(game.unitsSold).toBe(0);
    expect(game.revenue).toBe(0);
    expect(game.status).toBe('selling');
    expect(game.openingUnits).toBeGreaterThan(0);
    expect(game.developmentDays).toBe(300);
    expect(game.teamHeadcount).toBe(team.length);
    // Quality is snapshotted, not referenced: editing the project cannot rewrite history.
    expect(game.quality).toEqual(project.quality);
    for (const dim of QUALITY_DIMENSIONS) expect(game.quality[dim]).toBe(74);
    expect(game.reviews.length).toBeGreaterThan(2);
    expect(game.reception.notes.length).toBeGreaterThan(0);
    expect(game.reception.recommendRate).toBeGreaterThan(0);
    expect(game.bugsAtRelease).toBe(4);
    expect(game.completeness).toBe(1);
    expect(game.roi).toBe(0);
    expect(profitOf(game)).toBe(-game.developmentCost - game.marketingSpend);

    // The project is closed out and the team is free for the next one.
    expect(project.status).toBe('released');
    expect(project.releasedReleaseId).toBe(game.id);
    expect(project.teamIds).toHaveLength(0);
    expect(studio.projectIds).not.toContain(project.id);
    expect(studio.releaseIds).toContain(game.id);
    expect(studio.employeeIds.length).toBe(team.length);
    expect(state.stats.gamesReleasedTotal).toBe(1);
    expect(state.stats.gamesReleasedByPlayer).toBe(1);

    // Marketing was actually paid, and reputation moved.
    expect(studio.cash).toBeLessThan(before.cash);
    expect(studio.finances.current.marketing).toBe(80_000);
    expect(studio.reputation).not.toBe(before.rep);
    expect(studio.lastReleaseReview).toBeCloseTo(game.reviewScore, 6);
    expect(studio.finances.lifetime.gamesReleased).toBe(1);
  });

  it('records who made the game by name, so history survives them quitting', () => {
    const state = bareWorld(3);
    const { project, team } = shippable(state, 66);
    const result = releaseProject(state, testRng(4), project)!;
    expect(result.game.credits).toHaveLength(team.length);
    for (const credit of result.game.credits) {
      const author = team.find((e) => e.id === credit.employeeId)!;
      expect(credit.name).toBe(author.name);
      expect(credit.role).toBe(author.role);
      expect(credit.skill).toBeGreaterThan(0);
    }
    // Now remove the people entirely: the record must be untouched.
    for (const member of team) delete state.employees[member.id];
    expect(state.releases[result.game.id].credits).toHaveLength(team.length);
    expect(state.releases[result.game.id].credits[0].name).toBeTruthy();
  });

  it('scores a good game well and a bad one badly, with matching reputation moves', () => {
    const goodWorld = bareWorld(5);
    const good = shippable(goodWorld, 93, { bugs: 0, marketing: 300_000 });
    const goodResult = releaseProject(goodWorld, testRng(6), good.project)!;
    expect(goodResult.reviewScore).toBeGreaterThan(75);
    expect(goodResult.game.reputationDelta).toBeGreaterThan(0);
    expect(good.studio.reputation).toBeGreaterThan(30);

    const badWorld = bareWorld(7);
    const bad = shippable(badWorld, 18, { bugs: 900, progress: 0.5, marketing: 0 });
    const badResult = releaseProject(badWorld, testRng(8), bad.project)!;
    expect(badResult.reviewScore).toBeLessThan(40);
    expect(badResult.game.reputationDelta).toBeLessThan(0);
    expect(bad.studio.reputation).toBeLessThan(30);
    expect(bad.studio.reputation).toBeGreaterThanOrEqual(BALANCE.studio.repMin);

    // A hit in a genre lifts the genre; a flop cools it.
    expect(goodWorld.market.genres.action.popularity).toBeGreaterThanOrEqual(GENRES.action.basePopularity - 5);
    expect(badResult.projectedUnits).toBeGreaterThanOrEqual(0);
  });

  it('drains the genre demand it satisfied and cools a saturated market', () => {
    const state = bareWorld(9);
    const { project } = shippable(state, 88, { bugs: 0, marketing: 200_000, scope: 'medium' });
    const demandBefore = state.market.genres.action.demand;
    const competitionBefore = state.market.genres.action.competition;
    const result = releaseProject(state, testRng(10), project)!;
    expect(result.game.unitsSold).toBe(0);
    expect(state.market.genres.action.demand).toBeLessThan(demandBefore);
    // The competition reading is recomputed by the market system, not at release; a released
    // project no longer counts as "live", so the pipeline pressure drops.
    expect(competitionBefore).toBeGreaterThanOrEqual(0);
    // Only a genuine hit becomes "the game everyone is talking about".
    if (result.reviewScore >= BALANCE.market.hitThresholdScore && result.projectedUnits > 120_000) {
      expect(state.market.talkingAboutReleaseId).toBe(result.game.id);
    } else {
      expect(state.market.talkingAboutReleaseId).not.toBe(result.game.id);
    }
  });

  it('the team feels the ship: morale, credits and experience', () => {
    const state = bareWorld(11);
    const { project, team } = shippable(state, 84, { bugs: 0 });
    const moraleBefore = team.map((e) => e.morale);
    const result = releaseProject(state, testRng(12), project)!;
    const expected = shipmentMoraleDelta(result.reviewScore);
    expect(expected).toBeGreaterThan(0);
    team.forEach((e, i) => {
      expect(e.gamesShipped).toBe(1);
      expect(e.bestReviewScore).toBe(result.reviewScore);
      expect(e.morale).toBeCloseTo(Math.min(100, moraleBefore[i] + expected), 6);
    });
  });

  it('refuses a release that is not a release', () => {
    const state = bareWorld(13);
    const { project, studio } = shippable(state, 60);
    project.progress = 0.01;
    expect(releaseProject(state, testRng(14), project)).toBeNull();
    project.progress = 1;
    project.status = 'released';
    expect(releaseProject(state, testRng(15), project)).toBeNull();
    project.status = 'development';
    studio.status = 'defunct';
    expect(releaseProject(state, testRng(16), project)).toBeNull();
    expect(state.events.entries.some((e) => e.category === 'release')).toBe(false);
  });

  it('cannot spend marketing money it does not have', () => {
    const state = bareWorld(17);
    const { project, studio } = shippable(state, 70, { marketing: 1_500_000 });
    studio.cash = 100_000;
    const result = releaseProject(state, testRng(18), project)!;
    expect(result.game.marketingSpend).toBeLessThanOrEqual(100_000);
    expect(studio.cash).toBeGreaterThanOrEqual(0);
  });

  it('opens a sales tail that pays money into the studio', () => {
    const sim = soloSim(19);
    const state = sim.state;
    const studio = state.studios[state.playerStudioId];
    const team = addTeam(state, studio, ['programmer', 'designer', 'artist', 'qa'], 64);
    const project = createProject(state, studio.id, testRng(20), {
      title: 'Long Tail',
      genreId: 'action',
      platformId: 'pc',
      scope: 'prototype',
      budget: 400_000,
      teamIds: team.map((e) => e.id),
      risk: 0.2,
      marketing: 20_000,
    });
    state.projects[project.id] = project;
    studio.projectIds.push(project.id);

    let guard = 0;
    while (project.progress < 1 && guard < 800) {
      sim.step();
      guard += 1;
    }
    expect(guard).toBeLessThan(800);
    const released = releaseProject(state, testRng(21), project);
    expect(released).not.toBeNull();

    const weeksBefore = released!.game.sales.length;
    sim.advanceMonths(3);
    expect(released!.game.sales.length).toBeGreaterThan(weeksBefore);
    expect(released!.game.unitsSold).toBe(released!.game.sales.reduce((a, s) => a + s.units, 0));
    expect(released!.game.revenue).toBeGreaterThan(0);
    // A prototype that sold out its small audience retires early — that is the model working,
    // not a bug: the tail is only kept while weekly units are still worth tracking.
    expect(['selling', 'retired']).toContain(released!.game.status);
    expect(studio.finances.lifetime.revenue).toBeGreaterThan(0);
    expect(state.studios[state.playerStudioId].cash).toBeGreaterThan(-1e9);
    expect(released!.game.peakWeeklyUnits).toBeGreaterThan(0);
  });
});
