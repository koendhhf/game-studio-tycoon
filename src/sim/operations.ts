/**
 * State operations shared by systems, the player command layer and the AI.
 *
 * Anything that mutates the world state goes through these functions so that
 * referential integrity (studio ⇄ employee ⇄ project links) holds no matter who
 * is playing — the player and the AI cannot drift apart in behaviour.
 */

import { BALANCE } from './data/balance';
import { GENRES } from './data/genres';
import type { CalendarState } from './core/calendar';
import { pushEvent, type EventDraft } from './core/events';
import { compareIds } from './core/ids';
import { clamp } from './core/math';
import type { Employee } from './entities/employee';
import { clampEmployee } from './entities/employee';
import type { Project } from './entities/project';
import type { RoleId } from './core/types';
import type { Studio } from './entities/studio';
import { allocateId, monthlyOverhead, monthlySalaryBill, type WorldState } from './state/world';

export function emit(state: WorldState, draft: EventDraft): void {
  pushEvent(state.events, () => allocateId(state, 'event'), state.calendar, {
    ...draft,
    aboutPlayer: draft.aboutPlayer ?? isPlayerRelated(state, draft),
  });
}

function isPlayerRelated(state: WorldState, draft: EventDraft): boolean {
  if (draft.studioIds && draft.studioIds.includes(state.playerStudioId)) return true;
  return false;
}

export function studio(state: WorldState, id: string): Studio | undefined {
  return state.studios[id];
}

export function requireStudio(state: WorldState, id: string): Studio {
  const s = state.studios[id];
  if (!s) throw new Error(`Missing studio ${id}`);
  return s;
}

/** Charge an expense against a studio. Cash may go negative; solvency is a monthly judgement. */
export function charge(state: WorldState, s: Studio, category: ExpenseCategory, amount: number): number {
  const value = Math.max(0, Math.round(amount));
  s.cash -= value;
  const ledger = s.finances.current;
  ledger[category] += value;
  s.finances.lifetime[category] += value;
  return value;
}

export function credit(state: WorldState, s: Studio, category: ExpenseCategory, amount: number): number {
  const value = Math.max(0, Math.round(amount));
  s.cash += value;
  s.finances.current.revenue += value;
  s.finances.lifetime.revenue += value;
  return value;
}

export type ExpenseCategory = 'revenue' | 'salaries' | 'overhead' | 'development' | 'marketing' | 'other';

export function attachEmployee(state: WorldState, s: Studio, emp: Employee): void {
  emp.studioId = s.id;
  emp.status = 'employed';
  emp.hiredTick = state.calendar.tick;
  if (!s.employeeIds.includes(emp.id)) {
    s.employeeIds.push(emp.id);
    s.employeeIds.sort(compareIds);
  }
  clampEmployee(emp);
}

export function detachEmployee(state: WorldState, s: Studio | undefined, emp: Employee, toPool: boolean): void {
  emp.studioId = null;
  emp.status = toPool ? 'candidate' : 'unhirable';
  if (s) {
    s.employeeIds = s.employeeIds.filter((id) => id !== emp.id);
    for (const projectId of s.projectIds) {
      const project = state.projects[projectId];
      if (project && project.teamIds.includes(emp.id)) {
        project.teamIds = project.teamIds.filter((id) => id !== emp.id);
      }
    }
  }
}

/** Release an employee into the open labour pool (layoffs, studio closures). */
export function releaseEmployeeToPool(state: WorldState, s: Studio | undefined, emp: Employee): void {
  detachEmployee(state, s, emp, true);
}

export function addProject(state: WorldState, s: Studio, project: Project): void {
  s.projectIds.push(project.id);
  s.projectIds.sort(compareIds);
  state.projects[project.id] = project;
}

export function removeProject(state: WorldState, s: Studio, projectId: string): void {
  s.projectIds = s.projectIds.filter((id) => id !== projectId);
  const project = state.projects[projectId];
  if (project) {
    project.status = 'cancelled';
    project.teamIds = [];
  }
}

export function assignTeam(state: WorldState, project: Project, employeeIds: readonly string[]): void {
  const owner = state.studios[project.studioId];
  const allowed = new Set(owner ? owner.employeeIds : []);
  const unique: string[] = [];
  for (const id of employeeIds) {
    if (!allowed.has(id) || unique.includes(id)) continue;
    unique.push(id);
  }
  // An employee can only be on one project at a time; unassign them from others.
  if (owner) {
    for (const otherId of owner.projectIds) {
      if (otherId === project.id) continue;
      const other = state.projects[otherId];
      if (!other) continue;
      other.teamIds = other.teamIds.filter((id) => !unique.includes(id));
    }
  }
  project.teamIds = unique.sort(compareIds);
}

export function teamOf(state: WorldState, project: Project): Employee[] {
  return project.teamIds
    .slice()
    .sort(compareIds)
    .map((id) => state.employees[id])
    .filter((e): e is Employee => Boolean(e) && e.studioId === project.studioId);
}

/** Roles a project's team is missing, given what the genre requires. */
export function missingRolesFor(state: WorldState, project: Project): RoleId[] {
  const genre = GENRES[project.genreId];
  if (!genre) return [];
  const present = new Set(teamOf(state, project).map((e) => e.role));
  return genre.essentialRoles.filter((r) => !present.has(r));
}

export function adjustReputation(s: Studio, delta: number): number {
  const applied = clamp(delta, -40, 40);
  const before = s.reputation;
  s.reputation = clamp(s.reputation + applied, BALANCE.studio.repMin, BALANCE.studio.repMax);
  return Math.round((s.reputation - before) * 10) / 10;
}

/** Close the current month's ledger and start a new one. */
export function closeMonth(state: WorldState, s: Studio, cal: CalendarState): void {
  const cur = s.finances.current;
  const net = cur.revenue - cur.salaries - cur.overhead - cur.development - cur.marketing - cur.other;
  const opening = s.cash - net;
  // Called on the first day of a month, so the row describes the month that just ended.
  const endedMonthIndex = cal.monthIndex - 1;
  const emptyMonth = cur.revenue === 0 && cur.salaries === 0 && cur.overhead === 0 && cur.development === 0 && cur.marketing === 0 && cur.other === 0;
  if (endedMonthIndex >= 0 && (!emptyMonth || s.finances.months.length > 0)) {
  s.finances.months.push({
    year: Math.floor(endedMonthIndex / 12),
    month: endedMonthIndex % 12,
    openingCash: Math.round(opening),
    revenue: Math.round(cur.revenue),
    salaries: Math.round(cur.salaries),
    overhead: Math.round(cur.overhead),
    development: Math.round(cur.development),
    marketing: Math.round(cur.marketing),
    other: Math.round(cur.other),
    net: Math.round(net),
    closingCash: Math.round(s.cash),
  });
  }
  const maxMonths = 12 * 30;
  if (s.finances.months.length > maxMonths) s.finances.months.splice(0, s.finances.months.length - maxMonths);

  s.finances.current = { revenue: 0, salaries: 0, overhead: 0, development: 0, marketing: 0, other: 0 };
  s.finances.lifetime.peakCash = Math.max(s.finances.lifetime.peakCash, s.cash);
  s.finances.lifetime.lowestCash = Math.min(s.finances.lifetime.lowestCash, s.cash);
  void state;
}

export function payMonthlyCosts(state: WorldState, s: Studio): { salaries: number; overhead: number } {
  const salaries = monthlySalaryBill(state, s.id);
  const overhead = monthlyOverhead(state, s.id);
  charge(state, s, 'salaries', salaries);
  charge(state, s, 'overhead', overhead);
  return { salaries, overhead };
}

export function cashPerEmployee(state: WorldState, s: Studio): number {
  const n = Math.max(1, s.employeeIds.length);
  return s.cash / n;
}
