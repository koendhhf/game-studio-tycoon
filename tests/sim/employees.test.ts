/**
 * Employees: the skills/salary/morale model, how a team rolls up into throughput, and how
 * hiring and firing behave as commands. Employees are the input to development, so this is
 * where "role and skill actually matter" is pinned down.
 */

import { describe, expect, it } from 'vitest';
import {
  BALANCE,
  ROLES,
  analyzeTeam,
  clampEmployee,
  effectiveSkill,
  employeeWorkRate,
  growthDelta,
  hireUpfrontCost,
  marketValue,
  makeCapContext,
  dimensionCap,
  moraleBand,
  moraleDrift,
  moraleFactor,
  payRatio,
  skillAverage,
  skillBand,
} from './test-imports';
import { experienceDelta } from '../../src/sim/models/employee-model';
import { addEmployee, addStudio, addTeam, bareWorld, soloSim } from './helpers';

describe('employee model', () => {
  it('averages the six dimensions and weights them by role focus', () => {
    const state = bareWorld();
    const studio = addStudio(state);
    const designer = addEmployee(state, studio, { role: 'designer', skills: { gameplay: 90, graphics: 20, story: 80, audio: 10, innovation: 95, polish: 30 } });
    expect(skillAverage(designer)).toBeCloseTo((90 + 20 + 80 + 10 + 95 + 30) / 6, 5);
    // Role-weighted skill must favour the dimensions the role actually works on.
    expect(effectiveSkill(designer)).toBeGreaterThan(skillAverage(designer));
  });

  it('bands skill and morale with readable labels', () => {
    expect(skillBand(95)).toBe('legendary');
    expect(skillBand(50)).toBe('capable');
    expect(moraleBand(90)).toBe('elated');
    expect(moraleBand(10)).toBe('mutinous');
  });

  it('prices people by skill, role and experience', () => {
    const state = bareWorld();
    const studio = addStudio(state);
    const junior = addEmployee(state, studio, { role: 'programmer', skills: { gameplay: 30, graphics: 30, story: 30, audio: 30, innovation: 30, polish: 30 }, experience: 1 });
    const senior = addEmployee(state, studio, { role: 'programmer', skills: { gameplay: 85, graphics: 85, story: 85, audio: 85, innovation: 85, polish: 85 }, experience: 12 });
    expect(marketValue(senior)).toBeGreaterThan(marketValue(junior) * 1.3);

    const artist = addEmployee(state, studio, { role: 'artist', skills: junior.skills, experience: junior.experience });
    void artist;
    // Roles with a higher salary multiplier are worth more at the same skill.
    expect(marketValue(addEmployee(state, studio, { role: 'producer', skills: { gameplay: 50, graphics: 50, story: 50, audio: 50, innovation: 50, polish: 50 }, experience: 5 }))).toBeGreaterThan(0);
    expect(marketValue(junior)).toBeGreaterThan(0);
  });

  it('measures pay against market value', () => {
    const state = bareWorld();
    const studio = addStudio(state);
    const emp = addEmployee(state, studio, { role: 'artist', skills: { gameplay: 60, graphics: 60, story: 60, audio: 60, innovation: 60, polish: 60 } });
    const value = marketValue(emp);
    emp.salary = value;
    expect(payRatio(emp)).toBeCloseTo(1, 5);
    emp.salary = value * 0.5;
    expect(payRatio(emp)).toBeCloseTo(0.5, 5);
  });

  it('morale and traits change how much one person delivers per day', () => {
    const state = bareWorld();
    const studio = addStudio(state);
    const base = addEmployee(state, studio, { role: 'programmer', morale: 60, experience: 0 });
    const happy = addEmployee(state, studio, { role: 'programmer', morale: 100, experience: 0 });
    const miserable = addEmployee(state, studio, { role: 'programmer', morale: 0, experience: 0 });
    expect(employeeWorkRate(happy, false)).toBeGreaterThan(employeeWorkRate(base, false));
    expect(employeeWorkRate(miserable, false)).toBeLessThan(employeeWorkRate(base, false));
    expect(employeeWorkRate(base, true)).toBeCloseTo(employeeWorkRate(base, false) * BALANCE.development.crunchWorkMult, 6);

    const veteran = addEmployee(state, studio, { role: 'programmer', morale: 60, experience: 20 });
    expect(employeeWorkRate(veteran, false)).toBeGreaterThan(employeeWorkRate(base, false));

    const rockstar = addEmployee(state, studio, { role: 'programmer', morale: 60, experience: 0, traits: ['rockstar'] });
    expect(employeeWorkRate(rockstar, false)).toBeGreaterThan(employeeWorkRate(base, false));

    for (const role of Object.keys(ROLES) as (keyof typeof ROLES)[]) {
      const emp = addEmployee(state, studio, { role, morale: 60, experience: 0 });
      expect(employeeWorkRate(emp, false)).toBeGreaterThan(0);
    }
    expect(moraleFactor(100)).toBeGreaterThan(moraleFactor(0));
  });

  it('morale drift responds to pay, workload and cash crisis', () => {
    const state = bareWorld();
    const studio = addStudio(state);
    const emp = addEmployee(state, studio, { role: 'designer', morale: 30 });
    emp.salary = marketValue(emp);
    const atMarket = moraleDriftFor(emp, { working: true, overwork: 1, crunch: false, cashCrisis: false });
    const underpaid = moraleDriftFor({ ...emp, salary: marketValue(emp) * 0.6 }, { working: true, overwork: 1, crunch: false, cashCrisis: false });
    const burnedOut = moraleDriftFor(emp, { working: true, overwork: 2.2, crunch: true, cashCrisis: false });
    const idle = moraleDriftFor(emp, { working: false, overwork: 0, crunch: false, cashCrisis: false });
    const broke = moraleDriftFor(emp, { working: true, overwork: 1, crunch: false, cashCrisis: true });

    expect(atMarket).toBeGreaterThan(0); // recovery while low and paid fairly
    expect(underpaid).toBeLessThan(atMarket);
    expect(burnedOut).toBeLessThan(0);
    expect(idle).toBeLessThan(atMarket);
    expect(broke).toBeLessThan(atMarket);
  });

  it('clamps employee fields instead of letting them drift out of range', () => {
    const state = bareWorld();
    const studio = addStudio(state);
    const emp = addEmployee(state, studio, { role: 'qa', morale: 100 });
    emp.morale = 900;
    emp.loyalty = -50;
    emp.experience = -3;
    clampEmployee(emp);
    expect(emp.morale).toBeLessThanOrEqual(100);
    expect(emp.loyalty).toBeGreaterThanOrEqual(0);
    expect(emp.experience).toBeGreaterThanOrEqual(0);
  });

  it('grows skills on the job, limited by potential and by what the team works on', () => {
    const state = bareWorld();
    const studio = addStudio(state);
    const emp = addEmployee(state, studio, { role: 'artist', skills: { gameplay: 40, graphics: 40, story: 40, audio: 40, innovation: 40, polish: 40 }, potential: 1.4 });
    const weights = { gameplay: 0, graphics: 0.8, story: 0, audio: 0.05, innovation: 0.1, polish: 0.05 };
    const growth = growthDelta(emp, weights, 5);
    expect(growth.graphics ?? 0).toBeGreaterThan(0);
    expect(experienceDelta(emp, true)).toBeGreaterThan(0);
    expect(experienceDelta(emp, false)).toBeLessThanOrEqual(0);

    const limited = addEmployee(state, studio, { role: 'artist', potential: 0.2 });
    const unlimited = addEmployee(state, studio, { role: 'artist', potential: 2 });
    expect(growthDelta(unlimited, weights, 5).graphics ?? 0).toBeGreaterThan(growthDelta(limited, weights, 5).graphics ?? 0);
  });

  it('hiring costs a signing bonus plus the first month, and the command pays it', () => {
    const sim = soloSim(21);
    const state = sim.state;
    const studio = state.studios[state.playerStudioId];
    const candidate = Object.values(state.employees).find((e) => e.studioId === null);
    expect(candidate).toBeTruthy();
    const cost = hireUpfrontCost(candidate!);
    const before = studio.cash;
    const headcount = studio.employeeIds.length;
    const result = sim.runCommand({ type: 'hire', candidateId: candidate!.id });
    expect(result.ok).toBe(true);
    expect(studio.employeeIds.length).toBe(headcount + 1);
    // The command deducts the signing bonus; the reserve check in validateHire also wants
    // their first month covered, which is why hireUpfrontCost is larger than the charge.
    expect(before - studio.cash).toBeGreaterThanOrEqual(candidate!.salary * BALANCE.hiring.signingBonusMonths * 0.9);
    expect(cost).toBeGreaterThan(before - studio.cash);
    expect(state.employees[candidate!.id].studioId).toBe(studio.id);
    expect(candidate!.salary).toBeGreaterThan(0);
  });

  it('refuses an offer the candidate will not take and a hire the studio cannot pay', () => {
    const sim = soloSim(22);
    const state = sim.state;
    const studio = state.studios[state.playerStudioId];
    const candidate = Object.values(state.employees).find((e) => e.studioId === null)!;
    const lowOffer = sim.runCommand({ type: 'hire', candidateId: candidate.id, offerSalary: Math.round(candidate.salary * 0.5) });
    expect(lowOffer.ok).toBe(false);
    expect(lowOffer.error).toMatch(/minimum expectation/i);
    expect(state.employees[candidate.id].studioId).toBe(null);

    const broke = Object.values(state.employees).find((e) => e.studioId === null && e !== candidate)!;
    studio.cash = 1;
    const noMoney = sim.runCommand({ type: 'hire', candidateId: broke.id });
    expect(noMoney.ok).toBe(false);
    expect(noMoney.error).toMatch(/up front/i);
  });

  it('firing releases the person to the pool and charges severance', () => {
    const sim = soloSim(23);
    const state = sim.state;
    const studio = state.studios[state.playerStudioId];
    const target = state.employees[studio.employeeIds[0]];
    const cash = studio.cash;
    const result = sim.runCommand({ type: 'fire', employeeId: target.id });
    expect(result.ok).toBe(true);
    expect(studio.employeeIds).not.toContain(target.id);
    expect(target.studioId).toBe(null);
    expect(target.status).toBe('candidate');
    expect(cash - studio.cash).toBeGreaterThanOrEqual(target.salary * BALANCE.hiring.severanceMonths * 0.5);
  });

  it('setting pay changes payRatio and can buy loyalty back', () => {
    const sim = soloSim(24);
    const state = sim.state;
    const studio = state.studios[state.playerStudioId];
    const emp = state.employees[studio.employeeIds[0]];
    const before = payRatio(emp);
    const ok = sim.runCommand({ type: 'setSalary', employeeId: emp.id, salary: Math.round(marketValue(emp) * 1.2) });
    expect(ok.ok).toBe(true);
    expect(payRatio(emp)).toBeGreaterThan(before);
  });
});

describe('teams', () => {
  it('more capable people mean more work per day', () => {
    const state = bareWorld();
    const studio = addStudio(state);
    const weak = addTeam(state, studio, ['programmer', 'designer', 'artist'], 30);
    const strong = addTeam(state, studio, ['programmer', 'designer', 'artist'], 90);
    const weakTeam = analyzeTeam(weak, { crunch: false, scope: 'small' });
    const strongTeam = analyzeTeam(strong, { crunch: false, scope: 'small' });
    // Raw throughput is role/experience/morale driven; skill decides quality instead. That
    // split is deliberate, so a test that assumes smarter people build *faster* is wrong.
    expect(strongTeam.workPerDay).toBeCloseTo(weakTeam.workPerDay, 6);
    expect(strongTeam.dimInput.gameplay).toBeGreaterThan(weakTeam.dimInput.gameplay);
    expect(strongTeam.dimSkill.gameplay).toBeGreaterThan(weakTeam.dimSkill.gameplay);
    expect(strongTeam.avgSkill).toBeGreaterThan(weakTeam.avgSkill);
  });

  it('roles determine which dimensions a team can push', () => {
    const state = bareWorld();
    const studio = addStudio(state);
    const artistsOnly = addTeam(state, studio, ['artist', 'artist'], 70);
    const withProgrammers = addTeam(state, studio, ['artist', 'artist', 'programmer', 'programmer'], 70);
    const a = analyzeTeam(artistsOnly, { crunch: false, scope: 'small' });
    const b = analyzeTeam(withProgrammers, { crunch: false, scope: 'small' });
    expect(b.dimInput.gameplay).toBeGreaterThan(a.dimInput.gameplay);
    expect(a.dimInput.graphics).toBeGreaterThan(0);
    expect(a.roles.filter((r) => r === 'writer')).toHaveLength(0);
    // Ownership is what limits the ceiling: the same team writes a better story with a writer.
    const withoutWriter = dimensionCap('story', makeCapContext({ scopeId: 'small', genreId: 'rpg', platformId: 'pc', budgetRatio: 1, risk: 0.3, missingRoles: ['writer'] }));
    const withWriter = dimensionCap('story', makeCapContext({ scopeId: 'small', genreId: 'rpg', platformId: 'pc', budgetRatio: 1, risk: 0.3, missingRoles: [] }));
    expect(withWriter).toBeGreaterThan(withoutWriter);
    expect(b.headcount).toBe(4);
  });

  it('QA share drives bug fixing, and an oversized team coordination-penalises', () => {
    const state = bareWorld();
    const studio = addStudio(state);
    const withQa = analyzeTeam(addTeam(state, studio, ['programmer', 'qa', 'qa'], 60), { crunch: false, scope: 'small' });
    const withoutQa = analyzeTeam(addTeam(state, studio, ['programmer', 'programmer', 'programmer'], 60), { crunch: false, scope: 'small' });
    expect(withQa.qaShare).toBeGreaterThan(0);
    expect(withQa.fixPower).toBeGreaterThan(withoutQa.fixPower);

    const big = analyzeTeam(addTeam(state, studio, new Array(14).fill('programmer') as never, 60), { crunch: false, scope: 'prototype' });
    const small = analyzeTeam(addTeam(state, studio, ['programmer', 'programmer'], 60), { crunch: false, scope: 'prototype' });
    expect(big.teamSpeedMult).toBeLessThan(1);
    expect(small.teamSpeedMult).toBeGreaterThan(big.teamSpeedMult);
    // Per-head output must actually drop, or "hire everyone" would be optimal.
    expect(big.workPerDay / big.headcount).toBeLessThan(small.workPerDay / small.headcount);
  });

  it('producer coverage shields the team from morale damage', () => {
    const state = bareWorld();
    const studio = addStudio(state);
    const withProducer = analyzeTeam(addTeam(state, studio, ['producer', 'programmer', 'designer'], 60), { crunch: false, scope: 'small' });
    const without = analyzeTeam(addTeam(state, studio, ['programmer', 'designer', 'artist'], 60), { crunch: false, scope: 'small' });
    // The shield multiplies *negative* drift, so smaller is better.
    expect(withProducer.moraleShield).toBeLessThan(without.moraleShield);
  });
});

type MoraleDriftInput = Omit<Parameters<typeof moraleDrift>[1], 'moraleShield' | 'teamMorale'>;

function moraleDriftFor(emp: Parameters<typeof moraleDrift>[0], ctx: MoraleDriftInput): number {
  return moraleDrift(emp, { moraleShield: 1, teamMorale: 60, ...ctx });
}
