/**
 * Development system: advances every active project by one day, charges the burn to
 * the owning studio, and grows the people doing the work.
 *
 * Player and AI studios run through this exact same code — the AI gets no shortcuts.
 */

import { BALANCE } from '../data/balance';
import { QUALITY_DIMENSIONS, type RoleId } from '../core/types';
import { clamp } from '../core/math';
import { emptySkills, type Employee } from '../entities/employee';
import type { Project } from '../entities/project';
import { scopeDef } from '../data/scopes';
import { analyzeTeam, developProject, employeeWorkRate, type QualityVector, type TeamAnalysis } from '../models/development-model';
import { experienceDelta, growthDelta, moraleDrift } from '../models/employee-model';
import { charge, emit, missingRolesFor, teamOf } from '../operations';
import type { WorldState } from '../state/world';
import type { System, SystemContext } from './types';

/** Bug count below which a feature-complete project is considered shippable. */
export function bugTarget(project: Project): number {
  return Math.max(2, project.workRequired * 0.012);
}

/** Team size the scope considers healthy — reused by the UI and the AI. */
export function optimalTeamFor(scopeId: string): number {
  return scopeDef(scopeId as never).optimalTeam;
}

/** Share of effort per dimension — also what drives skill growth. */
function effortShare(dimInput: QualityVector): QualityVector {
  const out = emptySkills();
  let total = 0;
  for (const dim of QUALITY_DIMENSIONS) total += dimInput[dim];
  if (total <= 0) return out;
  for (const dim of QUALITY_DIMENSIONS) out[dim] = dimInput[dim] / total;
  return out;
}

export function advanceProject(state: WorldState, project: Project): void {
  const owner = state.studios[project.studioId];
  if (!owner || owner.status !== 'active') return;

  const team = teamOf(state, project);
  const budgetLeft = project.budget - project.spent;

  if (team.length === 0 || budgetLeft <= 0 || owner.cash <= 0) {
    if (project.status !== 'stalled') {
      project.status = 'stalled';
      emit(state, {
        category: 'project',
        tone: 'negative',
        studioIds: [owner.id],
        title: `"${project.title}" has stalled`,
        detail:
          team.length === 0
            ? 'Nobody is assigned to the project.'
            : budgetLeft <= 0
              ? `${owner.name} has spent the project budget and must top it up or ship what exists.`
              : `${owner.name} cannot cover the burn rate with its current cash position.`,
      });
    }
    project.stalledDays += 1;
    // Idle people drift toward quitting; tracked by the employee system via `working: false`.
    for (const emp of team) {
      emp.morale = clamp(emp.morale - 0.18, 0, 100);
    }
    return;
  }

  const wasStalled = project.status === 'stalled';
  project.stalledDays = 0;
  if (wasStalled) project.status = project.progress >= 1 ? 'polish' : 'development';

  const cal = state.calendar;
  const isWeekend = cal.weekday >= 5;
  const dayFactor = isWeekend ? BALANCE.time.weekendFactor : 1;
  const analysis = analyzeTeam(team, { crunch: project.crunch, scope: project.scope });

  const delta = developProject({
    project,
    team: analysis,
    isWeekend,
    missingRoles: missingRolesFor(state, project) as RoleId[],
  });

  project.workDone = delta.workDone;
  project.progress = delta.progress;
  project.quality = delta.quality;
  project.qualityEffort = delta.qualityEffort;
  project.bugs = delta.bugs;
  project.bugsPeak = Math.max(project.bugsPeak, delta.bugs);
  project.bugsFixed = delta.bugsFixed;
  project.daysInDevelopment = delta.daysInDevelopment;
  project.daysInPolish = delta.daysInPolish;

  // Cost accounting. Payroll itself is charged once, by the economy system, on the
  // first of the month; here we attribute the labour to the project (for budget and
  // ROI) and charge only the *direct* costs (tooling, consumables) to the studio.
  let salaries = 0;
  for (const emp of team) salaries += emp.salary / BALANCE.time.workDaysPerMonth;
  const attributed = (salaries + team.length * BALANCE.development.toolingCostPerDev) * (isWeekend ? 0.4 : 1);
  const direct = team.length * BALANCE.development.toolingCostPerDev * (isWeekend ? 0.4 : 1);
  project.spent += attributed;
  charge(state, owner, 'development', direct);

  // People learn on the job.
  const dimShare = effortShare(analysis.dimInput);
  for (const emp of team) {
    applyDailyGrowth(emp, dimShare, dayFactor, project, owner, analysis);
  }

  if (delta.progress >= 1 && project.status !== 'polish' && project.status !== 'ready') {
    project.status = 'polish';
    emit(state, {
      category: 'project',
      tone: 'positive',
      studioIds: [owner.id],
      title: `"${project.title}" is feature complete`,
      detail: `${Math.round(project.bugs)} known issues remain before ${owner.name} can ship.`,
    });
  } else if (project.status === 'polish' && project.bugs <= bugTarget(project)) {
    project.status = 'ready';
    emit(state, {
      category: 'project',
      tone: 'positive',
      studioIds: [owner.id],
      title: `"${project.title}" is ready to ship`,
      detail: `${owner.name} can release whenever it chooses.`,
    });
  }
}

function applyDailyGrowth(
  emp: Employee,
  dimShare: QualityVector,
  dayFactor: number,
  project: Project,
  owner: { cash: number },
  analysis: TeamAnalysis,
): void {
  const workDone = employeeWorkRate(emp, project.crunch) * dayFactor;
  const growth = growthDelta(emp, dimShare, workDone);
  for (const dim of QUALITY_DIMENSIONS) {
    const gain = growth[dim];
    if (gain) emp.skills[dim] = clamp(emp.skills[dim] + gain, 0, 100);
  }
  emp.experience += experienceDelta(emp, true);
  emp.workUnitsShipped += workDone;

  const overwork = project.teamIds.length / Math.max(1, analysis.headcount ? scopeDef(project.scope).optimalTeam : 1);
  emp.morale = clamp(
    emp.morale +
      moraleDrift(emp, {
        working: true,
        overwork,
        crunch: project.crunch,
        cashCrisis: owner.cash < 0,
        moraleShield: analysis.moraleShield,
        teamMorale: analysis.avgMorale,
      }),
    0,
    100,
  );
}

export const developmentSystem: System = {
  id: 'development',
  order: 10,
  tick(_ctx: SystemContext) {
    const state: WorldState = _ctx.state;
    for (const id of _ctx.sortedIds(state.projects)) {
      const project = state.projects[id];
      if (!project) continue;
      if (project.status === 'released' || project.status === 'cancelled') continue;
      advanceProject(state, project);
    }
  },
};
