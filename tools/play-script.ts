/**
 * A "competent player" policy, driven month by month. Used by the scripted gameplay test and by
 * `tools/sim-cli.ts --play`, so balance and tests measure the same thing.
 */

import { GENRE_ORDER } from '../src/sim/data/genres';
import { availablePlatforms, platformAudience } from '../src/sim/data/platforms';
import { scopeDef } from '../src/sim/data/scopes';
import { employeeValue, marketValue } from '../src/sim';
import { candidatesInPool, employeesOfStudio, monthlyBurn } from '../src/sim/state/world';
import type { Simulation } from '../src/sim/simulation';
import type { RoleId, ScopeId } from '../src/sim/core/types';
import type { Project } from '../src/sim/entities/project';

export interface PlayOutcome {
  months: number;
  alive: boolean;
  cash: number;
  reputation: number;
  headcount: number;
  games: number;
  avgScore: number;
  bestScore: number;
  units: number;
  profit: number;
  hires: number;
}

function liveProjects(sim: Simulation): Project[] {
  const studio = sim.studio;
  return studio.projectIds
    .map((id) => sim.state.projects[id])
    .filter((p): p is Project => Boolean(p) && p.status !== 'released' && p.status !== 'cancelled');
}

function netAudience(id: string, licenseCut: number, unitCost: number, year: number): number {
  return platformAudience(id, year) * (1 - licenseCut) - unitCost;
}

/** Play `months` months of a competent studio strategy and report what happened. */
export function playMonths(sim: Simulation, months: number): PlayOutcome {
  const state = sim.state;
  let projectNo = 1;

  for (let m = 0; m < months; m += 1) {
    const studio = sim.studio;
    const burn = monthlyBurn(state, studio.id);

    // Ship finished work; ship early only when genuinely starving.
    for (const project of liveProjects(sim)) {
      const bugTarget = Math.max(3, project.workRequired * 0.012);
      const ready = project.progress >= 1 && (project.bugs <= bugTarget || project.daysInPolish > 120);
      const starving = studio.cash < burn * 0.6 && project.progress > 0.55;
      if (ready || starving) sim.runCommand({ type: 'releaseGame', projectId: project.id });
    }

    if (liveProjects(sim).length === 0) {
      const staff = employeesOfStudio(state, studio.id);
      const scope: ScopeId = staff.length >= 11 ? 'large' : staff.length >= 6 ? 'medium' : 'small';
      const def = scopeDef(scope);
      const ranked = GENRE_ORDER.map((g) => {
        const market = state.market.genres[g];
        return { g, score: market.popularity * 0.55 + market.demand * 0.8 - market.competition * 0.5 + studio.genreStrength[g] * 40 };
      }).sort((a, b) => b.score - a.score);
      const year = state.calendar.year + state.calendar.month / 12;
      const platform = availablePlatforms(state.calendar.year)
        .filter((p) => p.devkitCost + def.recommendedBudget < studio.cash * 0.55)
        .sort((a, b) => netAudience(b.id, b.licenseCut, b.unitCost, year) - netAudience(a.id, a.licenseCut, a.unitCost, year))[0];
      if (platform && studio.cash > def.recommendedBudget * 1.5) {
        const marketing = Math.round(Math.min(def.marketingBase * 0.8, studio.cash * 0.12));
        sim.runCommand({
          type: 'startProject',
          payload: {
            title: `Game ${projectNo++}`,
            genreId: ranked[0].g,
            platformId: platform.id,
            scope,
            budget: def.recommendedBudget,
            teamIds: staff.map((s) => s.id),
            risk: staff.length >= 10 ? 0.35 : 0.2,
            marketing,
          },
        });
      }
    }

    // Keep pay at market level so people do not walk, grow when the pipeline can use the hands.
    const staff = employeesOfStudio(state, studio.id);
    for (const emp of staff) {
      const value = marketValue(emp);
      if (emp.salary < value && studio.cash > burn * 4) sim.runCommand({ type: 'setSalary', employeeId: emp.id, salary: value });
    }
    const wanted = 4 + Math.floor(studio.cash / 250_000);
    if (staff.length < Math.min(wanted, 12) && studio.cash > burn * 14) {
      const best = candidatesInPool(state)
        .slice()
        .sort((a, b) => employeeValue(b) - employeeValue(a))
        .find((c) => c.salary < burn * 0.13 && wantsThisRole(c.role, staff.map((emp) => emp.role)));
      if (best) sim.runCommand({ type: 'hire', candidateId: best.id });
    }
    if (studio.monthsBroke > 3 && staff.length > 2) {
      const weakest = staff.slice().sort((a, b) => employeeValue(a) - employeeValue(b))[0];
      sim.runCommand({ type: 'fire', employeeId: weakest.id });
    }

    sim.advanceMonths(1);
  }

  const studio = sim.studio;
  const games = studio.releaseIds.map((id) => state.releases[id]).filter(Boolean);
  const scores = games.map((g) => g.reviewScore);
  return {
    months,
    alive: studio.status === 'active',
    cash: Math.round(studio.cash),
    reputation: studio.reputation,
    headcount: studio.employeeIds.length,
    games: games.length,
    avgScore: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0,
    bestScore: scores.length ? Math.max(...scores) : 0,
    units: games.reduce((a, g) => a + g.unitsSold, 0),
    profit: games.reduce((a, g) => a + g.revenue - g.developmentCost - g.marketingSpend, 0),
    hires: studio.hires,
  };
}

/**
 * Prefer the disciplines the team is thinnest on, but never refuse a good person outright:
 * a four-person studio needs every pair of hands it can get, and role coverage is what lifts
 * the quality ceilings.
 */
function wantsThisRole(role: RoleId, have: RoleId[]): boolean {
  const counts = new Map<RoleId, number>();
  for (const r of have) counts.set(r, (counts.get(r) ?? 0) + 1);
  const mine = counts.get(role) ?? 0;
  if (have.length < 6) return true;
  const avg = have.length / Math.max(1, counts.size);
  return mine <= Math.max(1, Math.floor(avg));
}
