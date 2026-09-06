/**
 * Finances: payroll, overhead, project money, and what insolvency actually means.
 * Everything is asserted from the ledger, because the ledger is what the player reads.
 */

import { describe, expect, it } from 'vitest';
import {
  BALANCE,
  candidatesInPool,
  createProject,
  hireUpfrontCost,
  monthlyBurn,
  monthlyOverhead,
  monthlySalaryBill,
  profitOf,
  solvencySystem,
} from './test-imports';
import type { ReleasedGame } from './test-imports';
import { addEmployee, addStudio, addTeam, bareWorld, soloSim, testRng } from './helpers';

describe('the monthly bill', () => {
  it('is salaries plus overhead, and overhead scales with headcount', () => {
    const state = bareWorld(1);
    const studio = addStudio(state, { cash: 500_000 });
    expect(monthlyOverhead(state, studio.id)).toBe(BALANCE.studio.overheadBase);
    expect(monthlySalaryBill(state, studio.id)).toBe(0);
    expect(monthlyBurn(state, studio.id)).toBe(BALANCE.studio.overheadBase);

    const team = addTeam(state, studio, ['programmer', 'designer', 'artist'], 60);
    const payroll = team.reduce((a, e) => a + e.salary, 0);
    expect(monthlySalaryBill(state, studio.id)).toBe(payroll);
    expect(monthlyOverhead(state, studio.id)).toBe(BALANCE.studio.overheadBase + BALANCE.studio.overheadPerEmployee * team.length);
    expect(monthlyBurn(state, studio.id)).toBe(payroll + monthlyOverhead(state, studio.id));
  });

  it('charges exactly one payroll per month and books it to the ledger', () => {
    const sim = soloSim(2);
    const state = sim.state;
    const studio = state.studios[state.playerStudioId];
    const salaries = monthlySalaryBill(state, studio.id);
    const overhead = monthlyOverhead(state, studio.id);
    const bill = salaries + overhead;
    const cashBefore = studio.cash;

    sim.advanceMonths(4);

    const rows = studio.finances.months;
    expect(rows.length).toBe(4);
    for (const row of rows) {
      expect(row.revenue).toBe(0); // nothing released yet
      expect(row.salaries).toBe(salaries);
      expect(row.overhead).toBe(overhead);
      expect(row.development).toBe(0); // no project running
      expect(row.marketing).toBe(0);
      // Interest on a positive balance is booked as a credit against "other" costs.
      expect(row.other).toBeLessThan(0);
      // The row is internally consistent: net is the cash movement, and it explains the balance.
      expect(row.net).toBe(row.revenue - row.salaries - row.overhead - row.development - row.marketing - row.other);
      // Rounded to whole dollars, so allow a dollar of representation error.
      expect(Math.abs(row.closingCash - row.net - row.openingCash)).toBeLessThanOrEqual(1);
      expect(row.year).toBeGreaterThanOrEqual(1990);
      expect(row.month).toBeGreaterThanOrEqual(0);
      expect(row.month).toBeLessThan(12);
    }
    // Months are contiguous — no gaps, no double-counting.
    for (let i = 1; i < rows.length; i += 1) {
      // Ledger rows are rounded to whole dollars, so a cent of drift per row is allowed.
      expect(Math.abs(rows[i].openingCash - rows[i - 1].closingCash)).toBeLessThanOrEqual(1);
    }
    const booked = rows.reduce((a, r) => a - r.net, 0);
    // Four months of the same bill, less the interest credited for keeping money in the bank.
    expect(rows.reduce((a, r) => a + r.salaries + r.overhead, 0)).toBe(bill * 4);
    expect(booked).toBeLessThan(bill * 4);
    expect(bill * 4 - booked).toBeCloseTo(-rows.reduce((a, r) => a + r.other, 0), 2);
    expect(Math.abs(cashBefore - studio.cash - booked)).toBeLessThanOrEqual(1);
    expect(studio.finances.lifetime.salaries).toBe(rows.reduce((a, r) => a + r.salaries, 0));
    expect(studio.finances.lifetime.overhead).toBe(overhead * 4);
    expect(studio.finances.lifetime.peakCash).toBe(cashBefore);
    // The month in progress starts empty again.
    expect(studio.finances.current.salaries).toBe(0);
    expect(studio.finances.current.overhead).toBe(0);
  });

  it('recomputes the moment you hire and the moment you fire', () => {
    const sim = soloSim(3);
    const state = sim.state;
    const studio = state.studios[state.playerStudioId];
    const before = monthlyBurn(state, studio.id);
    const employee = addEmployee(state, studio, { role: 'programmer', skills: { gameplay: 80 }, salary: 4000 });
    expect(monthlyBurn(state, studio.id)).toBe(before + 4000 + BALANCE.studio.overheadPerEmployee);
    expect(sim.runCommand({ type: 'fire', employeeId: employee.id }).ok).toBe(true);
    expect(monthlyBurn(state, studio.id)).toBe(before);
    expect(employee.studioId).toBeNull();
    expect(state.employees[employee.id]).toBe(employee); // the pool keeps them
    expect(candidatesInPool(state).some((c) => c.id === employee.id)).toBe(true);
  });

  it('charges a signing bonus on hire and severance on the way out', () => {
    const sim = soloSim(4);
    const state = sim.state;
    const studio = state.studios[state.playerStudioId];
    const employee = studio.employeeIds.map((id) => state.employees[id]).find((e) => e.role === 'qa')!;
    const cashBefore = studio.cash;
    const severance = Math.round(employee.salary * BALANCE.hiring.severanceMonths);
    expect(sim.runCommand({ type: 'fire', employeeId: employee.id }).ok).toBe(true);
    expect(cashBefore - studio.cash).toBe(severance);
    expect(studio.finances.current.other).toBe(severance);
    expect(studio.finances.lifetime.other).toBeGreaterThanOrEqual(severance);
    expect(studio.layoffs).toBe(1);

    // Hiring: the reserve check is deliberately harsher than the money actually deducted.
    const candidate = candidatesInPool(state)[0] ?? addEmployee(state, null, { role: 'artist', salary: 3000 });
    candidate.salary = 3000;
    expect(hireUpfrontCost(candidate)).toBeGreaterThan(Math.round(3000 * BALANCE.hiring.signingBonusMonths));
    if (candidate.studioId === null) {
      studio.cash = 1_000_000;
      const cashBeforeHire = studio.cash;
      const result = sim.runCommand({ type: 'hire', candidateId: candidate.id });
      expect(result.ok).toBe(true);
      expect(studio.hires).toBe(1);
      // Only the signing bonus leaves the account up front; salary arrives monthly.
      expect(cashBeforeHire - studio.cash).toBe(Math.round(candidate.salary * BALANCE.hiring.signingBonusMonths));
      expect(studio.employeeIds).toContain(candidate.id);
    }
  });

  it('cannot pay a severance it does not have', () => {
    const sim = soloSim(5);
    const state = sim.state;
    const studio = state.studios[state.playerStudioId];
    const employee = studio.employeeIds.map((id) => state.employees[id])[0];
    studio.cash = 1;
    const result = sim.runCommand({ type: 'fire', employeeId: employee.id });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Severance');
    expect(employee.studioId).toBe(studio.id);
  });
});

describe('project money', () => {
  it('attributes labour to the project but only charges the studio the direct costs', () => {
    const sim = soloSim(6);
    const state = sim.state;
    const studio = state.studios[state.playerStudioId];
    const team = studio.employeeIds.map((id) => state.employees[id]);
    const project = createProject(state, studio.id, testRng(61), {
      title: 'Budget Test',
      genreId: 'strategy',
      platformId: 'pc',
      scope: 'small',
      budget: 500_000,
      teamIds: team.map((e) => e.id),
      risk: 0.3,
      marketing: 10_000,
    });
    state.projects[project.id] = project;
    studio.projectIds.push(project.id);
    expect(project.spent).toBe(0);

    sim.advanceMonths(2);

    const tooling = BALANCE.development.toolingCostPerDev * team.length;
    const maxDirect = tooling * team.length * 0 + tooling * 61; // tooling/day * ~61 days, generous bound
    const charged = studio.finances.months.reduce((a, r) => a + r.development, 0);
    expect(charged).toBeGreaterThan(tooling * 24); // two months of tooling at least
    expect(charged).toBeLessThan(maxDirect);
    // The project carries labour, so it always looks more expensive than the direct bill —
    // and the difference is payroll, which the economy system charges separately.
    expect(project.spent).toBeGreaterThan(charged);
    const salaries = monthlySalaryBill(state, studio.id);
    expect(project.spent - charged).toBeLessThan(salaries * 2.4);
    expect(project.spent - charged).toBeGreaterThan(salaries * 1.2);
    // Money taken from the studio for a project never disappears: the ledger balances.
    expect(studio.finances.lifetime.development).toBe(charged);
  });

  it('stalls when the budget runs out and resumes on a top-up', () => {
    const sim = soloSim(7);
    const state = sim.state;
    const studio = state.studios[state.playerStudioId];
    const team = studio.employeeIds.map((id) => state.employees[id]);
    const project = createProject(state, studio.id, testRng(71), {
      title: 'Underfunded',
      genreId: 'strategy',
      platformId: 'pc',
      scope: 'ambitious',
      budget: 1_000,
      teamIds: team.map((e) => e.id),
      risk: 0.3,
      marketing: 0,
    });
    state.projects[project.id] = project;
    studio.projectIds.push(project.id);
    sim.advanceMonths(1);
    expect(project.spent).toBeGreaterThan(project.budget);
    expect(project.status).toBe('stalled');
    expect(project.stalledDays).toBeGreaterThan(0);
    expect(project.progress).toBeLessThan(1);
    expect(studio.cash).toBeGreaterThan(0);
    expect(state.events.entries.some((e) => e.title.includes('stalled'))).toBe(true);

    const progressWhileStalled = project.progress;
    expect(sim.runCommand({ type: 'topUpBudget', projectId: project.id, amount: 400_000 }).ok).toBe(true);
    expect(project.budget).toBe(401_000);
    expect(project.status).toBe('development');
    sim.advanceMonths(1);
    expect(project.progress).toBeGreaterThan(progressWhileStalled);
    expect(project.stalledDays).toBe(0);
  });

  it('refuses to budget money the studio does not have', () => {
    const sim = soloSim(8);
    const state = sim.state;
    const studio = state.studios[state.playerStudioId];
    const team = studio.employeeIds.map((id) => state.employees[id]);
    const payload = {
      title: 'Too Big',
      genreId: 'action' as const,
      platformId: 'pc' as const,
      scope: 'large' as const,
      budget: 5_000_000,
      teamIds: team.map((e) => e.id),
      risk: 0.3,
      marketing: 0,
    };
    const result = sim.runCommand({ type: 'startProject', payload });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Needs');
    expect(studio.projectIds).toHaveLength(0);
    void studio.cash;
  });

  it('tracks committed marketing without double-charging it monthly', () => {
    const sim = soloSim(9);
    const state = sim.state;
    const studio = state.studios[state.playerStudioId];
    const team = addTeam(state, studio, ['programmer', 'designer', 'qa'], 55);
    const project = createProject(state, studio.id, testRng(91), {
      title: 'Marketing Test',
      genreId: 'puzzle',
      platformId: 'pc',
      scope: 'prototype',
      budget: 200_000,
      teamIds: team.map((e) => e.id),
      risk: 0.2,
      marketing: 25_000,
    });
    state.projects[project.id] = project;
    studio.projectIds.push(project.id);
    expect(sim.runCommand({ type: 'setMarketing', projectId: project.id, amount: 40_000 }).ok).toBe(true);
    expect(project.marketing).toBe(40_000);
    const marketingLedger = studio.finances.months.reduce((a, r) => a + r.marketing, 0) + studio.finances.current.marketing;
    sim.advanceMonths(2);
    const after = studio.finances.months.reduce((a, r) => a + r.marketing, 0) + studio.finances.current.marketing;
    expect(after).toBe(marketingLedger);
    expect(sim.runCommand({ type: 'setMarketing', projectId: project.id, amount: -5 }).ok).toBe(false);
  });
});

describe('insolvency', () => {
  it('the player gets a grace period, then the studio closes', () => {
    const sim = soloSim(10);
    const state = sim.state;
    const studio = state.studios[state.playerStudioId];
    studio.cash = -5_000;
    for (let m = 1; m < BALANCE.studio.playerGraceMonths; m += 1) {
      sim.advanceMonths(1);
      expect(studio.monthsBroke).toBe(m);
      expect(studio.status).toBe('active');
    }
    sim.advanceMonths(1);
    expect(studio.monthsBroke).toBe(BALANCE.studio.playerGraceMonths);
    expect(studio.status).toBe('defunct');
    expect(studio.defunctTick).toBe(state.calendar.tick);
    expect(state.stats.studiosClosed).toBe(1);
    expect(state.events.entries.some((e) => e.title.includes('bankrupt'))).toBe(true);
    // Shutting down must not leave ghosts behind.
    expect(studio.employeeIds).toHaveLength(0);
    expect(studio.projectIds).toHaveLength(0);
    expect(Object.values(state.employees).filter((e) => e.studioId === studio.id)).toHaveLength(0);
    // And a closed studio cannot start or ship anything.
    expect(
      sim.runCommand({
        type: 'startProject',
        payload: { title: 'Too Late', genreId: 'action', platformId: 'pc', scope: 'small', budget: 1000, teamIds: [], risk: 0.2, marketing: 0 },
      }).ok,
    ).toBe(false);
  });

  it('getting back on its feet resets the clock', () => {
    const sim = soloSim(11);
    const state = sim.state;
    const studio = state.studios[state.playerStudioId];
    studio.cash = -1000;
    sim.advanceMonths(1);
    expect(studio.monthsBroke).toBe(1);
    studio.cash = 250_000;
    sim.advanceMonths(BALANCE.studio.playerGraceMonths);
    expect(studio.monthsBroke).toBe(0);
    expect(studio.status).toBe('active');
    expect(state.stats.studiosClosed).toBe(0);
  });

  it('AI studios are held to a shorter deadline and their staff hit the open market', () => {
    const sim = soloSim(12);
    const state = sim.state;
    const rival = addStudio(state, { name: 'Broken Dreams', isPlayer: false, cash: -1, reputation: 40 });
    const team = addTeam(state, rival, ['programmer', 'designer'], 60);
    rival.cash = -1;
    for (let m = 1; m < BALANCE.studio.graceMonths; m += 1) {
      sim.advanceMonths(1);
      expect(rival.status).toBe('active');
    }
    sim.advanceMonths(1);
    expect(rival.status).toBe('defunct');
    expect(state.stats.studiosClosed).toBe(1);
    for (const member of team) {
      expect(member.studioId).toBeNull();
      expect(member.status).toBe('candidate');
    }
    expect(state.events.entries.some((e) => e.tone === 'negative' && e.title.includes('Broken Dreams'))).toBe(true);
    expect(Object.values(state.studios).filter((s) => s.status === 'active').length).toBe(1);
  });

  it('solvency only acts on month boundaries', () => {
    const state = bareWorld(13);
    const studio = addStudio(state, { cash: -100 });
    studio.monthsBroke = 99;
    const ctx = {
      state,
      rng: testRng(14),
      emit: () => undefined,
      sortedIds: <T,>(o: Record<string, T>) => Object.keys(o).sort(),
      cadence: { day: true, weekEnd: false, monthStart: false, monthEnd: false, yearStart: false },
    };
    solvencySystem.tick(ctx as never);
    expect(studio.status).toBe('active');
  });
});

describe('income attribution', () => {
  it('profit is revenue minus both kinds of cost', () => {
    const state = bareWorld(15);
    const studio = addStudio(state, { cash: 10_000 });
    const game: Partial<ReleasedGame> = {
      id: 'rl_test',
      studioId: studio.id,
      revenue: 5_000,
      developmentCost: 1_000,
      marketingSpend: 500,
      unitsSold: 250,
      price: 20,
    };
    state.releases[game.id!] = game as ReleasedGame;
    studio.releaseIds.push(game.id!);
    expect(profitOf(game as ReleasedGame)).toBe(3_500);
    expect(game.unitsSold! * game.price!).toBe(5_000);
    expect(studio.releaseIds).toHaveLength(1);
  });

  it('revenue booked by the sales system lands in the studio ledger', () => {
    const sim = soloSim(16);
    const state = sim.state;
    const studio = state.studios[state.playerStudioId];
    const team = studio.employeeIds.map((id) => state.employees[id]);
    const project = createProject(state, studio.id, testRng(161), {
      title: 'Cash Cow',
      genreId: 'action',
      platformId: 'pc',
      scope: 'prototype',
      budget: 300_000,
      teamIds: team.map((e) => e.id),
      risk: 0.2,
      marketing: 5_000,
    });
    state.projects[project.id] = project;
    studio.projectIds.push(project.id);
    let guard = 0;
    while (project.status !== 'ready' && guard < 900) {
      sim.step();
      guard += 1;
    }
    expect(project.status).toBe('ready');
    // The player decides when to ship; nothing releases itself.
    expect(studio.releaseIds).toHaveLength(0);
    expect(sim.runCommand({ type: 'releaseGame', projectId: project.id }).ok).toBe(true);
    expect(studio.releaseIds.length).toBe(1);

    const game = state.releases[studio.releaseIds[0]];
    expect(game.revenue).toBe(0);
    sim.advanceMonths(3);
    expect(game.revenue).toBeGreaterThan(0);
    expect(studio.finances.lifetime.revenue).toBe(game.revenue);
    const revenueRow = studio.finances.months.reduce((a, r) => a + r.revenue, 0);
    expect(revenueRow).toBeGreaterThan(0);
    // Weekly sales are what produce the money; the ledger must not invent any.
    const fromSales = game.sales.reduce((a, w) => a + w.revenue, 0);
    expect(fromSales).toBeGreaterThan(0);
    expect(Math.abs(game.revenue - game.sales.reduce((a, w) => a + w.revenue, 0))).toBeLessThan(1);
  });
});
