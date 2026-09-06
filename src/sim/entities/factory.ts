/**
 * Entity factories. The only place that knows how to *create* state objects, so
 * world generation, the AI and the player all build entities through identical code
 * (which is what makes AI studios honest rather than simulated-with-shortcuts).
 */

import type { Rng } from '../core/rng';
import { BALANCE } from '../data/balance';
import { GENRE_ORDER, GENRES } from '../data/genres';
import { ROLE_ORDER, ROLES } from '../data/roles';
import { TRAITS, TRAIT_ORDER, NEGATIVE_TRAITS, traitSalary } from '../data/traits';
import { SCOPES } from '../data/scopes';
import { platformDef } from '../data/platforms';
import { QUALITY_DIMENSIONS, type GenreId, type PlatformId, type QualityDimensionId, type RoleId, type ScopeId } from '../core/types';
import { clamp } from '../core/math';
import { emptySkills, marketValue, type Employee } from './employee';
import { createQualityVector, type Project } from './project';
import { emptyFinanceLedger, emptyGenreStrength, type AiProfile, type Studio } from './studio';
import type { WorldState } from '../state/world';
import { allocateId } from '../state/world';
import { gameTitle, personName, studioName, studioTagline } from '../data/names';

export interface CandidateOptions {
  /** 0..1 — skill tier of the applicant pool. */
  tier: number;
  /** Year the candidate appears in (wages/skills drift upward over the decades). */
  year: number;
  /** Which role they apply for; omit to choose at random. */
  role?: RoleId;
  /** 0..1 — how senior they are. */
  seniority?: number;
  nextId?: number;
}

const YEAR_SKILL_DRIFT = 0.35; // points of average skill per year, as tooling improves

export function generateSkills(rng: Rng, role: RoleId, tier: number, year: number): Record<QualityDimensionId, number> {
  const def = ROLES[role];
  const skills = emptySkills();
  const drift = (year - 1990) * YEAR_SKILL_DRIFT;
  for (const dim of QUALITY_DIMENSIONS) {
    const shape = def.skillShape[dim] ?? 0.05;
    const mean = 22 + shape * 100 * (0.45 + 0.55 * tier) + Math.min(16, drift * 0.5);
    skills[dim] = clamp(Math.round(rng.gauss(mean, 11 + shape * 8)), 1, 100);
  }
  // Guarantee the role's signature dimension reflects its strength.
  const primary = def.primary;
  skills[primary] = clamp(Math.round(Math.max(skills[primary], 20 + tier * 62 + Math.min(14, drift * 0.5) + rng.range(-6, 6))), 1, 100);
  return skills;
}

export function generateTraits(rng: Rng, count?: number): string[] {
  const n = count ?? rng.weighted([42, 34, 18, 6]);
  const chosen: string[] = [];
  for (let i = 0; i < n; i++) {
    const id = rng.pick(TRAIT_ORDER);
    if (chosen.includes(id)) continue;
    // Cap the number of drawbacks so generated staff stay employable.
    if (NEGATIVE_TRAITS.includes(id as never) && chosen.some((t) => NEGATIVE_TRAITS.includes(t as never))) continue;
    chosen.push(id);
  }
  return chosen;
}

export function createEmployee(state: WorldState, rng: Rng, opts: CandidateOptions): Employee {
  const role = opts.role ?? rng.pickWeighted(ROLE_ORDER, (r) => roleMarketWeight(state)[ROLE_ORDER.indexOf(r)] ?? 1);
  const seniority = opts.seniority ?? clamp(rng.range(0, 1), 0, 1);
  const tier = clamp(opts.tier * (0.6 + seniority * 0.6), 0, 1);
  const skills = generateSkills(rng, role, tier, opts.year);
  const experience = clamp(Math.round(seniority * 16 + rng.range(-1, 2)), 0, 34);
  const traits = generateTraits(rng);
  const emp: Employee = {
    id: allocateId(state, 'employee'),
    name: personName(rng),
    role,
    skills,
    potential: clamp(rng.range(0.75, 1.55), 0.5, 2),
    salary: 0,
    experience,
    morale: Math.round(rng.range(48, 86)),
    loyalty: Math.round(clamp(rng.gauss(52, 18), 5, 96)),
    traits,
    studioId: null,
    hiredTick: state.calendar.tick,
    status: 'candidate',
    workUnitsShipped: 0,
    gamesShipped: 0,
    bestReviewScore: 0,
    preferredGenre: rng.chance(0.65) ? rng.pick(GENRE_ORDER) : null,
  };
  emp.salary = Math.round(marketValue(emp) * (1 + (traitSalary(traits) - 1) * 0.5));
  return emp;
}

/**
 * Relative demand for each role in the current industry, which shapes who shows up
 * to apply. Programmers and artists are the perennial majority; writers/audio arrive
 * in waves when narrative genres are hot.
 */
export function roleMarketWeight(state: WorldState): number[] {
  const weights = ROLE_ORDER.map(() => 1);
  const index = (role: RoleId) => ROLE_ORDER.indexOf(role);
  weights[index('programmer')] = 4.2;
  weights[index('designer')] = 3.0;
  weights[index('artist')] = 3.6;
  weights[index('writer')] = 1.4;
  weights[index('audio')] = 1.5;
  weights[index('producer')] = 1.1;
  weights[index('qa')] = 2.6;
  const hot = (genre: GenreId) => (state.market.genres[genre]?.popularity ?? 50) / 50;
  weights[index('writer')] *= 0.6 + 0.7 * hot('adventure') * 0.5 + 0.4 * hot('rpg') * 0.5;
  weights[index('audio')] *= 0.6 + 0.5 * hot('horror');
  weights[index('artist')] *= 0.8 + 0.35 * hot('action');
  return weights;
}

export function createAiProfile(rng: Rng): AiProfile {
  const ambition = clamp(rng.range(0.15, 1), 0, 1);
  const qualityFocus = clamp(rng.gauss(0.5, 0.24), 0.05, 0.98);
  const style =
    qualityFocus > 0.72
      ? 'Auteur'
      : qualityFocus > 0.45
        ? 'Balanced'
        : ambition > 0.6
          ? 'Volume merchant'
          : 'Budget specialist';
  const preferredCount = rng.int(1, 3);
  const preferredGenres = rng.sample(GENRE_ORDER, preferredCount);
  return {
    ambition,
    riskAppetite: clamp(rng.gauss(ambition * 0.6 + 0.2, 0.18), 0.02, 1),
    qualityFocus,
    marketingFocus: clamp(rng.gauss(0.45 + ambition * 0.3, 0.2), 0.05, 1),
    hiringAppetite: clamp(rng.gauss(0.5 + ambition * 0.25, 0.2), 0.05, 1),
    adaptability: clamp(rng.range(0.1, 0.95), 0, 1),
    loyalty: clamp(rng.range(0.15, 0.95), 0, 1),
    preferredGenres,
    style,
    tagline: studioTagline(rng),
  };
}

/** Build a studio *and* register it in the world state. */
export function createStudio(state: WorldState, rng: Rng, opts: { name?: string; isPlayer: boolean; foundedYear: number; cash: number; reputation: number }): Studio {
  const id = allocateId(state, 'studio');
  const taken = new Set(Object.values(state.studios).map((s) => s.name));
  const studio: Studio = {
    id,
    name: (opts.name ?? '').trim() || studioName(rng, taken),
    foundedYear: opts.foundedYear,
    isPlayer: opts.isPlayer,
    status: 'active',
    cash: Math.round(opts.cash),
    reputation: clamp(Math.round(opts.reputation), 0, 100),
    employeeIds: [],
    projectIds: [],
    releaseIds: [],
    genreStrength: emptyGenreStrength(),
    lastReleaseTick: -1,
    lastReleaseReview: 0,
    consecutiveLosses: 0,
    monthsBroke: 0,
    layoffs: 0,
    hires: 0,
    defunctTick: null,
    ai: opts.isPlayer ? null : createAiProfile(rng),
    finances: emptyFinanceLedger(opts.cash),
  };
  state.studios[id] = studio;
  return studio;
}

export interface StartProjectOptions {
  title?: string;
  genreId: GenreId;
  platformId: PlatformId;
  scope: ScopeId;
  budget: number;
  teamIds: string[];
  risk: number;
  marketing?: number;
  /** Platform licence/SDK fee is charged on creation. */
}

export function createProject(state: WorldState, studioId: string, rng: Rng, opts: StartProjectOptions): Project {
  const scope = SCOPES[opts.scope];
  const id = allocateId(state, 'project');
  const workRequired = Math.round(scope.workUnits * (1 + (GENRES[opts.genreId].expectationMult - 1) * 0.35));
  return {
    id,
    studioId,
    title: opts.title?.trim() || gameTitle(rng, opts.genreId),
    genreId: opts.genreId,
    platformId: opts.platformId,
    scope: opts.scope,
    status: 'development',
    budget: Math.round(opts.budget),
    spent: 0,
    marketing: Math.round(opts.marketing ?? 0),
    workRequired,
    workDone: 0,
    progress: 0,
    quality: createQualityVector(0),
    qualityEffort: createQualityVector(0),
    risk: clamp(opts.risk, 0, 1),
    bugs: 0,
    bugsFixed: 0,
    bugsPeak: 0,
    teamIds: [...opts.teamIds],
    crunch: false,
    stalledDays: 0,
    createdTick: state.calendar.tick,
    daysInDevelopment: 0,
    daysInPolish: 0,
    focus: null,
    releasedReleaseId: null,
  };
}

/** One-off SDK/licence cost charged when a project starts on a platform. */
export function platformLicenceFee(platformId: PlatformId): number {
  return platformDef(platformId).devkitCost;
}

/** Reasonable budget for a scope given team size and expected duration — used by UI and AI alike. */
export function suggestBudget(scopeId: ScopeId, headcount: number, days: number, platformId: PlatformId): number {
  const scope = SCOPES[scopeId];
  const monthlySalaryEstimate = headcount * 1900;
  const tooling = headcount * BALANCE.development.toolingCostPerDev * 22;
  const burn = (monthlySalaryEstimate + tooling) / 30;
  const labour = burn * Math.max(1, days);
  const licence = platformLicenceFee(platformId);
  return Math.round(Math.max(scope.recommendedBudget * 0.5, labour + licence));
}

export function totalTraitCount(): number {
  return TRAIT_ORDER.length;
}
