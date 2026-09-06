/**
 * World generation.
 *
 * One function builds a complete starting world: the player's studio, roughly twenty
 * AI studios with staff, personalities and pipelines, an open labour market, a market
 * state and a back-catalogue of releases for the established companies. Everything is
 * derived from the seed, so two players with the same seed start in an identical industry.
 */

import { createRngState, randFor, Rng } from './core/rng';
import { BALANCE } from './data/balance';
import { GENRE_ORDER, GENRES } from './data/genres';
import { PLATFORM_ORDER, availablePlatforms, isPlatformAvailable, platformAudience, platformDef } from './data/platforms';
import { ROLE_ORDER } from './data/roles';
import { SCOPE_ORDER, scopeDef } from './data/scopes';
import { formatDate } from './core/calendar';
import { QUALITY_DIMENSIONS, type GenreId, type RoleId, type ScopeId } from './core/types';
import { clamp } from './core/math';
import { createEmployee, createProject, createStudio } from './entities/factory';
import { createQualityVector } from './entities/project';
import type { ReleasedGame } from './entities/game';
import type { Employee } from './entities/employee';
import type { Studio } from './entities/studio';
import { createMarketState } from './entities/market';
import { calculateReviews, recommendedMarketingFor } from './models/review-model';
import { priceFor, revenueFor, estimateLifetimeUnits } from './models/sales-model';
import { addProject, attachEmployee } from './operations';
import { advanceProject } from './systems/development';
import { allocateId, DEFAULT_CONFIG, type SimConfig, type WorldState } from './state/world';
import { createWorld } from './state/world';

export interface NewGameOptions {
  seed?: number;
  studioName?: string;
  config?: Partial<SimConfig>;
}

const STARTER_TEAM: RoleId[] = ['programmer', 'designer', 'artist', 'qa'];

function noise(seed: number, releaseId: string, count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    out.push((randFor(seed, `${releaseId}:rev:${i}`) * 2 - 1) * BALANCE.reviews.noise);
  }
  return out;
}

/** Historical releases for established studios, generated through the real models. */
function seedHistory(state: WorldState, rng: Rng, studio: Studio, studioAge: number): void {
  const profile = studio.ai;
  const count = clamp(Math.round(studioAge / 2.2 + rng.range(-1, 2)), 0, 7);
  for (let i = 0; i < count; i++) {
    const genreId: GenreId = profile && rng.chance(0.55) && profile.preferredGenres.length > 0 ? rng.pick(profile.preferredGenres) : rng.pick(GENRE_ORDER);
    const year = studio.foundedYear + Math.round(((i + 1) / (count + 1)) * studioAge);
    if (year > state.config.startYear) break;
    const scopeWeight = rng.weighted([12, 30, 34, 18, 6]);
    const scopeId: ScopeId = SCOPE_ORDER[clamp(scopeWeight, 0, SCOPE_ORDER.length - 1)];
    const live = PLATFORM_ORDER.filter((p) => isPlatformAvailable(p, year));
    const platformId = live.length > 0 ? rng.pickWeighted(live, (p) => platformAudience(p, year)) : 'pc';
    const releaseTick = (year - state.config.startYear) * 365 + rng.int(30, 330);
    const id = allocateId(state, 'release');

    const quality = createQualityVector(0);
    const base = 34 + studio.reputation * 0.28 + i * 2.2 + (profile?.qualityFocus ?? 0.5) * 16 + rng.range(-10, 12);
    for (const dim of QUALITY_DIMENSIONS) {
      quality[dim] = clamp(Math.round(rng.gauss(base, 13)), 5, 96);
    }
    const bugs = Math.round(rng.range(0, scopeDef(scopeId).workUnits * 0.05));

    const outcome = calculateReviews({
      quality,
      genreId,
      platformId,
      scopeId,
      bugs,
      completeness: rng.range(0.85, 1),
      marketingSpend: Math.round(scopeDef(scopeId).marketingBase * rng.range(0.2, 1.1)),
      reputation: clamp(studio.reputation, 2, 90),
      genreStrength: studio.genreStrength[genreId] ?? 0,
      noise: noise(state.seed, id, 6),
    });

    const audienceM = platformAudience(platformId, year);
    const price = priceFor(scopeId, platformId, genreId, 1);
    const units = estimateLifetimeUnits({
      genreId,
      platformId,
      scopeId,
      quality,
      reviewScore: outcome.score,
      receptionScore: outcome.reception.score,
      reputation: studio.reputation,
      marketingSpend: 0,
      recommendedMarketing: recommendedMarketingFor(scopeId, platformId, studio.reputation),
      audienceM,
      popularity: GENRES[genreId].basePopularity,
      demand: 70,
      competition: 22,
      completeness: 1,
      bugs,
      genreStrength: studio.genreStrength[genreId] ?? 0,
      priceLevel: 1,
      awareness: 0.3,
    });
    const money = revenueFor(units, { platformId, price });
    const devCost = Math.round(scopeDef(scopeId).recommendedBudget * rng.range(0.55, 1.35));
    const staff: Employee[] = studio.employeeIds.map((sid) => state.employees[sid]).filter(Boolean);

    const game: ReleasedGame = {
      id,
      studioId: studio.id,
      studioName: studio.name,
      isPlayerGame: false,
      title: `${randomPastTitle(rng, genreId)}`,
      genreId,
      platformId,
      scope: scopeId,
      releaseTick,
      releaseYear: year,
      releaseMonth: rng.int(0, 11),
      releaseDay: rng.int(1, 28),
      releaseLabel: '',
      developmentCost: devCost,
      marketingSpend: Math.round(scopeDef(scopeId).marketingBase * rng.range(0.2, 1.1)),
      revenue: money.netRevenue,
      grossRevenue: money.grossRevenue,
      unitsSold: units,
      openingUnits: Math.max(1, Math.round(units / 3.1)),
      price,
      teamHeadcount: (staff ?? []).length || rng.int(3, 24),
      credits: archiveCredits(state, studio, rng),
      developmentDays: rng.int(90, 700),
      quality,
      bugsAtRelease: bugs,
      completeness: 1,
      reviewScore: outcome.score,
      reviews: outcome.reviews,
      reception: outcome.reception,
      sales: [],
      weeksOnSale: 26,
      peakWeeklyUnits: Math.round(units / 3.1),
      status: 'retired',
      roi: devCost > 0 ? Math.round((money.netRevenue / (devCost + 1)) * 100) / 100 : 0,
      reputationDelta: 0,
      legacy: clamp((outcome.score - 60) / 40, 0, 3),
    };
    game.releaseLabel = `${formatDate({ year, month: game.releaseMonth, day: game.releaseDay })} (archive)`;
    state.releases[id] = game;
    studio.releaseIds.push(id);
    state.stats.gamesReleasedTotal += 1;
    studio.genreStrength[genreId] = clamp((studio.genreStrength[genreId] ?? 0) + (outcome.score > 70 ? 0.09 : 0.03), 0, 1);
  }
}

const PAST_TITLE_A = ['Star', 'Iron', 'Neo', 'Dark', 'Mega', 'Turbo', 'Crystal', 'Silent', 'Rapid', 'Final', 'Grand', 'Blue', 'Hyper', 'Last'];
const PAST_TITLE_B = ['Quest', 'Force', 'Fighter', 'Racer', 'Legion', 'Empire', 'Saga', 'Command', 'Adventure', 'Strike', 'World', 'League', 'Phantom', 'Blade'];

/** Back-catalogue credits: whoever works there now, as an approximation of the past team. */
function archiveCredits(state: WorldState, studio: Studio, rng: Rng) {
  const staff = studio.employeeIds
    .map((id) => state.employees[id])
    .filter((e): e is Employee => Boolean(e))
    .slice(0, 8);
  return staff.map((e) => ({
    employeeId: e.id,
    name: e.name,
    role: e.role,
    skill: clamp(Math.round(rng.gauss(52, 12)), 5, 96),
  }));
}

function randomPastTitle(rng: Rng, genreId: GenreId): string {
  const a = rng.pick(PAST_TITLE_A);
  const b = rng.pick(PAST_TITLE_B);
  const numeral = rng.chance(0.3) ? ` ${rng.pick(['II', 'III', 'IV', "'94", "'96"])}` : '';
  void genreId;
  return `${a}${b}${numeral}`;
}

/** Start a plausible project for an AI studio and advance it some days, so the world
 *  opens with competitors mid-production rather than idle. */
function seedAiPipeline(state: WorldState, rng: Rng, studio: Studio): void {
  const staff: Employee[] = studio.employeeIds.map((id) => state.employees[id]).filter(Boolean);
  if (staff.length < 2) return;
  const profile = studio.ai;
  const genreId: GenreId = profile && rng.chance(0.6) && profile.preferredGenres.length > 0 ? rng.pick(profile.preferredGenres) : rng.pick(GENRE_ORDER);
  const live = availablePlatforms(state.calendar.year);
  if (live.length === 0) return;
  const platform = rng.pickWeighted(live, (p) => platformAudience(p.id, state.calendar.year));
  const affordable = SCOPE_ORDER.filter((s) => scopeDef(s).recommendedBudget <= studio.cash * 0.5);
  const scopeId: ScopeId = affordable.length > 0 ? affordable[Math.min(affordable.length - 1, rng.int(0, affordable.length - 1))] : 'prototype';

  const project = createProject(state, studio.id, rng, {
    genreId,
    platformId: platform.id,
    scope: scopeId,
    budget: Math.round(scopeDef(scopeId).recommendedBudget * rng.range(0.7, 1.25)),
    teamIds: staff.map((e) => e.id),
    risk: clamp((profile?.riskAppetite ?? 0.5) + rng.range(-0.15, 0.15), 0, 1),
    marketing: 0,
  });
  addProject(state, studio, project);
  project.marketing = Math.round(recommendedMarketingFor(scopeId, platform.id, studio.reputation) * (profile?.marketingFocus ?? 0.5));

  // Warm the project up through the real development system.
  const days = rng.int(20, 190);
  for (let d = 0; d < days; d++) {
    state.calendar.tick += 1;
    advanceProject(state, project);
  }
}

export function generateWorld(options: NewGameOptions = {}): WorldState {
  const seed = options.seed ?? 1;
  const config: SimConfig = { ...DEFAULT_CONFIG, ...options.config };
  const state = createWorld(seed, config);
  state.seed = seed;
  state.rng = createRngState(seed);
  const rng = new Rng(state.rng);

  state.market = createMarketState(config.startYear, seed, (key) => randFor(seed, key));

  // ---- Player studio -------------------------------------------------------
  const player = createStudio(state, rng, {
    name: (options.studioName ?? '').trim() || 'Copper Lantern Games',
    isPlayer: true,
    foundedYear: config.startYear,
    cash: config.startingCash,
    reputation: config.startingReputation,
  });
  state.playerStudioId = player.id;

  for (const role of STARTER_TEAM.slice(0, Math.max(2, config.startingEmployees))) {
    const emp = createEmployee(state, rng, { tier: rng.range(0.34, 0.52), year: config.startYear, role, seniority: rng.range(0.18, 0.5) });
    emp.salary = Math.round(emp.salary * 0.92);
    emp.morale = clamp(emp.morale + 10, 0, 100);
    emp.loyalty = clamp(emp.loyalty + 12, 0, 100);
    state.employees[emp.id] = emp;
    attachEmployee(state, player, emp);
  }

  // ---- AI studios ----------------------------------------------------------
  for (let i = 0; i < config.aiStudioCount; i++) {
    const age = rng.int(0, 14);
    const cashTier = rng.range(0, 1);
    const cash = Math.round(BALANCE.studio.aiStartingCash[0] + Math.pow(cashTier, 1.7) * (BALANCE.studio.aiStartingCash[1] - BALANCE.studio.aiStartingCash[0]));
    const studio = createStudio(state, rng, {
      isPlayer: false,
      foundedYear: config.startYear - age,
      cash,
      reputation: clamp(6 + age * 3.1 + cashTier * 26 + rng.range(-6, 8), 2, 82),
    });
    studio.foundedYear = config.startYear - age;

    const headcount = clamp(Math.round(2 + Math.pow(cashTier, 1.1) * 15 + age * 0.4 + rng.range(-1.5, 2.5)), 2, 22);
    const roleMix = pickRoleMix(rng, headcount);
    for (let e = 0; e < headcount; e++) {
      const emp = createEmployee(state, rng, {
        role: roleMix[e],
        tier: clamp(0.2 + cashTier * 0.5 + age * 0.02 + rng.range(-0.12, 0.16), 0.05, 0.98),
        year: config.startYear,
        seniority: clamp(rng.range(0.05, 0.2) + age * 0.05, 0, 1),
      });
      state.employees[emp.id] = emp;
      attachEmployee(state, studio, emp);
    }

    for (const genreId of GENRE_ORDER) {
      const preferred = studio.ai?.preferredGenres.includes(genreId) ? 0.22 : 0;
      studio.genreStrength[genreId] = clamp(preferred + rng.range(0, 0.16) + age * 0.012, 0, 1);
    }
    seedHistory(state, rng, studio, age);
  }

  // ---- Competitors' live pipelines (uses the real development system) -----
  // Rivals start mid-production. We warm their projects up by running the actual
  // development system, then rewind the clock so the run still begins on day 0.
  const eventCountBeforeWarmup = state.events.entries.length;
  for (const id of Object.keys(state.studios).sort()) {
    const studio = state.studios[id];
    if (studio.isPlayer) continue;
    if (rng.chance(0.86)) seedAiPipeline(state, rng, studio);
  }
  state.events.entries.length = eventCountBeforeWarmup;
  state.calendar.tick = 0;
  state.calendar.weekday = 0;
  state.calendar.week = 0;
  state.stats.ticksRun = 0;
  for (const project of Object.values(state.projects)) {
    project.createdTick = -project.daysInDevelopment;
  }
  for (const studio of Object.values(state.studios)) {
    for (const empId of studio.employeeIds) {
      const emp = state.employees[empId];
      if (emp) emp.hiredTick = 0;
    }
  }

  // ---- Open labour market --------------------------------------------------
  const poolSize = BALANCE.hiring.poolTarget + rng.int(-4, 6);
  for (let i = 0; i < poolSize; i++) {
    const emp = createEmployee(state, rng, {
      tier: rng.range(0.1, 0.8),
      year: config.startYear,
      seniority: rng.range(0, 0.8),
    });
    state.employees[emp.id] = emp;
  }

  // ---- Opening events ------------------------------------------------------
  state.events.entries.push({
    id: allocateId(state, 'event'),
    tick: 0,
    year: config.startYear,
    month: 0,
    day: 1,
    dateLabel: `${formatDate({ year: config.startYear, month: 0, day: 1 })}`,
    category: 'studio',
    tone: 'positive',
    title: `${player.name} founded in ${config.startYear}`,
    detail: `${player.employeeIds.length} staff, ${Math.round(player.cash).toLocaleString('en-US')} in the bank and one idea. Start a project to get going.`,
    aboutPlayer: true,
    studioIds: [player.id],
  });
  state.events.entries.push({
    id: allocateId(state, 'event'),
    tick: 0,
    year: config.startYear,
    month: 0,
    day: 1,
    dateLabel: `${formatDate({ year: config.startYear, month: 0, day: 1 })}`,
    category: 'industry',
    tone: 'neutral',
    title: `${config.aiStudioCount} studios are trading this year`,
    detail: `Combined install base of ${liveAudience(state)}M machines across ${availablePlatforms(config.startYear).length} live platforms. The market is open.`,
    aboutPlayer: false,
  });

  return state;
}

function liveAudience(state: WorldState): number {
  let total = 0;
  for (const id of PLATFORM_ORDER) {
    if (!isPlatformAvailable(id, state.calendar.year)) continue;
    total += platformAudience(id, state.calendar.year);
  }
  return Math.round(total * 10) / 10;
}

/** Weight the roles a studio hires by what a company of its size needs. */
function pickRoleMix(rng: Rng, headcount: number): RoleId[] {
  const out: RoleId[] = [];
  const weights: Record<RoleId, number> = { programmer: 4, designer: 3, artist: 3, writer: 1.2, audio: 1.2, producer: 1, qa: 2.4 };
  // Very small studios skip the support roles entirely.
  if (headcount <= 4) {
    weights.producer = 0;
    weights.writer = 0.6;
    weights.audio = 0.6;
    weights.qa = 1;
  }
  for (let i = 0; i < headcount; i++) {
    out.push(ROLE_ORDER[rng.weighted(ROLE_ORDER.map((r) => weights[r]))]);
  }
  // Guarantee at least one programmer and one artist so AI projects can progress.
  if (!out.includes('programmer')) out[0] = 'programmer';
  if (!out.includes('artist')) out[out.length - 1] = 'artist';
  return out;
}

export { QUALITY_DIMENSIONS };
