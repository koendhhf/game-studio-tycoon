/**
 * Development: the daily loop that turns a team's effort into the six quality dimensions,
 * work progress and a bug backlog, plus the ceilings that decide how far any of it can go.
 */

import { describe, expect, it } from 'vitest';
import {
  BALANCE,
  GENRES,
  analyzeTeam,
  budgetExhausted,
  bugScaleFor,
  bugSeverity,
  createProject,
  developProject,
  dimensionCap,
  effortScale,
  estimateRemainingDays,
  fundingRatio,
  makeCapContext,
  platformDef,
  projectQualityForecast,
  scopeDef,
  advanceProject,
} from './test-imports';
import { addStudio, addTeam, bareWorld, testRng } from './helpers';
import type { Employee, Project } from './test-imports';

function makeProject(
  state: ReturnType<typeof bareWorld>,
  opts: { scope?: 'prototype' | 'small' | 'medium'; genre?: 'action' | 'rpg'; platform?: 'pc' | 'microboy'; budget?: number; risk?: number; team?: Employee[] } = {},
): { project: Project; team: Employee[]; studio: ReturnType<typeof addStudio> } {
  const studio = addStudio(state, { cash: 5_000_000 });
  const team = opts.team ?? addTeam(state, studio, ['programmer', 'designer', 'artist', 'writer', 'audio', 'qa'], 62);
  const project = createProject(state, studio.id, testRng(4), {
    title: 'Test Game',
    genreId: (opts.genre ?? 'action') as never,
    platformId: (opts.platform ?? 'pc') as never,
    scope: (opts.scope ?? 'small') as never,
    budget: opts.budget ?? 4_000_000,
    teamIds: team.map((e) => e.id),
    risk: opts.risk ?? 0.3,
    marketing: 0,
  });
  state.projects[project.id] = project;
  studio.projectIds.push(project.id);
  return { project, team, studio };
}

function teamOf(state: ReturnType<typeof bareWorld>, project: Project): ReturnType<typeof analyzeTeam> {
  const employees = project.teamIds.map((id) => state.employees[id]).filter(Boolean) as Employee[];
  return analyzeTeam(employees, { crunch: false, scope: project.scope });
}

describe('daily development', () => {
  it('converts effort into progress, and never touches cash inside the model', () => {
    const state = bareWorld();
    const { project } = makeProject(state);
    const before = { ...project };
    const delta = developProject({ project, team: teamOf(state, project), isWeekend: false, missingRoles: [] });
    expect(delta.workDone).toBeCloseTo(before.workDone + teamOf(state, project).workPerDay, 6);
    expect(delta.progress).toBeGreaterThan(before.progress);
    expect(delta.progress).toBeCloseTo(delta.workDone / project.workRequired, 8);
    expect(delta.spend).toBe(0); // cash is the system's job, not the model's
    expect(delta.daysInDevelopment).toBe(before.daysInDevelopment + 1);
    expect(project.workDone).toBe(before.workDone); // pure: nothing mutated
  });

  it('weekends produce less and do not count as development days', () => {
    const state = bareWorld();
    const { project } = makeProject(state);
    const weekday = developProject({ project, team: teamOf(state, project), isWeekend: false, missingRoles: [] });
    const weekend = developProject({ project, team: teamOf(state, project), isWeekend: true, missingRoles: [] });
    expect(weekend.workDone - project.workDone).toBeGreaterThan(0);
    expect(weekend.workDone).toBeLessThan(weekday.workDone);
    expect(weekend.daysInDevelopment).toBe(project.daysInDevelopment);
  });

  it('raises every quality dimension, and raises them by different amounts', () => {
    const state = bareWorld();
    const { project } = makeProject(state);
    const team = teamOf(state, project);
    let current = { ...project };
    let raised = 0;
    for (let i = 0; i < 40; i++) {
      const delta = developProject({ project: current as never, team, isWeekend: false, missingRoles: [] });
      for (const dim of Object.keys(delta.quality) as (keyof typeof delta.quality)[]) {
        expect(delta.quality[dim]).toBeGreaterThanOrEqual(current.quality[dim]);
        if (delta.quality[dim] > current.quality[dim]) raised += 1;
      }
      current = { ...current, quality: delta.quality, qualityEffort: delta.qualityEffort, workDone: delta.workDone, progress: delta.progress, bugs: delta.bugs, bugsFixed: delta.bugsFixed };
    }
    const dims = Object.keys(current.quality) as (keyof typeof current.quality)[];
    expect(raised).toBeGreaterThan(dims.length * 10);
    // An action game with an art-heavy team should not have story and graphics equal by accident.
    const spread = Math.max(...dims.map((d) => current.quality[d])) - Math.min(...dims.map((d) => current.quality[d]));
    expect(spread).toBeGreaterThan(2);
  });

  it('accumulates bugs while building and burns them down after feature lock', () => {
    const state = bareWorld();
    const { project } = makeProject(state, { scope: 'medium' });
    const team = teamOf(state, project);
    let current = { ...project };
    let sawBugs = 0;
    while (current.progress < 0.98) {
      const delta = developProject({ project: current as never, team, isWeekend: false, missingRoles: [] });
      current = { ...current, quality: delta.quality, qualityEffort: delta.qualityEffort, workDone: delta.workDone, progress: delta.progress, bugs: delta.bugs, bugsFixed: delta.bugsFixed };
      sawBugs = Math.max(sawBugs, delta.bugs);
    }
    expect(sawBugs).toBeGreaterThan(1);

    // Past feature-complete, fixing starts and new features stop arriving.
    let before = current.bugs;
    let after = before;
    let polishDays = 0;
    while (polishDays < 60 && after > 0) {
      current = { ...current, progress: 1.2 };
      const delta = developProject({ project: current as never, team, isWeekend: false, missingRoles: [] });
      after = delta.bugs;
      expect(delta.bugsFixed).toBeGreaterThanOrEqual(0);
      expect(after).toBeLessThan(before);
      before = after;
      current = { ...current, bugs: delta.bugs, bugsFixed: delta.bugsFixed, quality: delta.quality, qualityEffort: delta.qualityEffort, daysInPolish: delta.daysInPolish };
      polishDays += 1;
    }
    expect(polishDays).toBeLessThan(60);
    expect(current.daysInPolish).toBeGreaterThan(0);
  });

  it('crunch and risk make more bugs', () => {
    const state = bareWorld();
    const calm = makeProject(state, { risk: 0.05 });
    const risky = makeProject(state, { risk: 0.95 });
    const calmBugs = developProject({ project: calm.project as never, team: teamOf(state, calm.project), isWeekend: false, missingRoles: [] });
    const riskyBugs = developProject({ project: { ...risky.project, crunch: true } as never, team: teamOf(state, risky.project), isWeekend: false, missingRoles: [] });
    expect(riskyBugs.bugs).toBeGreaterThan(calmBugs.bugs);
  });

  it('estimates remaining days from the team that is actually assigned', () => {
    const state = bareWorld();
    const { project } = makeProject(state);
    const team = teamOf(state, project);
    const days = estimateRemainingDays(project, team);
    const twice = estimateRemainingDays(project, { ...team, workPerDay: team.workPerDay * 2 });
    expect(days).toBeGreaterThan(0);
    expect(twice).toBeLessThan(days);
    const finished = estimateRemainingDays({ workRequired: 100, workDone: 100 }, team);
    expect(finished).toBe(0);
    expect(estimateRemainingDays({ workRequired: 100, workDone: 0 }, { ...team, workPerDay: 0 })).toBe(Infinity);
  });
});

describe('quality ceilings', () => {
  it('rise with funding, fall with missing roles, and are gated by skill', () => {
    const base = { scopeId: 'medium' as const, genreId: 'rpg' as const, platformId: 'pc' as const, risk: 0.3 };
    const starved = dimensionCap('gameplay', makeCapContext({ ...base, budgetRatio: 0.2 }));
    const funded = dimensionCap('gameplay', makeCapContext({ ...base, budgetRatio: 1 }));
    expect(funded).toBeGreaterThan(starved);

    const missingEssential = makeCapContext({ ...base, budgetRatio: 1, missingRoles: ['programmer'] });
    const complete = makeCapContext({ ...base, budgetRatio: 1, missingRoles: [] });
    expect(dimensionCap('gameplay', complete)).toBeGreaterThan(dimensionCap('gameplay', missingEssential));

    const novice = dimensionCap('gameplay', { ...complete, skillLevel: 0.2 });
    const veteran = dimensionCap('gameplay', { ...complete, skillLevel: 0.95 });
    expect(veteran).toBeGreaterThan(novice);
    // Nobody can be pushed to 100 by talent alone: the ceiling stays below scope max for weak teams.
    expect(dimensionCap('gameplay', { ...complete, skillLevel: 0 })).toBeLessThan(scopeDef('medium').qualityCap);
  });

  it('hardware limits graphics and audio, not writing', () => {
    const weak = platformDef('microboy');
    const strong = platformDef('pc');
    const forHandheld = dimensionCap('graphics', makeCapContext({ scopeId: 'medium', genreId: 'action', platformId: 'microboy', budgetRatio: 1, risk: 0.3 }));
    const forPc = dimensionCap('graphics', makeCapContext({ scopeId: 'medium', genreId: 'action', platformId: 'pc', budgetRatio: 1, risk: 0.3 }));
    expect(forPc).toBeGreaterThan(forHandheld);
    expect(strong.graphicsPressure).toBeGreaterThan(weak.graphicsPressure);

    const storyHandheld = dimensionCap('story', makeCapContext({ scopeId: 'medium', genreId: 'adventure', platformId: 'microboy', budgetRatio: 1, risk: 0.3 }));
    const storyPc = dimensionCap('story', makeCapContext({ scopeId: 'medium', genreId: 'adventure', platformId: 'pc', budgetRatio: 1, risk: 0.3 }));
    expect(storyHandheld).toBeCloseTo(storyPc, 6);
  });

  it('ambition buys innovation and costs polish', () => {
    const safe = makeCapContext({ scopeId: 'medium', genreId: 'action', platformId: 'pc', budgetRatio: 1, risk: 0 });
    const bold = makeCapContext({ scopeId: 'medium', genreId: 'action', platformId: 'pc', budgetRatio: 1, risk: 1 });
    expect(dimensionCap('innovation', bold)).toBeGreaterThan(dimensionCap('innovation', safe));
    expect(dimensionCap('polish', bold)).toBeLessThan(dimensionCap('polish', safe));
  });

  it('bigger scopes need proportionally more effort for the same gain', () => {
    const pc = platformDef('pc');
    const prototype = effortScale(scopeDef('prototype'), pc);
    const ambitious = effortScale(scopeDef('ambitious'), pc);
    expect(ambitious).toBeGreaterThan(prototype * 5);
    expect(effortScale(scopeDef('medium'), platformDef('handheld' in {} ? ('pc' as never) : ('microboy' as never)))).toBeLessThan(effortScale(scopeDef('medium'), pc));
  });

  it('funding is measured against what the scope needs, not against what was spent', () => {
    const state = bareWorld();
    const scope = scopeDef('medium');
    const project = { scope: 'medium' as const, budget: scope.recommendedBudget, workRequired: scope.workUnits };
    expect(fundingRatio(project as never)).toBeCloseTo(1, 5);
    expect(fundingRatio({ ...project, budget: scope.recommendedBudget / 2 } as never)).toBeCloseTo(0.5, 5);
    expect(budgetExhausted({ budget: 100, spent: 99 })).toBe(false);
    expect(budgetExhausted({ budget: 100, spent: 100 })).toBe(true);
  });

  it('bug severity scales with the size of the project', () => {
    expect(bugScaleFor('ambitious')).toBeGreaterThan(bugScaleFor('prototype'));
    expect(bugSeverity(0, 'small')).toBe(0);
    expect(bugSeverity(bugScaleFor('small'), 'small')).toBeCloseTo(1, 5);
    expect(bugSeverity(bugScaleFor('small') * 10, 'small')).toBeLessThanOrEqual(1.6);
  });
});

describe('development system', () => {
  it('charges direct costs to the studio, labour to the project, and grows the people', () => {
    const state = bareWorld();
    const { project, team, studio } = makeProject(state);
    const cashBefore = studio.cash;
    const spentBefore = project.spent;
    const expBefore = team.map((e) => e.experience);
    const days = 30;
    for (let i = 0; i < days; i++) {
      advanceProject(state, project);
      state.calendar.tick += 1;
      state.calendar.day = (state.calendar.day % 28) + 1; // keep weekdays cycling for cadence
    }
    expect(project.workDone).toBeGreaterThan(0);
    expect(project.spent).toBeGreaterThan(spentBefore);
    expect(studio.cash).toBeLessThan(cashBefore);
    // Direct charge is tooling only, bounded by the team size and the weekend discount.
    const maxTooling = team.length * BALANCE.development.toolingCostPerDev * days;
    expect(cashBefore - studio.cash).toBeLessThanOrEqual(maxTooling + 1);
    expect(cashBefore - studio.cash).toBeGreaterThan(maxTooling * 0.5);
    // Labour is attributed to the project, so spent must exceed the tooling actually charged.
    expect(project.spent - spentBefore).toBeGreaterThan(cashBefore - studio.cash);
    team.forEach((e, i) => expect(e.experience).toBeGreaterThan(expBefore[i]));
  });

  it('a real project reaches feature complete and then becomes ready to ship', () => {
    const state = bareWorld();
    const { project, studio } = makeProject(state, { scope: 'prototype' });
    let guard = 0;
    while (project.status !== 'ready' && guard < 900) {
      advanceProject(state, project);
      state.calendar.tick += 1;
      guard += 1;
    }
    expect(guard).toBeLessThan(900);
    expect(project.progress).toBeGreaterThanOrEqual(1);
    expect(project.bugs).toBeLessThanOrEqual(project.workRequired * 0.012 + 2);
    expect(state.events.entries.some((e) => e.title.includes('feature complete'))).toBe(true);
    expect(state.events.entries.some((e) => e.title.includes('ready to ship'))).toBe(true);
    expect(studio.cash).toBeLessThan(5_000_000);
  });

  it('runs out of budget and stalls, then resumes after a top-up', () => {
    const state = bareWorld();
    const { project, studio } = makeProject(state, { budget: 20_000 });
    for (let i = 0; i < 60; i++) {
      advanceProject(state, project);
      state.calendar.tick += 1;
    }
    expect(project.status).toBe('stalled');
    expect(project.stalledDays).toBeGreaterThan(0);
    const qualityWhileStalled = project.quality.gameplay;
    const progressWhileStalled = project.progress;
    for (let i = 0; i < 10; i++) advanceProject(state, project);
    expect(project.quality.gameplay).toBe(qualityWhileStalled);
    expect(project.progress).toBe(progressWhileStalled);
    expect(state.events.entries.some((e) => e.title.includes('stalled'))).toBe(true);

    project.budget += 500_000;
    studio.cash += 500_000;
    advanceProject(state, project);
    expect(project.status).not.toBe('stalled');
    expect(project.progress).toBeGreaterThan(progressWhileStalled);
  });

  it('stalls when nobody is assigned', () => {
    const state = bareWorld();
    const { project } = makeProject(state);
    project.teamIds = [];
    advanceProject(state, project);
    expect(project.status).toBe('stalled');
    expect(state.events.entries.some((e) => e.detail?.includes('Nobody is assigned'))).toBe(true);
  });

  it('the pre-flight forecast tracks what the daily model actually produces', () => {
    const state = bareWorld();
    const studio = addStudio(state, { cash: 9_000_000 });
    const team = addTeam(state, studio, ['programmer', 'designer', 'artist', 'writer', 'audio', 'qa'], 66);
    const scope = 'small' as const;
    const budget = scopeDef(scope).recommendedBudget;
    const forecast = projectQualityForecast({ scopeId: scope, genreId: 'action', platformId: 'pc', budget, risk: 0.3, employees: team });
    expect(forecast.dims.gameplay).toBeGreaterThan(0);
    expect(forecast.days).toBeGreaterThan(0);
    expect(forecast.ready).toBe(true);
    expect(forecast.cost).toBeGreaterThan(0);

    // Run the real thing for the forecast duration and check the projection was honest.
    const project = createProject(state, studio.id, testRng(9), {
      title: 'Forecast Check',
      genreId: 'action',
      platformId: 'pc',
      scope,
      budget,
      teamIds: team.map((e) => e.id),
      risk: 0.3,
      marketing: 0,
    });
    state.projects[project.id] = project;
    studio.projectIds.push(project.id);
    for (let i = 0; i < forecast.days; i++) advanceProject(state, project);
    for (const dim of Object.keys(forecast.dims) as (keyof typeof forecast.dims)[]) {
      expect(Math.abs(project.quality[dim] - forecast.dims[dim])).toBeLessThan(18);
    }
    expect(Math.abs(forecast.overall - (Object.values(project.quality) as number[]).reduce((a, b) => a + b, 0) / 6)).toBeLessThan(20);
    expect(GENRES.action.criticWeights.gameplay).toBeGreaterThan(0);
  });
});
