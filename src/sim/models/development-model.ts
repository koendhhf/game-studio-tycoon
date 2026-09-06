/**
 * Development model (pure math — no state mutation, no randomness).
 *
 * This is the heart of the game: how a team of people turns into a game with six
 * separately-tracked quality dimensions.
 *
 * Model
 * -----
 *  1. Each employee produces `employeeWorkRate` units of effort per day
 *     (role speed × morale × experience × traits × crunch).
 *  2. That effort is distributed across the quality dimensions by their role's focus
 *     profile, scaled by their skill in each dimension → `dimInput`.
 *  3. Each dimension accumulates *effort*, and its score eases toward a per-dimension
 *     cap:  cap · (1 − e^(−effort / effortScale)).  Quality therefore has diminishing
 *     returns and cannot exceed what the scope, budget, platform and role coverage allow.
 *  4. Bugs accumulate with feature progress (heavier for risky, systems-deep genres) and
 *     are burned down by QA-flavoured staff after feature lock; fixes convert into Polish.
 */

import { BALANCE } from '../data/balance';
import { GENRES, type GenreDef } from '../data/genres';
import { ROLES, producerBonus, type RoleDef } from '../data/roles';
import { platformDef, type PlatformDef } from '../data/platforms';
import { SCOPES, scopeDef, type ScopeDef } from '../data/scopes';
import { QUALITY_DIMENSIONS, type GenreId, type PlatformId, type QualityDimensionId, type RoleId, type ScopeId } from '../core/types';
import { clamp, saturate } from '../core/math';
import type { Employee } from '../entities/employee';
import { emptySkills } from '../entities/employee';
import { traitMult, traitSpeed, traitTeamSpeed } from '../data/traits';

export type QualityVector = Record<QualityDimensionId, number>;

/** Floor effort from tooling/reused tech for a dimension nobody on the team owns. */
export const DIMENSION_BASELINE = 0.085;

export interface TeamAnalysis {
  headcount: number;
  roles: RoleId[];
  avgSkill: number;
  avgMorale: number;
  /** Work units per (weekday) day. */
  workPerDay: number;
  /** Skill-weighted effort directed at each quality dimension. */
  dimInput: QualityVector;
  /** Bug-fix capacity per day during the polish phase. */
  fixPower: number;
  /** Share of the team that is QA (0..0.6). */
  qaShare: number;
  /** Focus-weighted average skill (0..1) per dimension — what limits the quality ceiling. */
  dimSkill: QualityVector;
  bugRateMult: number;
  teamSpeedMult: number;
  /** Multiplier applied to negative morale drift while this team works. */
  moraleShield: number;
}

export function moraleFactor(morale: number): number {
  const { moraleMinMult, moraleMaxMult } = BALANCE.employee;
  return moraleMinMult + (moraleMaxMult - moraleMinMult) * clamp(morale / 100, 0, 1);
}

export function experienceFactor(experience: number): number {
  return 1 + Math.min(0.45, experience * 0.06);
}

/** One employee's output for a single day of project work. */
export function employeeWorkRate(emp: Employee, crunch: boolean): number {
  const roleDef: RoleDef = ROLES[emp.role];
  let rate = BALANCE.development.baseWorkPerDay;
  rate *= roleDef.speed;
  rate *= traitSpeed(emp.traits);
  rate *= moraleFactor(emp.morale);
  rate *= experienceFactor(emp.experience);
  if (crunch) rate *= BALANCE.development.crunchWorkMult;
  return rate;
}

/** Roll a team up into what it can accomplish in a day. */
export function analyzeTeam(
  employees: readonly Employee[],
  opts: { crunch: boolean; scope: ScopeId },
): TeamAnalysis {
  const scope = scopeDef(opts.scope);
  const dimInput = emptySkills();
  const roles: RoleId[] = [];
  let work = 0;
  let morale = 0;
  let skill = 0;
  let fixPower = 0;
  let qaCount = 0;
  const traitPool: string[] = [];

  // dimRaw: skill-weighted effort per dimension. dimSkillNum/Den: the same without
  // throughput, i.e. the team's focus-weighted *average skill* in that dimension.
  const dimSkillNum = emptySkills();
  const dimSkillDen = emptySkills();

  for (const emp of employees) {
    const roleDef = ROLES[emp.role];
    roles.push(emp.role);
    traitPool.push(...emp.traits);
    const rate = employeeWorkRate(emp, opts.crunch);
    work += rate;
    morale += emp.morale;
    const polishTrait = traitMult(emp.traits, 'polish');
    const innovationTrait = traitMult(emp.traits, 'innovation');
    let empSkill = 0;
    for (const dim of QUALITY_DIMENSIONS) {
      const s = emp.skills[dim] / 100;
      const focus = roleDef.focus[dim] ?? 0;
      empSkill += s;
      let weighted = s * focus;
      let contribution = weighted * rate;
      if (dim === 'polish') contribution *= polishTrait;
      if (dim === 'innovation') contribution *= innovationTrait;
      dimInput[dim] += contribution;
      dimSkillNum[dim] += weighted;
      dimSkillDen[dim] += focus;
    }
    skill += empSkill / QUALITY_DIMENSIONS.length;
    fixPower += rate * roleDef.fixRate;
    if (emp.role === 'qa') qaCount += 1;
  }

  // Per-dimension competence: how good, on average, the people who can push this
  // dimension actually are. This — not effort alone — decides the quality ceiling.
  const dimSkill = emptySkills();
  for (const dim of QUALITY_DIMENSIONS) {
    dimSkill[dim] = dimSkillDen[dim] > 0 ? clamp(dimSkillNum[dim] / dimSkillDen[dim], 0, 1) : 0;
  }
  // Everyone stands on shared tooling, reused engines and industry know-how, so an
  // unattended dimension lands weak rather than nonexistent.
  for (const dim of QUALITY_DIMENSIONS) {
    dimInput[dim] += DIMENSION_BASELINE * (dimSkillDen[dim] > 0 ? 1 : 0.4) * Math.max(0.35, Math.min(2.4, work / Math.max(1, employees.length)));
  }

  const coverage = producerBonus(roles);
  const headcount = employees.length;
  // Coordination overhead: past the scope's optimal size, more people means less progress.
  const coordination = headcount > scope.optimalTeam ? 1 / (1 + 0.05 * (headcount - scope.optimalTeam)) : 1;
  const teamSpeedMult = coverage.speed * traitTeamSpeed(traitPool) * coordination;

  return {
    headcount,
    roles,
    avgSkill: headcount ? skill / headcount : 0,
    avgMorale: headcount ? morale / headcount : 0,
    workPerDay: work * teamSpeedMult,
    dimInput: dimInput,
    dimSkill,
    fixPower: fixPower * (opts.crunch ? 0.8 : 1),
    qaShare: headcount ? clamp(qaCount / headcount, 0, 0.6) : 0,
    bugRateMult: coverage.bugs * traitMult(traitPool, 'bugs'),
    teamSpeedMult,
    moraleShield: coverage.morale,
  };
}

export interface CapContext {
  scope: ScopeDef;
  genre: GenreDef;
  platform: PlatformDef;
  /** Dollars spent ÷ dollars budgeted, 0..1. */
  budgetRatio: number;
  risk: number;
  missingRoles: readonly RoleId[];
  /** Focus-weighted team skill for the dimension being capped (0..1). */
  skillLevel?: number;
}

/** Which roles must be present for a dimension to reach its full ceiling. */
export const DIMENSION_OWNERS: Record<QualityDimensionId, readonly RoleId[]> = {
  gameplay: ['designer', 'programmer'],
  graphics: ['artist'],
  story: ['writer'],
  audio: ['audio'],
  innovation: ['designer'],
  polish: ['qa'],
};

export function makeCapContext(params: {
  scopeId: ScopeId;
  genreId: GenreId;
  platformId: PlatformId;
  budgetRatio: number;
  risk: number;
  missingRoles?: readonly RoleId[];
}): CapContext {
  return {
    scope: scopeDef(params.scopeId),
    genre: GENRES[params.genreId],
    platform: platformDef(params.platformId),
    budgetRatio: clamp(params.budgetRatio, 0, 1),
    risk: clamp(params.risk, 0, 1),
    missingRoles: params.missingRoles ?? [],
  };
}

/**
 * The hard ceiling for one quality dimension. Small budget on a big scope, a handheld
 * with no audio team, or a genre-essential role missing from the team all lower it.
 */
export function dimensionCap(dim: QualityDimensionId, ctx: CapContext): number {
  // Money buys production value, but only up to a point: half-funded projects lose a
  // little ceiling, and no amount of budget lifts a studio above what its people can do.
  const budgetMult = 0.74 + 0.26 * ctx.budgetRatio;
  let cap = ctx.scope.qualityCap * budgetMult + BALANCE.development.budgetCapBonus * ctx.budgetRatio * 0.35;

  // A machine's production value caps how good graphics/audio can be.
  if (dim === 'graphics' || dim === 'audio') {
    cap *= clamp(0.62 + 0.3 * ctx.platform.graphicsPressure, 0.6, 1.06);
  }

  // Role coverage.
  const owners = DIMENSION_OWNERS[dim];
  const ownerMissing = owners.some((role) => ctx.missingRoles.includes(role));
  if (ownerMissing) cap *= 0.72;
  if (ctx.genre.essentialRoles.some((role) => ctx.missingRoles.includes(role))) cap *= 0.94;

  // Ambition buys innovation and costs polish.
  if (dim === 'innovation') cap *= 0.85 + ctx.risk * 0.3;
  if (dim === 'polish') cap *= 1.02 - ctx.risk * 0.1;

  // A mediocre team cannot reach a masterpiece however long it works.
  if (ctx.skillLevel !== undefined) cap *= clamp(0.6 + 0.56 * ctx.skillLevel, 0.6, 1.05);

  return clamp(cap, 5, 100);
}

/** Effort at which a dimension reaches ~63% of its cap. Bigger scope ⇒ deeper effort needed. */
export function effortScale(scope: ScopeDef, platform: PlatformDef): number {
  return scope.workUnits * 0.42 * platformWorkMult(platform.kind);
}

const PLATFORM_WORK: Record<string, number> = {
  computer: 1,
  console: 1.12,
  handheld: 0.82,
  digital: 0.94,
};

export function platformWorkMult(kind: string): number {
  return PLATFORM_WORK[kind] ?? 1;
}

/**
 * How well funded a project is: committed budget against what a properly staffed
 * project of this scope costs. Underfunding is what caps quality — not spend-throughput.
 */
export function fundingRatio(project: { scope: ScopeId; budget: number; workRequired: number }): number {
  const scope = scopeDef(project.scope);
  const need = scope.recommendedBudget * clamp(project.workRequired / scope.workUnits, 0.6, 2.2);
  if (need <= 0) return 1;
  return clamp(project.budget / need, 0, 1);
}

/** True when the project has run out of committed money. */
export function budgetExhausted(project: { budget: number; spent: number }): boolean {
  return project.spent >= project.budget;
}

export interface DevelopmentDelta {
  workDone: number;
  progress: number;
  quality: QualityVector;
  qualityEffort: QualityVector;
  bugs: number;
  bugsFixed: number;
  /** Always 0 here — the development system computes cash burn from the team. */
  spend: number;
  featureComplete: boolean;
  daysInDevelopment: number;
  daysInPolish: number;
}

export interface DevelopInput {
  project: {
    scope: ScopeId;
    genreId: GenreId;
    platformId: PlatformId;
    risk: number;
    crunch: boolean;
    status: string;
    progress: number;
    workRequired: number;
    workDone: number;
    quality: QualityVector;
    qualityEffort: QualityVector;
    bugs: number;
    bugsFixed: number;
    budget: number;
    spent: number;
    daysInDevelopment: number;
    daysInPolish: number;
  };
  team: TeamAnalysis;
  isWeekend: boolean;
  missingRoles: readonly RoleId[];
}

/** Advance one project by one day. Pure: returns the new values, mutates nothing. */
export function developProject(input: DevelopInput): DevelopmentDelta {
  const { project, team } = input;
  const scope = scopeDef(project.scope);
  const genre = GENRES[project.genreId];
  const platform = platformDef(project.platformId);
  const factor = input.isWeekend ? BALANCE.time.weekendFactor : 1;
  const featureComplete = project.progress >= BALANCE.development.featureComplete;

  const budgetRatio = fundingRatio(project);
  const ctx = makeCapContext({
    scopeId: project.scope,
    genreId: project.genreId,
    platformId: project.platformId,
    budgetRatio,
    risk: project.risk,
    missingRoles: input.missingRoles,
  });
  const skillFor = (dim: QualityDimensionId) => team.dimSkill[dim] ?? 0;

  const quality: QualityVector = { ...project.quality };
  const qualityEffort: QualityVector = { ...project.qualityEffort };
  const scale = effortScale(scope, platform);

  for (const dim of QUALITY_DIMENSIONS) {
    // Polish/innovation trait multipliers are already folded in by analyzeTeam.
    let rate = team.dimInput[dim];
    if (dim === 'innovation') {
      rate *= 0.75 + project.risk * 0.6;
      const oversize = Math.max(0, team.headcount - BALANCE.development.largeTeamThreshold);
      rate *= Math.max(0.55, 1 - oversize * BALANCE.development.largeTeamInnovationPenalty);
    }
    // After feature lock, new features stop mattering and effort turns toward refinement.
    if (featureComplete) rate *= dim === 'polish' ? 1 : 0.3;
    const delta = (rate * factor) / effortPerQualityUnit(scope);
    if (delta <= 0) continue;

    const before = qualityEffort[dim];
    const after = before + delta;
    const cap = dimensionCap(dim, { ...ctx, skillLevel: skillFor(dim) });
    const value = cap * (1 - Math.exp(-after / scale));
    quality[dim] = clamp(Math.max(quality[dim], value), 0, 100);
    qualityEffort[dim] = after;
  }

  const work = team.workPerDay * factor;
  const workDone = project.workDone + work;
  const progress = clamp(workDone / project.workRequired, 0, 1.4);

  let bugs = project.bugs;
  let bugsFixed = project.bugsFixed;

  const progressDelta = Math.max(0, progress - project.progress);
  if (progressDelta > 0) {
    bugs +=
      progressDelta *
      BALANCE.development.bugsPerProgress *
      scope.bugMult *
      genre.bugMult *
      (1 + project.risk * 0.5) *
      team.bugRateMult *
      (project.crunch ? 1.25 : 1) *
      (1 - team.qaShare * 0.4);
  }

  if (featureComplete) {
    const capacity = team.fixPower * factor * BALANCE.development.bugFixRate;
    const fixed = Math.min(bugs, capacity);
    if (fixed > 0) {
      bugsFixed += fixed;
      bugs -= fixed;
      const cap = dimensionCap('polish', { ...ctx, skillLevel: skillFor('polish') });
      const gain = Math.min(BALANCE.development.polishPerBugFixed * fixed, Math.max(0, cap - quality.polish));
      quality.polish = clamp(quality.polish + gain, 0, 100);
      qualityEffort.polish += gain > 0 ? gain * scale * 0.02 : 0;
    }
  }

  return {
    workDone,
    progress,
    quality,
    qualityEffort,
    bugs: Math.max(0, bugs),
    bugsFixed,
    spend: 0,
    featureComplete,
    daysInDevelopment: project.daysInDevelopment + (input.isWeekend ? 0 : 1),
    daysInPolish: project.daysInPolish + (featureComplete && !input.isWeekend ? 1 : 0),
  };
}

/** How many "effort units" one point of raw input represents, normalised by scope size. */
function effortPerQualityUnit(scope: ScopeDef): number {
  return 1 / Math.max(0.25, scope.workUnits / 60);
}

/** Expected days of remaining work for a team on this project. */
export function estimateRemainingDays(project: { workRequired: number; workDone: number }, team: TeamAnalysis): number {
  const remaining = Math.max(0, project.workRequired - project.workDone);
  const perDay = team.workPerDay * 0.8; // weekends
  if (perDay <= 0) return Infinity;
  return Math.ceil(remaining / perDay);
}

/**
 * Pre-flight projection for the Create Game screen: given a team, scope, genre and
 * budget, roughly where quality lands at feature-complete. Deterministic, no RNG.
 */
export function projectQualityForecast(params: {
  scopeId: ScopeId;
  genreId: GenreId;
  platformId: PlatformId;
  budget: number;
  risk: number;
  employees: readonly Employee[];
}): { dims: QualityVector; overall: number; days: number; cost: number; ready: boolean } {
  const scope = scopeDef(params.scopeId);
  const genre = GENRES[params.genreId];
  const platform = platformDef(params.platformId);
  const team = analyzeTeam(params.employees, { crunch: false, scope: params.scopeId });

  const dailyCost = params.employees.reduce((acc, e) => acc + e.salary / BALANCE.time.workDaysPerMonth, 0) + params.employees.length * BALANCE.development.toolingCostPerDev;
  const days = team.workPerDay > 0 ? Math.ceil(scope.workUnits * platformWorkMult(platform.kind) / (team.workPerDay * 0.8)) : Infinity;
  const affordableDays = dailyCost > 0 ? Math.floor(params.budget / dailyCost) : days;
  const budgetRatio = params.budget > 0 ? clamp(Math.min(affordableDays, days) / Math.max(1, days), 0, 1) : 0;

  const missingRoles = genre.essentialRoles.filter((role) => !team.roles.includes(role));
  const ctx = makeCapContext({
    scopeId: params.scopeId,
    genreId: params.genreId,
    platformId: params.platformId,
    budgetRatio,
    risk: params.risk,
    missingRoles,
  });

  const dims = emptySkills();
  const scale = effortScale(scope, platform);
  for (const dim of QUALITY_DIMENSIONS) {
    let rate = team.dimInput[dim];
    if (dim === 'innovation') rate *= 0.75 + params.risk * 0.6;
    const totalEffort = (rate * Math.min(days, Math.max(1, affordableDays))) / effortPerQualityUnit(scope);
    dims[dim] = dimensionCap(dim, { ...ctx, skillLevel: team.dimSkill[dim] ?? 0 }) * (1 - Math.exp(-totalEffort / scale));
  }

  let weighted = 0;
  let weightSum = 0;
  for (const dim of QUALITY_DIMENSIONS) {
    weighted += dims[dim] * genre.criticWeights[dim];
    weightSum += genre.criticWeights[dim];
  }

  return {
    dims,
    overall: weightSum ? weighted / weightSum : 0,
    days,
    cost: dailyCost * days,
    ready: affordableDays >= days,
  };
}

/** Bug count that counts as "fully broken" for a project of this scope. */
export function bugScaleFor(scopeId: ScopeId): number {
  return scopeDef(scopeId).workUnits * 0.12;
}

/** 0..1 — how badly the open bug backlog hurts. */
export function bugSeverity(bugs: number, scopeId: ScopeId): number {
  return clamp(bugs / bugScaleFor(scopeId), 0, 1.6);
}

/** Convenience used by the UI: quality as a 0..100 average. */
export function averageQuality(quality: QualityVector): number {
  let total = 0;
  for (const dim of QUALITY_DIMENSIONS) total += quality[dim];
  return total / QUALITY_DIMENSIONS.length;
}

/** Contribution share of each dimension — used for "what is this game strong at". */
export function contributionShare(quality: QualityVector, weights: QualityVector): QualityVector {
  const out = emptySkills();
  let total = 0;
  for (const dim of QUALITY_DIMENSIONS) {
    out[dim] = quality[dim] * weights[dim];
    total += out[dim];
  }
  if (total > 0) for (const dim of QUALITY_DIMENSIONS) out[dim] /= total;
  return out;
}
