/**
 * AI studio system — the living industry.
 *
 * Every AI studio runs the same monthly decision pass: survive payroll, release finished
 * games, staff up or cut, start new projects, spend on marketing, sometimes poach. They
 * consume the same labour pool, the same genre demand and the same install base as the
 * player, through the same systems — nothing about them is faked.
 */

import { yearFraction } from '../core/calendar';
import { BALANCE } from '../data/balance';
import { clamp } from '../core/math';
import type { GenreId, RoleId, ScopeId } from '../core/types';
import { GENRE_ORDER, GENRES } from '../data/genres';
import { availablePlatforms, platformAudience, platformDef } from '../data/platforms';
import { SCOPE_ORDER, scopeDef } from '../data/scopes';
import { ROLES } from '../data/roles';
import { createEmployee, createProject, createStudio } from '../entities/factory';
import type { Employee } from '../entities/employee';
import type { Project } from '../entities/project';
import type { Studio } from '../entities/studio';
import { analyzeTeam, estimateRemainingDays } from '../models/development-model';
import { employeeValue, poachOffer, poachSusceptibility } from '../models/employee-model';
import { recommendedMarketingFor } from '../models/review-model';
import { addProject, assignTeam, attachEmployee, charge, emit, teamOf } from '../operations';
import { activeStudios, candidatesInPool, employeesOfStudio, monthlyBurn, type WorldState } from '../state/world';

import { releaseProject } from './release';
import type { Rng } from '../core/rng';
import type { System, SystemContext } from './types';

/** Score each genre from this studio's point of view: market pull minus crowding, plus house style. */
function scoreGenres(state: WorldState, studio: Studio): { genreId: GenreId; score: number }[] {
  const profile = studio.ai;
  const sticky = profile ? 1 - profile.adaptability : 0;
  return GENRE_ORDER.map((genreId) => {
    const market = state.market.genres[genreId];
    const def = GENRES[genreId];
    const strength = studio.genreStrength[genreId] ?? 0;
    const preferred = profile?.preferredGenres.includes(genreId) ? 1 : 0;
    const pull = (market.popularity / 100) * 44 + (market.demand / 130) * 30;
    const crowd = (market.competition / 100) * 26;
    const competence = strength * 34;
    const loyaltyToForm = preferred * (10 + sticky * 26);
    const riskBonus = (profile?.riskAppetite ?? 0.5) * (def.criticWeights.innovation * 24);
    return { genreId, score: pull - crowd + competence + loyaltyToForm + riskBonus + studioTeamFit(state, studio, genreId) };
  });
}

/** How well the current staff map onto what a genre needs. */
function studioTeamFit(state: WorldState, studio: Studio, genreId: GenreId): number {
  const staff = employeesOfStudio(state, studio.id);
  if (staff.length === 0) return 0;
  const genre = GENRES[genreId];
  let score = 0;
  for (const emp of staff) {
    const roleDef = ROLES[emp.role];
    score += (emp.skills[roleDef.primary] / 100) * (genre.criticWeights[roleDef.primary] ?? 0);
  }
  return clamp(score, 0, 26);
}

/**
 * Which scope an AI studio should attempt: what it can fund, and what its headcount
 * actually fits. A 20-person studio does not make prototypes, and a 4-person studio
 * that tries an 'ambitious' project fails — both cases are penalised here.
 */
function chooseScope(studio: Studio, spendable: number, headcount: number, rng: Rng): ScopeId {
  const ambition = studio.ai?.ambition ?? 0.5;
  const candidates = SCOPE_ORDER.filter((scopeId) => {
    const def = scopeDef(scopeId);
    return def.recommendedBudget <= Math.max(12000, spendable) && headcount >= Math.ceil(def.minTeam * 0.6);
  });
  if (candidates.length === 0) return 'prototype';
  const scored = candidates.map((scopeId) => {
    const def = scopeDef(scopeId);
    const fit = -Math.abs(Math.log(Math.max(1, headcount) / def.optimalTeam)) * 26;
    const stretch = ambition * (1 + SCOPE_ORDER.indexOf(scopeId) * 0.45) * 16;
    const overReach = Math.max(0, def.recommendedBudget / Math.max(1, spendable) - 0.65) * 60;
    return { scopeId, score: fit + stretch - overReach + rng.range(-4, 4) };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].scopeId;
}

function choosePlatform(state: WorldState, genreId: GenreId, cash: number): string {
  const year = state.calendar.year;
  const live = availablePlatforms(year).filter((p) => p.devkitCost <= cash * 0.35);
  if (live.length === 0) return 'pc';
  const frac = yearFraction(state.calendar);
  const scored = live.map((p) => {
    const audience = platformAudience(p.id, frac);
    const affinity = p.genreAffinity[genreId] ?? 1;
    const costPenalty = (p.devkitCost / 40000) * 6 + p.unitCost * 1.4 + p.licenseCut * 24;
    return { id: p.id, score: audience * affinity - costPenalty + (p.kind === 'computer' ? 4 : 0) };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].id;
}

/** Which role would help this studio's pipeline most right now. */
function neededRole(state: WorldState, studio: Studio, project?: Project | null): RoleId {
  const staff = employeesOfStudio(state, studio.id);
  const counts: Record<string, number> = {};
  for (const emp of staff) counts[emp.role] = (counts[emp.role] ?? 0) + 1;
  const wanted: RoleId[] = project ? [...GENRES[project.genreId].essentialRoles, 'programmer', 'artist'] : ['programmer', 'artist', 'designer'];
  for (const role of wanted) {
    if ((counts[role] ?? 0) === 0) return role;
  }
  // Otherwise backfill the thinnest role.
  const all = Object.keys(ROLES) as RoleId[];
  all.sort((a, b) => (counts[a] ?? 0) - (counts[b] ?? 0));
  return all[0];
}

function assignAvailableStaff(state: WorldState, studio: Studio, project: Project): void {
  const busy = new Set<string>();
  for (const otherId of studio.projectIds) {
    if (otherId === project.id) continue;
    const other = state.projects[otherId];
    if (other && other.status !== 'released' && other.status !== 'cancelled') for (const id of other.teamIds) busy.add(id);
  }
  const staff = employeesOfStudio(state, studio.id)
    .filter((e) => !busy.has(e.id))
    .sort((a, b) => employeeValue(b) - employeeValue(a));
  const genre = GENRES[project.genreId];
  const optimal = scopeDef(project.scope).optimalTeam;
  const priority: string[] = [];
  // Essential roles first so the genre's key dimensions are covered, then the rest.
  for (const emp of staff) {
    if (genre.essentialRoles.includes(emp.role)) priority.push(emp.id);
  }
  for (const emp of staff) if (!priority.includes(emp.id)) priority.push(emp.id);
  assignTeam(state, project, priority.slice(0, Math.max(genre.essentialRoles.length, optimal)));
}

function tryStartProject(state: WorldState, studio: Studio, rng: Rng): boolean {
  const staff = employeesOfStudio(state, studio.id);
  if (staff.length === 0) return false;
  const scored = scoreGenres(state, studio);
  // Personality: mix a little noise into the choice so studios diverge.
  const noise = (rng.next() - 0.5) * (14 + (1 - (studio.ai?.adaptability ?? 0.5)) * 10);
  scored.sort((a, b) => b.score + noise - (a.score - noise));
  const genreId = scored[0].genreId;
  const reserve = monthlyBurn(state, studio.id) * BALANCE.ai.cashReserveMonths;
  const spendable = Math.max(0, studio.cash - reserve);
  const scopeId = chooseScope(studio, spendable + studio.cash * 0.15, staff.length, rng);
  const scope = scopeDef(scopeId);
  const platformId = choosePlatform(state, genreId, studio.cash);
  const platform = platformDef(platformId);
  const licence = platform.devkitCost;

  const plannedDays = Math.max(30, Math.ceil((scope.workUnits * 1.05) / Math.max(1, staff.length * 0.9)));
  const labour = (staff.reduce((acc, e) => acc + e.salary / BALANCE.time.workDaysPerMonth, 0) + staff.length * BALANCE.development.toolingCostPerDev) * plannedDays;
  const budget = Math.round(clamp(Math.max(scope.recommendedBudget * 0.35, labour * 0.55 + licence), scope.recommendedBudget * 0.25, Math.max(20000, spendable * BALANCE.ai.projectCashShare)));

  if (budget < scope.recommendedBudget * 0.25 || studio.cash - budget - licence < monthlyBurn(state, studio.id)) return false;

  const project = createProject(state, studio.id, rng, {
    genreId,
    platformId,
    scope: scopeId,
    budget,
    teamIds: [],
    risk: clamp((studio.ai?.riskAppetite ?? 0.5) * 0.9 + rng.range(-0.12, 0.12), 0, 1),
    marketing: 0,
  });
  if (licence > 0) charge(state, studio, 'other', licence);
  addProject(state, studio, project);
  assignAvailableStaff(state, studio, project);
  state.stats.aiActionsTaken += 1;

  emit(state, {
    category: 'project',
    tone: 'neutral',
    studioIds: [studio.id],
    title: `${studio.name} announced "${project.title}"`,
    detail: `${GENRES[genreId].name} on ${platform.name}, ${scope.name} scope, ${scopeId === 'prototype' ? 'no' : 'a'} budget of ${budget.toLocaleString('en-US')}.`,
  });
  return true;
}

function releaseDecision(state: WorldState, studio: Studio, project: Project): boolean {
  const profile = studio.ai;
  const qualityFocus = profile?.qualityFocus ?? 0.5;
  const burn = monthlyBurn(state, studio.id);
  const runway = burn > 0 ? studio.cash / burn : Infinity;
  const bugTolerance = scopeDef(project.scope).workUnits * BALANCE.ai.releaseBugTolerance * (0.12 + (1 - qualityFocus) * 0.5);
  const polished = project.bugs <= bugTolerance;
  const patience = 25 + qualityFocus * 90;

  if (project.progress >= 1 && (polished || project.daysInPolish > patience)) return true;
  if (project.progress >= 0.92 && qualityFocus < 0.35) return true;
  if (project.progress >= 0.75 && runway < BALANCE.ai.runwayPanicMonths) return true;
  return false;
}

function setMarketing(state: WorldState, studio: Studio, project: Project): void {
  const profile = studio.ai;
  const recommended = recommendedMarketingFor(project.scope, project.platformId, studio.reputation);
  const willingness = 0.35 + (profile?.marketingFocus ?? 0.5) * 1.15;
  const reserve = monthlyBurn(state, studio.id) * 2;
  const affordable = Math.max(0, studio.cash - reserve) * BALANCE.ai.marketingCashShare * 3;
  const spend = Math.round(clamp(Math.min(recommended * willingness, affordable), 0, recommended * 1.4));
  project.marketing = spend;
}

function layoffs(state: WorldState, studio: Studio, count: number): void {
  const staff = employeesOfStudio(state, studio.id).sort((a, b) => employeeValue(a) - employeeValue(b));
  const firing = staff.slice(0, count);
  for (const emp of firing) {
    emp.studioId = null;
    emp.status = 'candidate';
    emp.morale = clamp(emp.morale - BALANCE.employee.moraleLayoffShock * 0.5, 0, 100);
    studio.employeeIds = studio.employeeIds.filter((id) => id !== emp.id);
    for (const projectId of studio.projectIds) {
      const project = state.projects[projectId];
      if (project) project.teamIds = project.teamIds.filter((id) => id !== emp.id);
    }
  }
  if (firing.length > 0) {
    studio.layoffs += firing.length;
    for (const remaining of employeesOfStudio(state, studio.id)) {
      remaining.morale = clamp(remaining.morale - BALANCE.employee.moraleLayoffShock * 0.4, 0, 100);
    }
    emit(state, {
      category: 'industry',
      tone: 'negative',
      studioIds: [studio.id],
      title: `${studio.name} laid off ${firing.length} ${firing.length === 1 ? 'person' : 'people'}`,
      detail: `Those staff are back on the open market.`,
    });
    state.stats.aiActionsTaken += 1;
  }
}

function tryHire(state: WorldState, studio: Studio, rng: Rng): boolean {
  const profile = studio.ai;
  const burn = monthlyBurn(state, studio.id);
  const reserve = burn * BALANCE.ai.cashReserveMonths;
  if (studio.cash <= reserve) return false;
  const appetite = profile?.hiringAppetite ?? 0.5;
  if (!rng.chance(BALANCE.ai.hireChance * (0.4 + appetite))) return false;

  const staff = employeesOfStudio(state, studio.id);
  const activeProjects = studio.projectIds
    .map((id) => state.projects[id])
    .filter((p): p is Project => Boolean(p) && p.status !== 'released' && p.status !== 'cancelled');
  const targetHeadcount = clamp(Math.round(2 + appetite * 22 + activeProjects.length * 3), 2, 40);
  if (staff.length >= targetHeadcount) return false;

  const role = neededRole(state, studio, activeProjects[0] ?? null);
  const salaryBudget = Math.max(1200, (studio.cash - reserve) / Math.max(1, targetHeadcount - staff.length + 1) / 1.8);
  const pool = candidatesInPool(state)
    .filter((c) => c.role === role && c.salary <= salaryBudget)
    .sort((a, b) => employeeValue(b) - employeeValue(a));
  if (pool.length === 0) return false;

  const rankBias = clamp(1 - studio.reputation / 140, 0, 1);
  const chosen = pool[Math.min(pool.length - 1, Math.floor(rng.next() * rankBias * 3))];
  attachEmployee(state, studio, chosen);
  studio.hires += 1;
  state.stats.aiActionsTaken += 1;
  return true;
}

/**
 * A rich, prestigious rival will pry *unhappy* player staff loose with an above-market
 * offer. Deliberately rare and conditional: losing the whole team to random AI headhunters
 * would read as unfair rather than as a living industry.
 */
function tryPoach(state: WorldState, studio: Studio, rng: Rng): void {
  const profile = studio.ai;
  if (!profile || profile.ambition < 0.55) return;
  const player = state.studios[state.playerStudioId];
  if (!player || player.status !== 'active') return;
  const burn = monthlyBurn(state, studio.id);
  if (studio.cash < burn * 14) return;
  if (studio.reputation < player.reputation + 12) return;
  if (!rng.chance(BALANCE.ai.poachChance * (0.4 + profile.ambition * 0.8))) return;

  const staff = employeesOfStudio(state, player.id);
  if (staff.length <= 1) return;
  let best: { emp: Employee; offer: number; chance: number } | null = null;
  for (const emp of staff) {
    if (emp.morale >= 48) continue;
    const offer = poachOffer(emp);
    if (offer > studio.cash * 0.2) continue;
    const chance = poachSusceptibility(emp, offer);
    if (!best || chance > best.chance) best = { emp, offer, chance };
  }
  if (!best || best.chance < 0.4) return;
  if (!rng.chance(best.chance)) return;

  const target = best.emp;
  detachFromPlayer(state, player, target);
  attachEmployee(state, studio, target);
  target.morale = clamp(target.morale + 12, 0, 100);
  charge(state, studio, 'other', Math.round(best.offer * 0.25));
  state.stats.aiActionsTaken += 1;

  emit(state, {
    category: 'employee',
    tone: 'negative',
    studioIds: [studio.id, player.id],
    title: `${studio.name} poached ${target.name}`,
    detail: `${ROLES[target.role].name}, ${Math.round(target.experience)} years experience. Your staff saw it happen.`,
  });
  for (const remaining of employeesOfStudio(state, player.id)) {
    remaining.morale = clamp(remaining.morale - 3.5, 0, 100);
  }
}

function detachFromPlayer(state: WorldState, player: Studio, emp: Employee): void {
  emp.studioId = null;
  player.employeeIds = player.employeeIds.filter((id) => id !== emp.id);
  for (const projectId of player.projectIds) {
    const project = state.projects[projectId];
    if (project) project.teamIds = project.teamIds.filter((id) => id !== emp.id);
  }
}

/** Occasionally a new studio is founded, keeping the industry alive as others die. */
function industryBirth(state: WorldState, rng: Rng): void {
  const liveAi = activeStudios(state).filter((s) => !s.isPlayer).length;
  if (liveAi >= BALANCE.studio.aiCountMax) return;
  const need = state.config.aiStudioTarget - liveAi;
  if (need <= 0) return;
  if (!rng.chance(BALANCE.studio.foundingChance + need * 0.03)) return;

  const studio = createStudio(state, rng, {
    isPlayer: false,
    foundedYear: state.calendar.year,
    cash: Math.round(rng.range(BALANCE.studio.aiStartingCash[0], BALANCE.studio.aiStartingCash[0] * 2.4)),
    reputation: Math.round(rng.range(2, 18)),
  });
  const founders = Math.max(2, rng.int(2, 5));
  for (let i = 0; i < founders; i++) {
    const emp = createEmployee(state, rng, { tier: rng.range(0.3, 0.72), year: state.calendar.year, seniority: rng.range(0.15, 0.7) });
    state.employees[emp.id] = emp;
    attachEmployee(state, studio, emp);
  }
  state.stats.studiosFounded += 1;
  emit(state, {
    category: 'industry',
    tone: 'neutral',
    studioIds: [studio.id],
    title: `${studio.name} was founded`,
    detail: `${studioTaglineFor(studio)} · ${founders} staff, ${Math.round(studio.cash / 1000)}k in the bank.`,
  });
  if (tryStartProject(state, studio, rng)) {
    // The new studio's first project is already announced by tryStartProject.
  }
}

function studioTaglineFor(studio: Studio): string {
  return studio.ai?.tagline ?? 'A new studio with something to prove.';
}

/** Give stalled, starving AI studios a nudge so they behave like real desperate companies. */
function emergencyActions(state: WorldState, studio: Studio, rng: Rng): boolean {
  const burn = monthlyBurn(state, studio.id);
  const runway = burn > 0 ? studio.cash / burn : Infinity;
  if (runway > 1.4) return false;

  const projects = studio.projectIds
    .map((id) => state.projects[id])
    .filter((p): p is Project => Boolean(p) && p.status !== 'released' && p.status !== 'cancelled');

  // Ship anything remotely finished rather than starve.
  for (const project of projects) {
    if (project.progress >= 0.6) {
      setMarketing(state, studio, project);
      releaseProject(state, rng, project, { marketingTopUp: 0 });
      state.stats.aiActionsTaken += 1;
      return true;
    }
  }
  // Cut staff down to what a lean studio needs.
  const staff = employeesOfStudio(state, studio.id);
  if (staff.length > 2 && runway < 0.6) {
    layoffs(state, studio, Math.max(1, Math.floor(staff.length * 0.25)));
    return true;
  }
  return false;
}

export function aiStudioMonth(state: WorldState, studio: Studio, rng: Rng): void {
  const profile = studio.ai;
  if (!profile) return;

  emergencyActions(state, studio, rng);
  if (studio.status !== 'active') return;

  const projects = studio.projectIds
    .map((id) => state.projects[id])
    .filter((p): p is Project => Boolean(p) && p.status !== 'released' && p.status !== 'cancelled');

  // 1. Release whatever is done.
  for (const project of projects) {
    if (project.progress >= 1 && project.marketing <= 0) setMarketing(state, studio, project);
    if (releaseDecision(state, studio, project)) {
      const burn = monthlyBurn(state, studio.id);
      releaseProject(state, rng, project, { marketingTopUp: 0 });
      // Post-release reputation is applied by the release pipeline; record commercial fallout.
      const last = state.releases[project.releasedReleaseId ?? ''];
      if (last) {
        const profit = last.revenue - last.developmentCost - last.marketingSpend;
        if (profit < -burn * 2) studio.consecutiveLosses += 1;
      }
      state.stats.aiActionsTaken += 1;
    } else if (project.progress > 0.4 && project.crunch === false) {
      // Crunch when behind schedule and reasonably close to the finish line.
      const team = teamOf(state, project);
      const eta = estimateRemainingDays(project, analyzeTeam(team, { crunch: true, scope: project.scope }));
      if (eta > 240 && studio.cash > monthlyBurn(state, studio.id)) project.crunch = true;
    }
  }

  const liveProjects = studio.projectIds
    .map((id) => state.projects[id])
    .filter((p): p is Project => Boolean(p) && p.status !== 'released' && p.status !== 'cancelled');

  // 2. Keep projects funded: real studios top up rather than rot forever.
  for (const project of liveProjects) {
    const shortfall = project.budget - project.spent;
    if (project.status === 'stalled' && shortfall <= project.budget * 0.4) {
      const reserve = monthlyBurn(state, studio.id) * 2;
      const topUp = Math.min(Math.max(0, studio.cash - reserve), Math.max(project.budget * 0.25, 12000));
      if (topUp > 1000) {
        project.budget += Math.round(topUp);
        project.status = project.progress >= 1 ? 'polish' : 'development';
        state.stats.aiActionsTaken += 1;
      }
    }
  }

  // 3. Start something if the pipeline is empty.
  const staff = employeesOfStudio(state, studio.id);
  const capacity = clamp(Math.floor(staff.length / 7), 1, 3);
  const cooledDown = studio.lastReleaseTick < 0 || state.calendar.tick - studio.lastReleaseTick > 25;
  if (liveProjects.length < capacity && cooledDown) {
    tryStartProject(state, studio, rng);
  } else if (liveProjects.length > 0) {
    // Make sure every project has hands on it.
    for (const project of liveProjects) {
      if (project.teamIds.length === 0 && staff.length > project.teamIds.length) assignAvailableStaff(state, studio, project);
    }
  }

  // 4. Staff up or down.
  tryHire(state, studio, rng);
  const burn = monthlyBurn(state, studio.id);
  const runway = burn > 0 ? studio.cash / burn : Infinity;
  if (runway < 1.1 && staff.length > 3 && profile.loyalty < 0.6) {
    layoffs(state, studio, Math.max(1, Math.floor(staff.length * 0.2)));
  }

  // 5. Talent raiding.
  tryPoach(state, studio, rng);
}

export const aiSystem: System = {
  id: 'ai',
  order: 60,
  tick(ctx: SystemContext) {
    if (!ctx.cadence.monthStart) return;
    const state = ctx.state;
    for (const studio of activeStudios(state)) {
      if (studio.isPlayer) continue;
      aiStudioMonth(state, studio, ctx.rng);
    }
    industryBirth(state, ctx.rng);
  },
};
