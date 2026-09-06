/**
 * Player commands.
 *
 * The UI never touches simulation internals: it queues a command, and the engine
 * applies it at the start of the next tick. Because commands are recorded in order,
 * a save + command log fully determines a run, which is what makes the sim testable
 * (and later: replays, and multiplayer-style deterministic sync).
 */

import type { GenreId, PlatformId, RoleId, ScopeId } from './core/types';
import { SCOPES } from './data/scopes';
import { GENRES } from './data/genres';
import { platformDef, isPlatformAvailable } from './data/platforms';
import { ROLES } from './data/roles';
import { BALANCE } from './data/balance';
import { clamp } from './core/math';
import { createProject } from './entities/factory';
import { addProject, adjustReputation, assignTeam, attachEmployee, charge, emit, releaseEmployeeToPool } from './operations';
import { allocateId, employeesOfStudio, type WorldState } from './state/world';
import { releaseProject } from './systems/release';
import { hireUpfrontCost, poachOffer } from './models/employee-model';
import type { Rng } from './core/rng';

export interface StartProjectPayload {
  title: string;
  genreId: GenreId;
  platformId: PlatformId;
  scope: ScopeId;
  budget: number;
  teamIds: string[];
  /** 0..1 — how much new ground the project attempts. */
  risk: number;
  marketing: number;
}

export type Command =
  | { type: 'startProject'; payload: StartProjectPayload }
  | { type: 'releaseGame'; projectId: string }
  | { type: 'cancelProject'; projectId: string }
  | { type: 'topUpBudget'; projectId: string; amount: number }
  | { type: 'setTeam'; projectId: string; teamIds: string[] }
  | { type: 'setMarketing'; projectId: string; amount: number }
  | { type: 'setCrunch'; projectId: string; value: boolean }
  | { type: 'hire'; candidateId: string; offerSalary?: number }
  | { type: 'fire'; employeeId: string }
  | { type: 'setSalary'; employeeId: string; salary: number }
  | { type: 'poach'; employeeId: string }
  | { type: 'postJobListing'; roles: RoleId[]; prestige: number; weeks?: number }
  | { type: 'renameStudio'; name: string };

export interface CommandResult {
  ok: boolean;
  error?: string;
  /** Extra information for the UI (e.g. the created project id). */
  detail?: string;
}

export const OK: CommandResult = { ok: true };

export function fail(error: string): CommandResult {
  return { ok: false, error };
}

/** What advertising a job listing costs at a given prestige (0..1). */
export function listingCost(prestige: number): number {
  return Math.round(BALANCE.hiring.listingBase + clamp(prestige, 0, 1) * BALANCE.hiring.listingPrestigePremium);
}

/** Pure validation, used by the UI to disable buttons and show why. */
export function validateStartProject(state: WorldState, payload: StartProjectPayload): CommandResult {
  const studio = state.studios[state.playerStudioId];
  if (!studio) return fail('No studio');
  const scope = SCOPES[payload.scope];
  if (!scope) return fail('Unknown scope');
  if (!GENRES[payload.genreId]) return fail('Unknown genre');
  const platform = platformDef(payload.platformId);
  if (!platform) return fail('Unknown platform');
  if (!isPlatformAvailable(payload.platformId, state.calendar.year)) {
    return fail(`${platform.name} is not on sale in ${state.calendar.year}`);
  }
  const title = payload.title.trim();
  if (title.length < 2) return fail('Title must be at least 2 characters');
  if (payload.teamIds.length === 0) return fail('Assign at least one employee');
  if (payload.budget < 1000) return fail('Budget must be at least $1,000');
  const licence = platform.devkitCost;
  const total = payload.budget + payload.marketing + licence;
  if (total > studio.cash) {
    return fail(`Needs ${total.toLocaleString('en-US')} but the studio has ${Math.round(studio.cash).toLocaleString('en-US')}`);
  }
  const staff = employeesOfStudio(state, studio.id);
  const staffIds = new Set(staff.map((e) => e.id));
  for (const id of payload.teamIds) {
    if (!staffIds.has(id)) return fail('Team contains someone who does not work here');
  }
  if (payload.teamIds.length < scope.minTeam) {
    // Not fatal — but the UI should warn loudly.
    return { ok: true, detail: `Below the recommended team size for a ${scope.name.toLowerCase()} project (${scope.minTeam}).` };
  }
  return OK;
}

export function validateHire(state: WorldState, candidateId: string, offerSalary?: number): CommandResult {
  const candidate = state.employees[candidateId];
  if (!candidate || candidate.studioId !== null) return fail('That applicant is no longer available');
  const studio = state.studios[state.playerStudioId];
  const salary = offerSalary ?? candidate.salary;
  if (salary < candidate.salary * BALANCE.hiring.minOfferRatio) return fail('Offer below their minimum expectation');
  const upfront = hireUpfrontCost(candidate, salary);
  if (studio.cash < upfront) return fail(`Needs ${upfront.toLocaleString('en-US')} up front (signing bonus plus first month)`);
  return OK;
}

export function validateRelease(state: WorldState, projectId: string): CommandResult {
  const project = state.projects[projectId];
  if (!project) return fail('No such project');
  if (project.progress < 0.2) return fail('The game is too incomplete to ship');
  const studio = state.studios[project.studioId];
  if (!studio) return fail('No studio');
  if (studio.status !== 'active') return fail('The studio is closed');
  if (project.marketing > Math.max(0, studio.cash)) {
    return {
      ok: true,
      detail: `Only ${Math.max(0, Math.round(studio.cash)).toLocaleString('en-US')} is available, so the marketing spend will be cut from ${project.marketing.toLocaleString('en-US')}.`,
    };
  }
  return OK;
}

function startProject(state: WorldState, rng: Rng, payload: StartProjectPayload): CommandResult {
  const check = validateStartProject(state, payload);
  if (!check.ok) return check;
  const studio = state.studios[state.playerStudioId];
  const platform = platformDef(payload.platformId);
  const project = createProject(state, studio.id, rng, {
    title: payload.title.trim(),
    genreId: payload.genreId,
    platformId: payload.platformId,
    scope: payload.scope,
    budget: Math.round(payload.budget),
    teamIds: [],
    risk: clamp(payload.risk, 0, 1),
    marketing: Math.round(Math.min(payload.marketing, Math.max(0, studio.cash - payload.budget))),
  });
  if (platform.devkitCost > 0) charge(state, studio, 'other', platform.devkitCost);
  addProject(state, studio, project);
  assignTeam(state, project, payload.teamIds);
  emit(state, {
    category: 'project',
    tone: 'positive',
    studioIds: [studio.id],
    title: `Started development on "${project.title}"`,
    detail: `${GENRES[project.genreId].name} on ${platform.name} · ${SCOPES[project.scope].name} scope · budget ${project.budget.toLocaleString('en-US')}.`,
  });
  return { ok: true, detail: project.id, error: check.detail };
}

function releaseGame(state: WorldState, rng: Rng, projectId: string): CommandResult {
  const check = validateRelease(state, projectId);
  if (!check.ok) return check;
  const project = state.projects[projectId];
  const result = releaseProject(state, rng, project!, {});
  if (!result) return fail('That project cannot be released right now');
  return {
    ok: true,
    detail: `${result.game.title} scored ${result.reviewScore} and is projected to sell ${result.projectedUnits.toLocaleString('en-US')} units`,
  };
}

export function applyCommand(state: WorldState, rng: Rng, command: Command): CommandResult {
  const studio = state.studios[state.playerStudioId];
  // One guard for the whole surface: a closed studio takes no orders, whatever is queued,
  // loaded from a save or typed into the console.
  if (!studio) return fail('No studio');
  if (studio.status !== 'active') return fail('The studio is closed');
  switch (command.type) {
    case 'startProject':
      return startProject(state, rng, command.payload);

    case 'releaseGame':
      return releaseGame(state, rng, command.projectId);

    case 'cancelProject': {
      const project = state.projects[command.projectId];
      if (!project || project.studioId !== studio.id) return fail('No such project');
      if (project.status === 'cancelled' || project.status === 'released') return fail('That project is already closed');
      project.status = 'cancelled';
      studio.projectIds = studio.projectIds.filter((id) => id !== project.id);
      const severance = Math.round(project.spent * 0.1);
      emit(state, {
        category: 'project',
        tone: 'negative',
        studioIds: [studio.id],
        title: `Cancelled "${project.title}"`,
        detail: severance > 0
          ? `${project.spent.toLocaleString('en-US')} of work written off, plus ${severance.toLocaleString('en-US')} in wrap-up costs.`
          : `${project.spent.toLocaleString('en-US')} of work written off.`,
      });
      if (severance > 0) charge(state, studio, 'other', severance);
      for (const emp of employeesOfStudio(state, studio.id)) emp.morale = clamp(emp.morale - 4, 0, 100);
      return OK;
    }

    case 'topUpBudget': {
      const project = state.projects[command.projectId];
      if (!project || project.studioId !== studio.id) return fail('No such project');
      const amount = Math.round(command.amount);
      if (amount <= 0) return fail('Amount must be positive');
      if (amount > studio.cash) return fail(`Only ${Math.floor(studio.cash).toLocaleString('en-US')} in the bank`);
      project.budget += amount;
      if (project.status === 'stalled') project.status = project.progress >= 1 ? 'polish' : 'development';
      emit(state, {
        category: 'project',
        tone: 'positive',
        studioIds: [studio.id],
        title: `Topped up the budget for "${project.title}"`,
        detail: `Budget is now ${project.budget.toLocaleString('en-US')}.`,
      });
      return OK;
    }

    case 'setTeam': {
      const project = state.projects[command.projectId];
      if (!project || project.studioId !== studio.id) return fail('No such project');
      if (project.status === 'released' || project.status === 'cancelled') return fail('That project is already closed');
      const staff = new Set(employeesOfStudio(state, studio.id).map((e) => e.id));
      for (const id of command.teamIds) {
        // Otherwise a project could quietly consume another studio's people.
        if (!staff.has(id)) return fail('Team contains someone who does not work here');
      }
      assignTeam(state, project, command.teamIds);
      return OK;
    }

    case 'setMarketing': {
      const project = state.projects[command.projectId];
      if (!project || project.studioId !== studio.id) return fail('No such project');
      if (!Number.isFinite(command.amount) || command.amount < 0) return fail('Marketing budget must be zero or more');
      const amount = Math.round(command.amount);
      if (amount > studio.cash) return fail('That exceeds available cash');
      project.marketing = amount;
      return OK;
    }

    case 'setCrunch': {
      const project = state.projects[command.projectId];
      if (!project || project.studioId !== studio.id) return fail('No such project');
      project.crunch = command.value;
      emit(state, {
        category: 'project',
        tone: command.value ? 'negative' : 'neutral',
        studioIds: [studio.id],
        title: command.value ? `Crunch mode on "${project.title}"` : `Crunch ended on "${project.title}"`,
        detail: command.value ? 'Faster progress, faster burnout, more bugs.' : 'The team can breathe again.',
      });
      return OK;
    }

    case 'hire': {
      const check = validateHire(state, command.candidateId, command.offerSalary);
      if (!check.ok) return check;
      const candidate = state.employees[command.candidateId];
      if (command.offerSalary) candidate.salary = Math.round(command.offerSalary);
      // The bonus follows the salary actually agreed, not the number they arrived with.
      const signing = Math.round(candidate.salary * BALANCE.hiring.signingBonusMonths);
      attachEmployee(state, studio, candidate);
      charge(state, studio, 'other', signing);
      studio.hires += 1;
      candidate.morale = clamp(candidate.morale + 6, 0, 100);
      emit(state, {
        category: 'employee',
        tone: 'positive',
        studioIds: [studio.id],
        title: `Hired ${candidate.name} (${ROLES[candidate.role].name})`,
        detail: `${Math.round(candidate.salary).toLocaleString('en-US')}/month, ${candidate.experience.toFixed(1)} years experience.`,
      });
      return OK;
    }

    case 'fire': {
      const emp = state.employees[command.employeeId];
      if (!emp || emp.studioId !== studio.id) return fail('Nobody by that name works here');
      const severance = Math.round(emp.salary * BALANCE.hiring.severanceMonths);
      if (severance > studio.cash) return fail(`Severance of ${severance.toLocaleString('en-US')} is not affordable`);
      charge(state, studio, 'other', severance);
      releaseEmployeeToPool(state, studio, emp);
      studio.layoffs += 1;
      for (const other of employeesOfStudio(state, studio.id)) {
        other.morale = clamp(other.morale - BALANCE.employee.moraleLayoffShock * 0.35, 0, 100);
      }
      emit(state, {
        category: 'employee',
        tone: 'negative',
        studioIds: [studio.id],
        title: `Let go ${emp.name}`,
        detail: `${ROLES[emp.role].name}, ${severance.toLocaleString('en-US')} severance paid.`,
      });
      return OK;
    }

    case 'setSalary': {
      const emp = state.employees[command.employeeId];
      if (!emp || emp.studioId !== studio.id) return fail('Nobody by that name works here');
      const salary = Math.max(0, Math.round(command.salary));
      if (salary < BALANCE.employee.salaryBase * BALANCE.employee.salaryFloorRatio) return fail('That salary is below living wage for the role');
      // Compare against what they earned *before* the change, or a pay cut would read as a
      // pay rise to the morale model.
      const previous = emp.salary;
      emp.salary = salary;
      emp.morale = clamp(emp.morale + (salary >= previous ? 4 : -6), 0, 100);
      if (salary > previous) emp.loyalty = clamp(emp.loyalty + 3, 0, 100);
      return OK;
    }

    case 'poach': {
      const target = state.employees[command.employeeId];
      if (!target || target.studioId === null || target.studioId === studio.id) return fail('Not a poachable target');
      const from = state.studios[target.studioId];
      if (!from || from.status !== 'active') return fail('That studio is not hiring-proof right now');
      const offer = poachOffer(target);
      const cost = Math.round(offer * BALANCE.hiring.poachBonusMonths);
      if (cost > studio.cash) return fail(`Offer needs ${cost.toLocaleString('en-US')} in first-year cost`);
      const chance = clamp(0.25 + (studio.reputation - from.reputation) / 140 - target.loyalty / 220 + (100 - target.morale) / 190, 0.02, 0.9);
      charge(state, studio, 'other', Math.round(offer * BALANCE.hiring.signingBonusMonths));
      if (!rng.chance(chance)) {
        target.morale = clamp(target.morale - 3, 0, 100);
        emit(state, {
          category: 'employee',
          tone: 'neutral',
          studioIds: [studio.id, from.id],
          title: `${from.name} refused your approach to ${target.name}`,
          detail: 'Word travels; their morale dipped slightly.',
        });
        return fail('The approach was rejected');
      }
      studio.hires += 1;
      target.studioId = null;
      from.employeeIds = from.employeeIds.filter((id) => id !== target.id);
      for (const projectId of from.projectIds) {
        const project = state.projects[projectId];
        if (project) project.teamIds = project.teamIds.filter((id) => id !== target.id);
      }
      attachEmployee(state, studio, target);
      target.morale = clamp(target.morale + 8, 0, 100);
      emit(state, {
        category: 'employee',
        tone: 'positive',
        studioIds: [studio.id, from.id],
        title: `Poached ${target.name} from ${from.name}`,
        detail: `${ROLES[target.role].name}, ${Math.round(offer).toLocaleString('en-US')}/month.`,
      });
      adjustReputation(from, -0.4);
      return OK;
    }

    case 'postJobListing': {
      // Unknown roles would be sampled later and blow up the candidate generator, so they
      // are refused here rather than silently dropped.
      const requested = [...new Set(command.roles)];
      if (requested.some((role) => !ROLES[role])) return fail('Unknown role in the listing');
      const roles = requested as RoleId[];
      const prestige = clamp(command.prestige, 0, 1);
      const cost = listingCost(prestige);
      if (cost > studio.cash) return fail(`Listing costs ${cost.toLocaleString('en-US')}`);
      charge(state, studio, 'other', cost);
      const weeks = clamp(command.weeks ?? 8, 4, 26);
      state.listings.push({
        id: allocateId(state, 'mod'),
        studioId: studio.id,
        roles,
        prestige,
        postedMonthIndex: state.calendar.monthIndex,
        expiresMonthIndex: state.calendar.monthIndex + Math.ceil(weeks / 4.345),
        cost,
      });
      emit(state, {
        category: 'employee',
        tone: 'neutral',
        studioIds: [studio.id],
        title: `Posted a job listing`,
        detail: `${roles.length > 0 ? roles.map((r) => ROLES[r].name).join(', ') : 'All disciplines'} · ${weeks} weeks for ${cost.toLocaleString('en-US')}.`,
      });
      return OK;
    }

    case 'renameStudio': {
      const name = command.name.trim();
      if (name.length < 2) return fail('Name too short');
      studio.name = name.slice(0, 42);
      emit(state, { category: 'studio', tone: 'neutral', studioIds: [studio.id], title: `Studio renamed to ${studio.name}` });
      return OK;
    }

    default:
      return fail('Unknown command');
  }
}
