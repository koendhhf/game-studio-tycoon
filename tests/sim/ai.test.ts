/**
 * AI studios are not set dressing: they hire, staff up, fund, ship, earn and fail using the
 * same systems and the same validators the player's commands run through. These tests check the
 * decisions are real, bounded, and theirs — personality included.
 */

import { describe, expect, it } from 'vitest';
import {
  BALANCE,
  DEFAULT_CONFIG,
  Simulation,
  monthlySalaryBill,
  GENRE_ORDER,
  GENRES,
  ROLES,
  ROLE_ORDER,
  aiStudioMonth,
  aiSystem,
  createStudio,
  employeesOfStudio,
  generateWorld,
  monthlyBurn,
  projectOf,
  scopeDef,
  studioHeadcount,
} from './test-imports';
import type { Project, Studio, WorldState } from './test-imports';
import { createProject } from './test-imports';
import { QUALITY_DIMENSIONS } from './test-imports';
import { addEmployee, addStudio, addTeam, bareWorld, soloSim, testRng } from './helpers';

function aiStudios(state: WorldState): Studio[] {
  return Object.values(state.studios).filter((s) => !s.isPlayer);
}

function rivalCount(state: WorldState): number {
  return aiStudios(state).length;
}

describe('the industry at game start', () => {
  it('founds the number of rivals the config asked for, each with a personality', () => {
    const state = generateWorld({ seed: 41, studioName: 'Player One' });
    const rivals = aiStudios(state);
    expect(rivals.length).toBe(state.config.aiStudioCount);
    expect(rivals.length).toBeGreaterThanOrEqual(10);

    const names = new Set<string>([state.studios[state.playerStudioId].name, ...rivals.map((s) => s.name)]);
    expect(names.size).toBe(rivals.length + 1);

    for (const rival of rivals) {
      const profile = rival.ai;
      expect(profile, rival.name).toBeTruthy();
      for (const key of ['ambition', 'riskAppetite', 'qualityFocus', 'marketingFocus', 'hiringAppetite', 'adaptability', 'loyalty'] as const) {
        const value = profile![key];
        expect(value, `${rival.name}.${key}`).toBeGreaterThanOrEqual(0);
        expect(value, `${rival.name}.${key}`).toBeLessThanOrEqual(1);
      }
      expect(profile!.style.length).toBeGreaterThan(2);
      expect(profile!.tagline.length).toBeGreaterThan(8);
      expect(profile!.preferredGenres.length).toBeGreaterThan(0);
      for (const genre of profile!.preferredGenres) expect(GENRE_ORDER).toContain(genre);
      expect(rival.isPlayer).toBe(false);
      expect(rival.status).toBe('active');
      expect(rival.cash).toBeGreaterThan(0);
      expect(rival.reputation).toBeGreaterThan(BALANCE.studio.repMin);
      expect(rival.foundedYear).toBeLessThanOrEqual(state.calendar.year);
      expect(rival.employeeIds.length).toBeGreaterThan(0);
      // They arrive with real people on the books, not with a number in a field.
      for (const id of rival.employeeIds) {
        const emp = state.employees[id];
        expect(emp, `${rival.name} employee ${id}`).toBeTruthy();
        expect(emp.studioId).toBe(rival.id);
        expect(ROLES[emp.role]).toBeTruthy();
        expect(emp.salary).toBeGreaterThan(0);
      }
    }
  });

  it('gives the player a small studio, not a head start', () => {
    const state = generateWorld({ seed: 42, studioName: 'Player One' });
    const player = state.studios[state.playerStudioId];
    expect(player.name).toBe('Player One');
    expect(player.isPlayer).toBe(true);
    expect(player.ai).toBeNull();
    expect(player.cash).toBe(BALANCE.studio.startingCash);
    expect(player.employeeIds.length).toBe(BALANCE.studio.playerStartStaff);
    expect(player.projectIds).toHaveLength(0);
    expect(player.releaseIds).toHaveLength(0);
    expect(studioHeadcount(player)).toBe(player.employeeIds.length);
    expect(rivalCount(state)).toBe(state.config.aiStudioCount);
    // The rivals are bigger and richer than the player, deliberately.
    for (const rival of aiStudios(state)) {
      expect(rival.cash).toBeGreaterThan(0);
      expect(rival.employeeIds.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('is reproducible from the seed alone', () => {
    const a = generateWorld({ seed: 43, studioName: 'Same' });
    const b = generateWorld({ seed: 43, studioName: 'Same' });
    expect(JSON.stringify(a.studios)).toBe(JSON.stringify(b.studios));
    expect(JSON.stringify(a.market)).toBe(JSON.stringify(b.market));
    const c = generateWorld({ seed: 44, studioName: 'Same' });
    expect(JSON.stringify(c.studios)).not.toBe(JSON.stringify(a.studios));
  });
});

describe('monthly decisions', () => {
  function rivalWorld(seed: number, opts: { cash?: number; reputation?: number } = {}): { state: WorldState; rival: Studio } {
    const state = bareWorld(seed);
    const rival = createStudio(state, testRng(seed), {
      name: 'Thinking Machines',
      isPlayer: false,
      foundedYear: state.calendar.year,
      cash: opts.cash ?? 1_200_000,
      reputation: opts.reputation ?? 30,
    });
    state.playerStudioId = rival.id; // so shared helpers resolve, but this studio is an AI one
    rival.isPlayer = false;
    addTeam(state, rival, ['programmer', 'designer', 'artist', 'qa'], 62);
    return { state, rival };
  }

  it('starts a project when it has money and an empty pipeline', () => {
    const { state, rival } = rivalWorld(51);
    expect(rival.projectIds).toHaveLength(0);
    const cashBefore = rival.cash;
    const actionsBefore = state.stats.aiActionsTaken;
    aiStudioMonth(state, rival, testRng(52));
    expect(rival.projectIds.length).toBe(1);
    const project = state.projects[rival.projectIds[0]];
    expect(project.studioId).toBe(rival.id);
    expect(project.status).toBe('development');
    expect(project.teamIds.length).toBeGreaterThan(0);
    expect(project.budget).toBeGreaterThan(0);
    expect(scopeDef(project.scope).workUnits).toBeGreaterThan(0);
    expect(project.risk).toBeGreaterThanOrEqual(0);
    expect(project.risk).toBeLessThanOrEqual(1);
    expect(GENRE_ORDER).toContain(project.genreId);
    expect(project.title.length).toBeGreaterThan(1);
    // Licence fees are real money, paid from the rival's own account only.
    expect(rival.cash).toBeLessThanOrEqual(cashBefore);
    expect(state.stats.aiActionsTaken).toBe(actionsBefore + 1);
    expect(state.events.entries.some((e) => e.title.includes('announced'))).toBe(true);
  });

  it('will not start what it cannot afford, and will not staff a project with nobody', () => {
    const broke = rivalWorld(53, { cash: 2_000 });
    expect(broke.rival.projectIds).toHaveLength(0);
    const cashBefore = broke.rival.cash;
    aiStudioMonth(broke.state, broke.rival, testRng(54));
    expect(broke.rival.projectIds).toHaveLength(0);
    expect(broke.rival.cash).toBe(cashBefore);

    const noStaff = bareWorld(55);
    const alone = createStudio(noStaff, testRng(56), { name: 'Empty Rooms', isPlayer: false, foundedYear: noStaff.calendar.year, cash: 5_000_000, reputation: 20 });
    noStaff.playerStudioId = alone.id;
    alone.isPlayer = false;
    aiStudioMonth(noStaff, alone, testRng(57));
    expect(alone.projectIds).toHaveLength(0);
  });

  it('hires when it can afford people and is short-handed', () => {
    const { state, rival } = rivalWorld(58);
    const before = rival.employeeIds.length;
    // Seed the open market with one cheap applicant per discipline, so the choice is the
    // studio's and not an artefact of an empty pool.
    for (const role of ROLE_ORDER) {
      const person = addEmployee(state, null, { role, salary: 1300, skills: { gameplay: 50 } });
      expect(person.studioId).toBeNull();
    }
    rival.ai!.hiringAppetite = 1;
    rival.cash = 6_000_000;
    let hired = 0;
    for (let m = 0; m < 12; m += 1) {
      const n = rival.employeeIds.length;
      aiStudioMonth(state, rival, testRng(59 + m));
      hired += rival.employeeIds.length - n;
    }
    expect(hired).toBeGreaterThan(0);
    expect(rival.employeeIds.length).toBe(before + hired);
    for (const id of rival.employeeIds) expect(state.employees[id].studioId).toBe(rival.id);
    expect(rival.hires).toBeGreaterThan(0);
  });

  it('cuts staff when the runway is short and it is not a family friendly outfit', () => {
    const { state, rival } = rivalWorld(60);
    rival.ai!.loyalty = 0.1;
    const project = {
      id: 'pj_burn',
      studioId: rival.id,
      title: 'Money Pit',
      genreId: 'action',
      platformId: 'pc',
      scope: 'medium',
      status: 'development',
      progress: 0.4,
      budget: 4_000_000,
      spent: 2_000_000,
      workRequired: 1000,
      workDone: 400,
      teamIds: rival.employeeIds.slice(),
      bugs: 20,
      marketing: 0,
      crunch: false,
      risk: 0.3,
    } as unknown as Project;
    state.projects[project.id] = project;
    rival.projectIds.push(project.id);
    rival.cash = monthlyBurn(state, rival.id) * 0.5; // one week of runway
    const before = rival.employeeIds.length;
    aiStudioMonth(state, rival, testRng(61));
    expect(rival.employeeIds.length).toBeLessThan(before);
    expect(rival.layoffs).toBeGreaterThan(0);
    for (const emp of Object.values(state.employees).filter((e) => e.studioId === null)) {
      expect(employeesOfStudio(state, rival.id).some((x) => x.id === emp.id)).toBe(false);
    }
  });

  it('ships a finished game once the bugs are down, and waits when they are not', () => {
    const ready = rivalWorld(62);
    const project = finishedProject(ready.state, ready.rival, { bugs: 0 });
    project.progress = 1;
    project.status = 'ready';
    ready.rival.cash = 2_000_000;
    aiStudioMonth(ready.state, ready.rival, testRng(63));
    expect(ready.rival.releaseIds.length).toBe(1);
    const game = ready.state.releases[ready.rival.releaseIds[0]];
    expect(game.title).toBe(project.title);
    expect(project.status).toBe('released');
    expect(ready.rival.projectIds).toHaveLength(0);

    // A quality-first studio does not ship a broken build, even when it is finished.
    const patient = rivalWorld(64);
    patient.rival.ai!.qualityFocus = 0.95;
    const buggy = finishedProject(patient.state, patient.rival, { bugs: 900 });
    buggy.progress = 1;
    buggy.status = 'ready';
    buggy.daysInPolish = 0;
    patient.rival.cash = 2_000_000;
    aiStudioMonth(patient.state, patient.rival, testRng(65));
    expect(patient.rival.releaseIds).toHaveLength(0);
    expect(buggy.status).not.toBe('released');

    // A ship-early studio sends the same build to the factory across the counter.
    const pusher = rivalWorld(66);
    pusher.rival.ai!.qualityFocus = 0.1;
    const also = finishedProject(pusher.state, pusher.rival, { bugs: 900 });
    also.progress = 0.95;
    also.status = 'development';
    pusher.rival.cash = 2_000_000;
    aiStudioMonth(pusher.state, pusher.rival, testRng(67));
    expect(pusher.rival.releaseIds.length).toBe(1);
    // ...and history records it as the buggy, part-finished game it was.
    const shipped = pusher.state.releases[pusher.rival.releaseIds[0]];
    expect(shipped.bugsAtRelease).toBeGreaterThan(0);
    expect(shipped.completeness).toBeLessThan(1);
  });

  it('panics and ships early when the money is nearly gone', () => {
    const { state, rival } = rivalWorld(68);
    rival.ai!.qualityFocus = 0.9;
    const project = finishedProject(state, rival, { bugs: 400 });
    project.progress = 0.8;
    project.status = 'development';
    rival.cash = monthlyBurn(state, rival.id) * 0.5;
    aiStudioMonth(state, rival, testRng(69));
    expect(rival.releaseIds.length).toBe(1);
    expect(state.releases[rival.releaseIds[0]].completeness).toBeCloseTo(0.8, 6);
  });

  it('buys marketing in proportion to its personality', () => {
    const quiet = rivalWorld(70);
    const loud = rivalWorld(70);
    quiet.rival.ai!.marketingFocus = 0.02;
    loud.rival.ai!.marketingFocus = 0.98;
    for (const { rival } of [quiet, loud]) {
      const project = finishedProject(rivalWorld(70).state, rival, { bugs: 0 });
      void project;
    }
    const quietProject = finishedProject(quiet.state, quiet.rival, { bugs: 0 });
    const loudProject = finishedProject(loud.state, loud.rival, { bugs: 0 });
    quietProject.progress = 1;
    loudProject.progress = 1;
    quietProject.status = 'ready';
    loudProject.status = 'ready';
    quiet.rival.cash = 3_000_000;
    loud.rival.cash = 3_000_000;
    aiStudioMonth(quiet.state, quiet.rival, testRng(71));
    aiStudioMonth(loud.state, loud.rival, testRng(71));
    const quietGame = quiet.state.releases[quiet.rival.releaseIds[0]];
    const loudGame = loud.state.releases[loud.rival.releaseIds[0]];
    expect(loudGame.marketingSpend).toBeGreaterThan(quietGame.marketingSpend);
  });

  it('is a no-op for the player and for closed studios', () => {
    const sim = soloSim(72);
    const state = sim.state;
    const player = state.studios[state.playerStudioId];
    const cashBefore = player.cash;
    aiStudioMonth(state, player, testRng(73));
    expect(player.cash).toBe(cashBefore);
    expect(player.projectIds).toHaveLength(0);

    const rival = addStudio(state, { name: 'Dead Letter', isPlayer: false, cash: 900_000 });
    rival.ai = { ambition: 0.9, riskAppetite: 0.9, qualityFocus: 0.5, marketingFocus: 0.5, hiringAppetite: 0.9, adaptability: 0.5, loyalty: 0.5, preferredGenres: ['action'], style: 'x', tagline: 'y' };
    rival.status = 'defunct';
    aiStudioMonth(state, rival, testRng(74));
    expect(rival.projectIds).toHaveLength(0);
    // A studio with no personality data at all is skipped, not crashed on.
    const blank = addStudio(state, { name: 'Blank', isPlayer: false, cash: 100 });
    blank.ai = null;
    blank.isPlayer = false;
    expect(() => aiStudioMonth(state, blank, testRng(75))).not.toThrow();
  });
});

describe('the AI as a system', () => {
  it('only runs on month boundaries and touches every rival', () => {
    const state = bareWorld(76);
    const rival = addStudio(state, { name: 'Boundary', isPlayer: false, cash: 4_000_000 });
    rival.ai = { ambition: 0.8, riskAppetite: 0.4, qualityFocus: 0.5, marketingFocus: 0.4, hiringAppetite: 0.6, adaptability: 0.5, loyalty: 0.5, preferredGenres: ['rpg'], style: 's', tagline: 't' };
    addTeam(state, rival, ['programmer', 'designer', 'artist'], 60);
    state.playerStudioId = rival.id;
    rival.isPlayer = false;
    const ctx = (monthStart: boolean) => ({
      state,
      rng: testRng(77),
      emit: () => undefined,
      sortedIds: <T,>(o: Record<string, T>) => Object.keys(o).sort(),
      cadence: { monthStart, weekEnd: false, monday: false, yearStart: false },
    });
    aiSystem.tick(ctx(false) as never);
    expect(rival.projectIds).toHaveLength(0);
    aiSystem.tick(ctx(true) as never);
    expect(rival.projectIds.length).toBeGreaterThan(0);
  });

  it('a whole industry runs for years, releases games, and stays internally consistent', () => {
    const sim = Simulation.create({
      seed: 78,
      studioName: 'Long Run Studios',
      config: { ...DEFAULT_CONFIG, aiStudioCount: 14, aiStudioTarget: 14 },
    });
    const state = sim.state;
    const startCash = aiStudios(state).reduce((a, s2) => a + s2.cash, 0);
    sim.advanceMonths(36);

    const games = Object.values(state.releases);
    expect(games.length).toBeGreaterThan(20);
    expect(state.stats.aiActionsTaken).toBeGreaterThan(20);
    expect(state.stats.gamesReleasedTotal).toBe(games.length);

    // Personality shows up in the record: several genres, a spread of scores, a live market.
    const genres = new Set(games.map((g) => g.genreId));
    expect(genres.size).toBeGreaterThan(3);
    const scores = games.map((g) => g.reviewScore);
    expect(Math.max(...scores) - Math.min(...scores)).toBeGreaterThan(20);
    for (const game of games) {
      expect(game.unitsSold).toBeGreaterThanOrEqual(0);
      expect(game.revenue).toBeGreaterThanOrEqual(0);
      expect(game.price).toBeGreaterThan(0);
      expect(game.credits.length).toBeGreaterThan(0);
    }

    // Money moved: some studios richer, some poorer, nobody in an impossible state.
    const endCash = aiStudios(state).reduce((a, s2) => a + s2.cash, 0);
    expect(endCash).not.toBe(startCash);
    for (const rival of aiStudios(state)) {
      expect(Number.isFinite(rival.cash)).toBe(true);
      expect(Number.isFinite(rival.reputation)).toBe(true);
      expect(rival.reputation).toBeGreaterThanOrEqual(BALANCE.studio.repMin);
      expect(rival.reputation).toBeLessThanOrEqual(BALANCE.studio.repMax);
      expect(rival.employeeIds.length).toBe(studioHeadcount(rival));
      for (const id of rival.projectIds) {
        const project = projectOf(state, id);
        expect(project, `${rival.name} project ${id}`).toBeTruthy();
        expect(project!.studioId).toBe(rival.id);
        expect(['development', 'polish', 'stalled', 'ready']).toContain(project!.status);
      }
      for (const id of rival.releaseIds) expect(state.releases[id]).toBeTruthy();
    }
    // Nobody's books invented employees: every employed person names a studio that lists them.
    for (const emp of Object.values(state.employees)) {
      if (emp.studioId === null) continue;
      expect(state.studios[emp.studioId].employeeIds).toContain(emp.id);
    }
    // The player was not touched by any of it: their ledger only holds their own bill.
    const player = state.studios[state.playerStudioId];
    expect(player.employeeIds.length).toBe(BALANCE.studio.playerStartStaff);
    expect(player.releaseIds).toHaveLength(0);
    // The player was never charged for any of it: no revenue, no project money, and payroll
    // that only ever tracks their own (drifting) bill.
    const ownBill = monthlySalaryBill(state, player.id);
    for (const row of player.finances.months) {
      expect(row.revenue).toBe(0);
      expect(row.development).toBe(0);
      expect(row.marketing).toBe(0);
      expect(row.salaries).toBeGreaterThan(ownBill * 0.5);
      expect(row.salaries).toBeLessThan(ownBill * 2);
    }
  });
});

let finishedCounter = 0;

function finishedProject(state: WorldState, studio: Studio, opts: { bugs: number }): Project {
  finishedCounter += 1;
  const project = createProject(state, studio.id, testRng(900 + finishedCounter), {
    title: `Finished Business ${finishedCounter}`,
    genreId: studio.ai?.preferredGenres[0] ?? 'action',
    platformId: 'pc',
    scope: 'medium',
    budget: 400_000,
    teamIds: studio.employeeIds.slice(),
    risk: 0.3,
    marketing: 0,
  });
  project.workRequired = 340;
  project.workDone = 340;
  project.progress = 1;
  project.bugs = opts.bugs;
  project.bugsPeak = opts.bugs;
  project.spent = 250_000;
  project.daysInDevelopment = 200;
  for (const dim of QUALITY_DIMENSIONS) {
    project.quality[dim] = 70;
    project.qualityEffort[dim] = 100;
  }
  state.projects[project.id] = project;
  studio.projectIds.push(project.id);
  return project;
}


