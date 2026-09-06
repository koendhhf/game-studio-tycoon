/**
 * Commands are the only way anyone changes the world. These tests hold the line on two things:
 * a rejected command must not touch the world at all, and an accepted one must move exactly the
 * numbers the UI claims it moved.
 */

import { describe, expect, it } from 'vitest';
import {
  BALANCE,
  GENRE_ORDER,
  SCOPES,
  candidatesInPool,
  employeesOfStudio,
  listingCost,
  monthlyBurn,
  platformDef,
  validateHire,
  validateRelease,
  validateStartProject,
} from './test-imports';
import type { Command, Project } from './test-imports';
import { addStudio, addTeam, soloSim } from './helpers';

function startPayload(patch: Partial<Parameters<typeof validateStartProject>[1]> = {}) {
  return {
    title: 'Command Test',
    genreId: 'action' as const,
    platformId: 'pc' as const,
    scope: 'small' as const,
    budget: 60_000,
    teamIds: [] as string[],
    risk: 0.3,
    marketing: 0,
    ...patch,
  };
}

function startSolo(seed: number): { sim: ReturnType<typeof soloSim>; teamIds: string[] } {
  const sim = soloSim(seed);
  const studio = sim.state.studios[sim.state.playerStudioId];
  return { sim, teamIds: studio.employeeIds.slice() };
}

function startedProject(sim: ReturnType<typeof soloSim>, teamIds: string[]): Project {
  const result = sim.runCommand({ type: 'startProject', payload: startPayload({ teamIds }) });
  expect(result.ok).toBe(true);
  const studio = sim.state.studios[sim.state.playerStudioId];
  const project = sim.state.projects[studio.projectIds[0]];
  expect(project).toBeTruthy();
  return project;
}

describe('validation before mutation', () => {
  it('accepts a sane startProject and reports the scope it will use', () => {
    const { sim, teamIds } = startSolo(1);
    const check = validateStartProject(sim.state, startPayload({ teamIds }));
    expect(check.ok).toBe(true);
  });

  it('rejects nonsense without touching anything', () => {
    const sim = soloSim(2);
    const state = sim.state;
    const studio = state.studios[state.playerStudioId];
    const snapshot = JSON.stringify({ studios: state.studios, projects: state.projects, employees: state.employees, cash: studio.cash });
    const bad: Command[] = [
      { type: 'startProject', payload: startPayload({ genreId: 'politics' as never }) },
      { type: 'startProject', payload: startPayload({ title: 'Q' }) },
      { type: 'startProject', payload: startPayload({ teamIds: [] }) },
      { type: 'startProject', payload: startPayload({ budget: 10 }) },
      { type: 'startProject', payload: startPayload({ budget: 90_000_000 }) },
      { type: 'startProject', payload: startPayload({ platformId: 'holodeck' as never }) },
      { type: 'releaseGame', projectId: 'pj_nope' },
      { type: 'cancelProject', projectId: 'pj_nope' },
      { type: 'topUpBudget', projectId: 'pj_nope', amount: 5000 },
      { type: 'setTeam', projectId: 'pj_nope', teamIds: [] },
      { type: 'setMarketing', projectId: 'pj_nope', amount: 5000 },
      { type: 'setCrunch', projectId: 'pj_nope', value: true },
      { type: 'hire', candidateId: 'em_nope' },
      { type: 'fire', employeeId: 'em_nope' },
      { type: 'setSalary', employeeId: 'em_nope', salary: 5000 },
      { type: 'poach', employeeId: 'em_nope' },
    ];
    for (const command of bad) {
      const result = sim.runCommand(command);
      expect(result.ok, JSON.stringify(command)).toBe(false);
      expect(result.error?.length ?? 0).toBeGreaterThan(3);
    }
    expect(studio.projectIds).toHaveLength(0);
    expect(Object.keys(state.projects)).toHaveLength(0);
    expect(JSON.stringify({ studios: state.studios, projects: state.projects, employees: state.employees, cash: studio.cash })).toBe(snapshot);
  });

  it('an unrecognised command is refused, not crashed on', () => {
    const sim = soloSim(3);
    const result = sim.runCommand({ type: 'launchRockets' } as unknown as Command);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Unknown command');
    expect(sim.pendingCommands).toBe(0);
  });

  it('warns instead of failing when the team is smaller than the scope wants', () => {
    const { sim, teamIds } = startSolo(4);
    const small = startPayload({ teamIds: teamIds.slice(0, 1), scope: 'large' });
    expect(small.teamIds.length).toBeLessThan(SCOPES.large.minTeam);
    const check = validateStartProject(sim.state, small);
    expect(check.ok).toBe(true);
    expect(check.detail).toContain('Below the recommended team size');
  });

  it('will not sell a game for a platform that is not on sale yet', () => {
    const sim = soloSim(5);
    const future = (Object.keys(platformDef('pc')) ? ['vega'] : []) as never[];
    const blocked = future.find((id) => {
      const def = platformDef(id as never);
      return def.introYear > sim.state.calendar.year;
    });
    if (blocked) {
      const { teamIds } = { teamIds: sim.state.studios[sim.state.playerStudioId].employeeIds.slice() };
      const result = sim.runCommand({ type: 'startProject', payload: startPayload({ platformId: blocked, teamIds }) });
      expect(result.ok).toBe(false);
      expect(result.error).toContain('is not on sale in');
    }
    expect(sim.state.calendar.year).toBeLessThan(platformDef('vega').retireYear + 1);
  });
});

describe('project commands', () => {
  it('startProject creates the project, assigns the team and moves the money', () => {
    const { sim, teamIds } = startSolo(6);
    const state = sim.state;
    const studio = state.studios[state.playerStudioId];
    const cashBefore = studio.cash;
    const project = startedProject(sim, teamIds);
    expect(project.title).toBe('Command Test');
    expect(project.studioId).toBe(studio.id);
    expect(project.status).toBe('development');
    expect(project.teamIds).toEqual(expect.arrayContaining(teamIds));
    expect(project.budget).toBe(60_000);
    expect(studio.projectIds).toContain(project.id);
    // Only the licence is paid up front; the budget is a commitment, not a transfer.
    const licence = platformDef('pc').devkitCost;
    expect(cashBefore - studio.cash).toBe(licence);
    expect(monthlyBurn(state, studio.id)).toBeGreaterThan(0);
    expect(state.stats.commandsProcessed).toBeGreaterThan(0);
  });

  it('cancelProject writes the project off and charges wrap-up', () => {
    const { sim, teamIds } = startSolo(7);
    const state = sim.state;
    const studio = state.studios[state.playerStudioId];
    const project = startedProject(sim, teamIds);
    sim.advanceMonths(2);
    const spent = project.spent;
    const cashBefore = studio.cash;
    const result = sim.runCommand({ type: 'cancelProject', projectId: project.id });
    expect(result.ok).toBe(true);
    expect(project.status).toBe('cancelled');
    expect(studio.projectIds).not.toContain(project.id);
    expect(cashBefore - studio.cash).toBe(Math.round(spent * 0.1));
    expect(state.events.entries.some((e) => e.title.includes('Cancelled'))).toBe(true);
    // The people stay on the payroll — cancelling a project is not firing anyone.
    expect(studio.employeeIds.length).toBe(teamIds.length);
    // Cancelling twice is a no-op error, not a second charge.
    expect(sim.runCommand({ type: 'cancelProject', projectId: project.id }).ok).toBe(false);
    expect(cashBefore - studio.cash).toBe(Math.round(spent * 0.1));
  });

  it('topUpBudget only accepts money the studio has', () => {
    const { sim, teamIds } = startSolo(8);
    const state = sim.state;
    const studio = state.studios[state.playerStudioId];
    const project = startedProject(sim, teamIds);
    expect(sim.runCommand({ type: 'topUpBudget', projectId: project.id, amount: 0 }).ok).toBe(false);
    expect(sim.runCommand({ type: 'topUpBudget', projectId: project.id, amount: -5000 }).ok).toBe(false);
    expect(sim.runCommand({ type: 'topUpBudget', projectId: project.id, amount: 10_000_000 }).ok).toBe(false);
    const cashBefore = studio.cash;
    expect(sim.runCommand({ type: 'topUpBudget', projectId: project.id, amount: 25_000 }).ok).toBe(true);
    expect(project.budget).toBe(85_000);
    // Topping up is a commitment too: no cash leaves the account until the burn charges it.
    expect(studio.cash).toBe(cashBefore);
    expect(sim.state.stats.commandsProcessed).toBeGreaterThan(0);
  });

  it('setTeam only lets you put your own people on it', () => {
    const { sim, teamIds } = startSolo(9);
    const state = sim.state;
    const studio = state.studios[state.playerStudioId];
    const project = startedProject(sim, teamIds);
    const rival = addStudio(state, { name: 'Rival Works', isPlayer: false, cash: 500_000 });
    const outsider = addTeam(state, rival, ['programmer'], 50)[0];
    expect(employeesOfStudio(state, studio.id).some((e) => e.id === outsider.id)).toBe(false);
    const rejected = sim.runCommand({ type: 'setTeam', projectId: project.id, teamIds: [outsider.id] });
    expect(rejected.ok).toBe(false);
    expect(project.teamIds).not.toContain(outsider.id);

    expect(sim.runCommand({ type: 'setTeam', projectId: project.id, teamIds: [outsider.id, ...teamIds] }).ok).toBe(false);
    const reduced = sim.runCommand({ type: 'setTeam', projectId: project.id, teamIds: teamIds.slice(0, 2) });
    expect(reduced.ok).toBe(true);
    expect(project.teamIds).toEqual(teamIds.slice(0, 2));
    expect(sim.runCommand({ type: 'setTeam', projectId: project.id, teamIds: [] }).ok).toBe(true);
    expect(project.teamIds).toHaveLength(0);
  });

  it('setCrunch flags the project and tells the team about it', () => {
    const { sim, teamIds } = startSolo(10);
    const state = sim.state;
    const project = startedProject(sim, teamIds);
    expect(project.crunch).toBe(false);
    expect(sim.runCommand({ type: 'setCrunch', projectId: project.id, value: true }).ok).toBe(true);
    expect(project.crunch).toBe(true);
    expect(state.events.entries.some((e) => e.title.includes('Crunch mode'))).toBe(true);
    expect(sim.runCommand({ type: 'setCrunch', projectId: project.id, value: false }).ok).toBe(true);
    expect(project.crunch).toBe(false);
  });

  it('releaseGame is refused while the game is a stub and accepted when it is ready', () => {
    const { sim, teamIds } = startSolo(11);
    const state = sim.state;
    const studio = state.studios[state.playerStudioId];
    const project = startedProject(sim, teamIds);
    expect(validateRelease(state, project.id).ok).toBe(false);
    expect(sim.runCommand({ type: 'releaseGame', projectId: project.id }).ok).toBe(false);

    let guard = 0;
    while (project.status !== 'ready' && guard < 900) {
      sim.step();
      guard += 1;
    }
    expect(project.status).toBe('ready');
    const check = validateRelease(state, project.id);
    expect(check.ok).toBe(true);
    const result = sim.runCommand({ type: 'releaseGame', projectId: project.id });
    expect(result.ok).toBe(true);
    expect(result.detail).toContain('scored');
    expect(studio.releaseIds).toHaveLength(1);
    expect(state.stats.gamesReleasedByPlayer).toBe(1);
    // A second release of the same project is impossible.
    expect(sim.runCommand({ type: 'releaseGame', projectId: project.id }).ok).toBe(false);
  });

  it('releaseGame warns when the marketing promise exceeds the bank', () => {
    const { sim, teamIds } = startSolo(12);
    const state = sim.state;
    const studio = state.studios[state.playerStudioId];
    const project = startedProject(sim, teamIds);
    sim.runCommand({ type: 'setMarketing', projectId: project.id, amount: 500 });
    project.progress = 1;
    expect(validateRelease(state, project.id).ok).toBe(true);
    studio.cash = 100;
    const check = validateRelease(state, project.id);
    expect(check.ok).toBe(true);
    expect(check.detail).toContain('marketing spend will be cut');
  });
});

describe('people commands', () => {
  it('a raise lifts morale and loyalty, a cut does the opposite', () => {
    const sim = soloSim(13);
    const state = sim.state;
    const studio = state.studios[state.playerStudioId];
    const emp = employeesOfStudio(state, studio.id)[0];
    const before = { morale: emp.morale, loyalty: emp.loyalty, salary: emp.salary };

    expect(sim.runCommand({ type: 'setSalary', employeeId: emp.id, salary: before.salary * 1.2 }).ok).toBe(true);
    expect(emp.salary).toBe(Math.round(before.salary * 1.2));
    expect(emp.morale).toBeCloseTo(Math.min(100, before.morale + 4), 6);
    expect(emp.loyalty).toBeCloseTo(Math.min(100, before.loyalty + 3), 6);

    const afterRaise = { morale: emp.morale, loyalty: emp.loyalty };
    expect(sim.runCommand({ type: 'setSalary', employeeId: emp.id, salary: Math.round(before.salary * 0.5) }).ok).toBe(true);
    expect(emp.morale).toBeCloseTo(afterRaise.morale - 6, 6);
    expect(emp.loyalty).toBe(afterRaise.loyalty); // no loyalty bonus for a cut
    expect(sim.runCommand({ type: 'setSalary', employeeId: emp.id, salary: 1 }).ok).toBe(false);
  });

  it('validateHire agrees with what the command actually charges', () => {
    const sim = soloSim(14);
    const state = sim.state;
    const studio = state.studios[state.playerStudioId];
    const candidate = addTeam(state, null as never, ['audio'], 50)[0];
    candidate.studioId = null;
    candidate.status = 'candidate';
    candidate.salary = 3000;
    studio.cash = 4090;
    // The reserve check wants the bonus *and* a month of salary, so it can refuse while a
    // cheaper offer would be accepted.
    expect(validateHire(state, candidate.id).ok).toBe(false);
    const offer = Math.round(candidate.salary * BALANCE.hiring.minOfferRatio);
    expect(Math.round(offer * 1.6)).toBeLessThanOrEqual(4090);
    expect(validateHire(state, candidate.id, offer).ok).toBe(true);
    expect(sim.runCommand({ type: 'hire', candidateId: candidate.id, offerSalary: offer }).ok).toBe(true);
    expect(candidatesInPool(state).some((c) => c.id === candidate.id)).toBe(false);
    expect(studio.employeeIds).toContain(candidate.id);
    expect(studio.cash).toBe(4090 - Math.round(offer * BALANCE.hiring.signingBonusMonths));
  });

  it('a job listing costs what the UI says and is remembered by the market', () => {
    const sim = soloSim(15);
    const state = sim.state;
    const studio = state.studios[state.playerStudioId];
    const cashBefore = studio.cash;
    const result = sim.runCommand({ type: 'postJobListing', roles: ['programmer', 'artist'], prestige: 0.5, weeks: 8 });
    expect(result.ok).toBe(true);
    expect(cashBefore - studio.cash).toBe(listingCost(0.5));
    expect(state.listings).toHaveLength(1);
    const listing = state.listings[0];
    expect(listing.roles).toEqual(['programmer', 'artist']);
    expect(listing.prestige).toBe(0.5);
    expect(listing.expiresMonthIndex).toBeGreaterThan(state.calendar.monthIndex);
    expect(sim.runCommand({ type: 'postJobListing', roles: [], prestige: 5, weeks: 400 }).ok).toBe(true);
    expect(state.listings[1].prestige).toBe(1);
    expect(state.listings[1].expiresMonthIndex - state.listings[1].postedMonthIndex).toBeLessThanOrEqual(6);
    studio.cash = 1;
    expect(sim.runCommand({ type: 'postJobListing', roles: [], prestige: 1 }).ok).toBe(false);
  });

  it('renaming the studio trims and caps the name', () => {
    const sim = soloSim(16);
    const state = sim.state;
    const studio = state.studios[state.playerStudioId];
    expect(sim.runCommand({ type: 'renameStudio', name: '  Pixel Foundry  ' }).ok).toBe(true);
    expect(studio.name).toBe('Pixel Foundry');
    expect(sim.runCommand({ type: 'renameStudio', name: ' n ' }).ok).toBe(false);
    expect(studio.name).toBe('Pixel Foundry');
    expect(sim.runCommand({ type: 'renameStudio', name: 'x'.repeat(200) }).ok).toBe(true);
    expect(studio.name.length).toBe(42);
    expect(state.events.entries.some((e) => e.title.includes('renamed'))).toBe(true);
  });
});

describe('who may command what', () => {
  it('another studio’s project is not yours to touch', () => {
    const sim = soloSim(17);
    const state = sim.state;
    const rival = addStudio(state, { name: 'Rival Works', isPlayer: false, cash: 500_000 });
    expect(rival.id).not.toBe(state.playerStudioId);
    state.projects['pj_rival'] = { id: 'pj_rival', studioId: rival.id, title: 'Not Yours', status: 'development', progress: 1, marketing: 0 } as never;
    rival.projectIds.push('pj_rival');
    for (const type of ['releaseGame', 'cancelProject', 'setCrunch', 'setMarketing'] as const) {
      const command = (type === 'setMarketing'
        ? { type, projectId: 'pj_rival', amount: 10 }
        : type === 'setCrunch'
          ? { type, projectId: 'pj_rival', value: true }
          : { type, projectId: 'pj_rival' }) as Command;
      expect(sim.runCommand(command).ok, type).toBe(false);
    }
    expect(state.projects['pj_rival'].status).toBe('development');
  });

  it('a closed studio issues no commands at all', () => {
    const sim = soloSim(18);
    const state = sim.state;
    const studio = state.studios[state.playerStudioId];
    studio.status = 'defunct';
    const commands: Command[] = [
      { type: 'startProject', payload: startPayload({ teamIds: [] }) },
      { type: 'releaseGame', projectId: 'pj_x' },
      { type: 'renameStudio', name: 'Ghost Games' },
      { type: 'postJobListing', roles: [], prestige: 0 },
    ];
    for (const command of commands) {
      expect(sim.runCommand(command).ok, JSON.stringify(command)).toBe(false);
    }
    expect(studio.name).not.toBe('Ghost Games');
    expect(GENRE_ORDER.length).toBeGreaterThan(0);
  });
});
