/**
 * The planner is the promise the Create Game screen makes: projected quality, schedule, cost and
 * revenue for a project that does not exist yet. It must be pure, use the same models as the
 * simulation, and tell the player when a plan is bad.
 */

import { describe, expect, it } from 'vitest';
import {
  GENRES,
  QUALITY_DIMENSIONS,
  SCOPES,
  openingUnits,
  planProject,
  recommendedMarketingFor,
  scopeDef,
} from './test-imports';
import type { ProjectDraft, QualityDimensionId } from './test-imports';
import { addTeam, soloSim } from './helpers';

function draftFor(sim: ReturnType<typeof soloSim>, patch: Partial<ProjectDraft> = {}): ProjectDraft {
  const state = sim.state;
  const studio = state.studios[state.playerStudioId];
  return {
    studioId: studio.id,
    title: 'Honest Plan',
    genreId: 'action',
    platformId: 'pc',
    scope: 'small',
    teamIds: studio.employeeIds.slice(),
    budget: 60_000,
    marketing: 18_000,
    risk: 0.3,
    crunch: false,
    ...patch,
  };
}

describe('the plan as a projection', () => {
  it('is a pure read of the world', () => {
    const sim = soloSim(1);
    const before = JSON.stringify(sim.state);
    const plan = planProject(sim.state, draftFor(sim));
    expect(plan.overall).toBeGreaterThan(0);
    expect(JSON.stringify(sim.state)).toBe(before);
    sim.advanceMonths(1);
    expect(JSON.stringify(sim.state)).not.toBe(before);
  });

  it('answers the same question the same way twice', () => {
    const sim = soloSim(2);
    const a = planProject(sim.state, draftFor(sim));
    const b = planProject(sim.state, draftFor(sim));
    expect(a).toEqual(b);
  });

  it('reports one forecast per quality dimension, with words', () => {
    const sim = soloSim(3);
    const plan = planProject(sim.state, draftFor(sim));
    expect(plan.dims.length).toBe(QUALITY_DIMENSIONS.length);
    for (const dim of plan.dims) {
      expect(QUALITY_DIMENSIONS).toContain(dim.dim as QualityDimensionId);
      expect(dim.projected).toBeGreaterThanOrEqual(0);
      expect(dim.projected).toBeLessThanOrEqual(100);
      expect(dim.cap).toBeGreaterThanOrEqual(dim.projected);
      expect(dim.descriptor.length).toBeGreaterThan(6);
    }
    // `overall` is the critic-weighted read, so it lives between the best and worst dimension.
    const values = plan.dims.map((d) => d.projected);
    expect(plan.overall).toBeGreaterThanOrEqual(Math.min(...values) - 1);
    expect(plan.overall).toBeLessThanOrEqual(Math.max(...values) + 1);
  });

  it('weights the genre the same way the review model will', () => {
    const sim = soloSim(4);
    const state = sim.state;
    const action = planProject(state, draftFor(sim, { genreId: 'action' }));
    const rpg = planProject(state, draftFor(sim, { genreId: 'rpg' }));
    const weightFor = (plan: typeof action, dim: QualityDimensionId) => plan.dims.find((d) => d.dim === dim)?.weight ?? 0;
    expect(weightFor(action, 'gameplay')).toBeGreaterThan(weightFor(rpg, 'gameplay'));
    expect(weightFor(rpg, 'story')).toBeGreaterThan(weightFor(action, 'story'));
    expect(action.weights.story).toBe(GENRES.action.criticWeights.story);
  });

  it('prices the game and the marketing it recommends', () => {
    const sim = soloSim(5);
    const plan = planProject(sim.state, draftFor(sim));
    expect(plan.price).toBeGreaterThan(0);
    expect(plan.recommendedMarketing).toBe(recommendedMarketingFor('small', 'pc', sim.state.studios[sim.state.playerStudioId].reputation));
    expect(plan.marketingCost).toBe(18_000);
    expect(plan.devkitCost).toBeGreaterThanOrEqual(0);
    expect(plan.cashCommitted).toBe(60_000 + 18_000 + plan.devkitCost);
  });

  it('uses the same sales model for its numbers as the simulation will', () => {
    const sim = soloSim(6);
    const plan = planProject(sim.state, draftFor(sim));
    expect(plan.openingUnits).toBe(openingUnits(plan.salesInput));
    expect(plan.lifetimeUnits).toBeGreaterThanOrEqual(plan.openingUnits);
    expect(plan.netRevenue).toBeGreaterThan(0);
    expect(plan.grossRevenue).toBeGreaterThanOrEqual(plan.netRevenue);
    expect(plan.breakEvenUnits).toBeGreaterThan(0);
    // Break-even and profit agree with each other.
    if (plan.lifetimeUnits >= plan.breakEvenUnits) {
      expect(plan.projectedProfit).toBeGreaterThanOrEqual(0);
    } else {
      expect(plan.projectedProfit).toBeLessThan(0);
    }
  });

  it('projects a schedule in real days, weekend-adjusted', () => {
    const sim = soloSim(7);
    const plan = planProject(sim.state, draftFor(sim));
    expect(plan.daysToFeatureComplete).toBeGreaterThan(10);
    expect(plan.daysToFeatureComplete).toBeLessThan(4000);
    expect(plan.totalDays).toBe(plan.daysToFeatureComplete + plan.daysToPolish);
    expect(plan.workPerDay).toBeGreaterThan(0);
    expect(plan.headcount).toBe(sim.state.studios[sim.state.playerStudioId].employeeIds.length);

    // A bigger scope is a longer project; a bigger team is a shorter one.
    const bigger = planProject(sim.state, draftFor(sim, { scope: 'large', budget: 1_150_000 }));
    expect(bigger.daysToFeatureComplete).toBeGreaterThan(plan.daysToFeatureComplete * 2);
    const extraHands = addTeam(sim.state, sim.state.studios[sim.state.playerStudioId], ['programmer', 'designer', 'artist', 'qa'], 60);
    const staffed = planProject(sim.state, draftFor(sim, { teamIds: [...draftFor(sim).teamIds, ...extraHands.map((e) => e.id)] }));
    expect(staffed.daysToFeatureComplete).toBeLessThan(plan.daysToFeatureComplete);
  });

  it('gets better with budget and worse with an unfunded plan', () => {
    const sim = soloSim(8);
    const poor = planProject(sim.state, draftFor(sim, { budget: 8_000 }));
    const right = planProject(sim.state, draftFor(sim, { budget: 140_000 }));
    const rich = planProject(sim.state, draftFor(sim, { budget: 900_000 }));
    expect(right.overall).toBeGreaterThan(poor.overall);
    expect(rich.overall).toBeGreaterThanOrEqual(right.overall);
    expect(rich.overall).toBeLessThanOrEqual(100);
    expect(rich.fundingRatio).toBeGreaterThan(poor.fundingRatio);
    expect(poor.warnings.some((w) => w.includes('ceiling'))).toBe(true);
    expect(rich.recommendedBudget).toBe(right.recommendedBudget);
    expect(rich.recommendedBudget).toBeGreaterThan(0);
  });

  it('trades innovation against polish the way the risk slider claims to', () => {
    const sim = soloSim(9);
    const dim = (plan: ReturnType<typeof planProject>, name: QualityDimensionId) => plan.dims.find((d) => d.dim === name)!.projected;
    const safe = planProject(sim.state, draftFor(sim, { risk: 0.02 }));
    const wild = planProject(sim.state, draftFor(sim, { risk: 0.95 }));
    expect(dim(wild, 'innovation')).toBeGreaterThan(dim(safe, 'innovation') + 10);
    expect(dim(wild, 'polish')).toBeLessThan(dim(safe, 'polish'));
    expect(wild.projectedBugs).toBeGreaterThanOrEqual(safe.projectedBugs);
    // Never a free lunch in either direction: the projections stay inside the model's bounds.
    for (const plan of [safe, wild]) {
      expect(plan.dims.every((d) => d.projected <= d.cap + 1e-6)).toBe(true);
    }
    // A bigger, riskier project is where bugs actually pile up.
    const bigWild = planProject(sim.state, draftFor(sim, { scope: 'large', budget: SCOPES.large.recommendedBudget, risk: 0.95 }));
    const bigSafe = planProject(sim.state, draftFor(sim, { scope: 'large', budget: SCOPES.large.recommendedBudget, risk: 0.05 }));
    expect(bigWild.projectedBugs).toBeGreaterThan(bigSafe.projectedBugs);
  });

  it('a larger, better-paid studio projects a better game', () => {
    const sim = soloSim(10);
    const state = sim.state;
    const studio = state.studios[state.playerStudioId];
    const solo = planProject(state, draftFor(sim));
    addTeam(state, studio, ['writer', 'audio', 'producer'], 88);
    const grown = planProject(state, draftFor(sim, { scope: 'medium', budget: SCOPES.medium.recommendedBudget }));
    expect(grown.headcount).toBeGreaterThan(solo.headcount);
    expect(grown.dims.find((d) => d.dim === 'story')!.projected).toBeGreaterThan(solo.dims.find((d) => d.dim === 'story')!.projected);
  });
});

describe('blockers and warnings', () => {
  it('blocks what the command would refuse', () => {
    const sim = soloSim(11);
    const state = sim.state;
    const blocked = [
      draftFor(sim, { teamIds: [] }),
      draftFor(sim, { budget: 100 }),
      draftFor(sim, { title: 'A' }),
      draftFor(sim, { budget: 9_000_000, marketing: 0 }),
    ];
    for (const draft of blocked) {
      const plan = planProject(state, draft);
      expect(plan.blockers.length, draft.title).toBeGreaterThan(0);
    }
    const fine = planProject(state, draftFor(sim));
    expect(fine.blockers).toHaveLength(0);
  });

  it('warns about the classic self-inflicted wounds', () => {
    const sim = soloSim(12);
    const state = sim.state;
    const crowded = planProject(state, draftFor(sim, { scope: 'prototype', teamIds: state.studios[state.playerStudioId].employeeIds.slice(), crunch: true, marketing: 0 }));
    expect(crowded.warnings.length).toBeGreaterThan(0);
    expect(crowded.warnings.some((w) => w.includes('Crunch'))).toBe(true);
    expect(crowded.warnings.some((w) => w.toLowerCase().includes('marketing'))).toBe(true);

    const overhyped = planProject(state, draftFor(sim, { marketing: 900_000, budget: 400_000 }));
    expect(overhyped.warnings.some((w) => w.toLowerCase().includes('past what this scope'))).toBe(true);

    // A one-person team on a large project is both short-handed and role-incomplete.
    const solo = addTeam(state, state.studios[state.playerStudioId], ['programmer'], 62)[0];
    state.studios[state.playerStudioId].cash = 4_000_000;
    const tiny = planProject(state, draftFor(sim, { scope: 'large', teamIds: [solo.id], budget: SCOPES.large.recommendedBudget }));
    expect(tiny.warnings.some((w) => w.includes('wants at least'))).toBe(true);
    expect(tiny.warnings.some((w) => w.toLowerCase().includes('no '))).toBe(true);
    expect(tiny.blockers.length).toBe(0); // not fatal, just a bad idea
  });

  it('still produces a readable plan for a plan nobody is working on', () => {
    const sim = soloSim(13);
    const plan = planProject(sim.state, draftFor(sim, { teamIds: [], budget: 500 }));
    // With no team there is no throughput: the plan says so instead of inventing a schedule.
    expect(plan.daysToFeatureComplete).toBe(Infinity);
    expect(plan.totalDays).toBe(Infinity);
    expect(plan.workPerDay).toBe(0);
    expect(plan.headcount).toBe(0);
    for (const dim of plan.dims) {
      expect(dim.projected, dim.dim).toBe(0);
      expect(dim.cap).toBeGreaterThanOrEqual(0);
    }
    expect(plan.totalDays).toBe(Infinity);
    expect(plan.blockers.join(' ')).toContain('Nobody is assigned');
    expect(plan.blockers.join(' ')).toContain('budget of at least');
    expect(scopeDef('small').workUnits).toBeGreaterThan(0);
  });
});
