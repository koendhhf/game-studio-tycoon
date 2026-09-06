/**
 * Pre-release planning.
 *
 * The Create Game screen must show what a decision will actually do, so the projection
 * lives here rather than in a component. It runs the *same* team analysis, dimension caps,
 * review model and sales model the simulation uses — there is no second, friendlier
 * formula for the player. Nothing here mutates the world: it is a pure calculator over a
 * draft spec, which also makes it directly testable.
 */

import { QUALITY_DIMENSIONS, type GenreId, type PlatformId, type QualityDimensionId, type RoleId, type ScopeId } from '../core/types';
import { GENRES } from '../data/genres';
import { ROLES, missingRoles } from '../data/roles';
import { platformDef, platformAudience, isPlatformAvailable } from '../data/platforms';
import { scopeDef } from '../data/scopes';
import { yearFraction } from '../core/calendar';
import { BALANCE } from '../data/balance';
import { clamp } from '../core/math';
import { analyzeTeam, dimensionCap, effortScale, makeCapContext, type TeamAnalysis } from './development-model';
import { calculateReviews, recommendedMarketingFor, dimensionDescriptor } from './review-model';
import { estimateLifetimeUnits, openingUnits, priceFor, revenueFor, type SalesInput } from './sales-model';
import { createQualityVector } from '../entities/project';
import { employeeOf } from '../state/world';
import type { WorldState } from '../state/world';
import type { QualityRecord } from './review-model';

export interface ProjectDraft {
  studioId: string;
  title: string;
  genreId: GenreId;
  platformId: PlatformId;
  scope: ScopeId;
  teamIds: string[];
  budget: number;
  marketing: number;
  /** 0..1 — how much new ground the project attempts. */
  risk: number;
  crunch: boolean;
}

export interface DimensionForecast {
  dim: QualityDimensionId;
  projected: number;
  cap: number;
  weight: number;
  descriptor: string;
}

export interface ProjectPlan {
  quality: QualityRecord;
  dims: DimensionForecast[];
  /** Critic-weighted quality — the number the reviews will basically be built from. */
  overall: number;
  daysToFeatureComplete: number;
  daysToPolish: number;
  totalDays: number;
  /** Labour attributed to the project budget, and the tooling charged to the studio. */
  labourCost: number;
  toolingCost: number;
  devkitCost: number;
  marketingCost: number;
  /** Cash + budget the studio has committed if it starts this right now. */
  cashCommitted: number;
  recommendedBudget: number;
  recommendedMarketing: number;
  price: number;
  openingUnits: number;
  lifetimeUnits: number;
  grossRevenue: number;
  netRevenue: number;
  breakEvenUnits: number;
  projectedProfit: number;
  reviewScore: number;
  receptionScore: number;
  projectedBugs: number;
  headcount: number;
  workPerDay: number;
  fundingRatio: number;
  weights: Record<QualityDimensionId, number>;
  warnings: string[];
  blockers: string[];
  /** The exact input the sales model was given — useful in tests and tooltips. */
  salesInput: SalesInput;
}

/** Calendar-day throughput factor: weekends work at `weekendFactor`. */
const WEEK_WEIGHT = (5 + 2 * BALANCE.time.weekendFactor) / 7;

/**
 * Project a proposed project: quality at ship time, the review score that follows, the
 * money it costs and the money it earns, plus plain-language warnings.
 */
export function planProject(state: WorldState, draft: ProjectDraft): ProjectPlan {
  const studio = state.studios[draft.studioId];
  const genre = GENRES[draft.genreId];
  const scope = scopeDef(draft.scope);
  const platform = platformDef(draft.platformId);
  const team = draft.teamIds
    .map((id) => employeeOf(state, id))
    .filter((e): e is NonNullable<typeof e> => !!e && e.studioId === draft.studioId);

  const analysis = analyzeTeam(team, { crunch: draft.crunch, scope: draft.scope });
  const missing = missingRoles(team.map((e) => e.role), ALL_ROLES);
  const workRequired = scope.workUnits * (0.5 + genre.expectationMult * 0.5) * (1 + clamp(draft.risk, 0, 1) * 0.35);
  const dailyWork = analysis.workPerDay * WEEK_WEIGHT;
  const daysToFeatureComplete = dailyWork > 0 ? Math.max(1, Math.ceil(workRequired / dailyWork)) : Infinity;

  const dailyLabour = team.reduce((acc, e) => acc + e.salary / BALANCE.time.workDaysPerMonth, 0);
  const dailyTooling = team.length * BALANCE.development.toolingCostPerDev;
  const labourCost = Math.round(dailyLabour * WEEK_WEIGHT * daysToFeatureComplete);
  const toolingCost = Math.round(dailyTooling * WEEK_WEIGHT * daysToFeatureComplete);
  const devkitCost = platform.devkitCost;

  const neededBudget = Math.round(scope.recommendedBudget * clamp(workRequired / scope.workUnits, 0.6, 2.2));
  const funding = neededBudget > 0 ? clamp(draft.budget / neededBudget, 0, 1) : 1;

  const ctx = makeCapContext({
    scopeId: draft.scope,
    genreId: draft.genreId,
    platformId: draft.platformId,
    budgetRatio: funding,
    risk: clamp(draft.risk, 0, 1),
    missingRoles: missing,
  });
  const scale = effortScale(scope, platform);
  const effortPerUnit = Math.max(0.25, scope.workUnits / 60);
  const quality = createQualityVector(0);
  const caps = createQualityVector(0);
  const runnable = Number.isFinite(daysToFeatureComplete);

  for (const dim of QUALITY_DIMENSIONS) {
    const cap = dimensionCap(dim, { ...ctx, skillLevel: analysis.dimSkill[dim] ?? 0 });
    caps[dim] = cap;
    let rate = analysis.dimInput[dim] ?? 0;
    if (dim === 'innovation') rate *= 0.75 + clamp(draft.risk, 0, 1) * 0.6;
    if (!runnable || rate <= 0) continue;
    const effort = rate * WEEK_WEIGHT * daysToFeatureComplete * effortPerUnit;
    quality[dim] = cap * (1 - Math.exp(-effort / scale));
  }

  const projectedBugs = generateBugs(analysis, scope, genre, draft, 0);
  const shipTarget = Math.max(2, workRequired * 0.012);
  const fixPower = Math.max(0.5, analysis.fixPower * BALANCE.development.bugFixRate * WEEK_WEIGHT);
  // Nobody assigned means nobody fixing bugs: the polish phase never ends, so the plan must
  // not quietly award polish points to a project that cannot be finished.
  const daysToPolish = !runnable ? Infinity : projectedBugs > shipTarget ? Math.ceil((projectedBugs - shipTarget) / fixPower) : 0;
  const bugsAtShip = !runnable ? projectedBugs : Math.max(shipTarget, projectedBugs - daysToPolish * fixPower);
  const polishGain = runnable ? Math.min(BALANCE.development.polishBonusMax, (projectedBugs - bugsAtShip) * BALANCE.development.polishPerBugFixed) : 0;
  // Bug fixing lifts polish, but the same ceiling the simulation enforces — otherwise the
  // Create Game screen promises a polish score the development system will never deliver.
  quality.polish = clamp(Math.min(quality.polish + polishGain, caps.polish), 0, 100);

  const totalDays = daysToFeatureComplete + daysToPolish;

  const reviews = calculateReviews({
    quality,
    genreId: draft.genreId,
    platformId: draft.platformId,
    scopeId: draft.scope,
    bugs: bugsAtShip,
    completeness: 1,
    marketingSpend: draft.marketing,
    reputation: studio?.reputation ?? 10,
    genreStrength: studio?.genreStrength[draft.genreId] ?? 0,
    noise: [0, 0, 0, 0, 0, 0, 0, 0],
  });

  const recommendedMarketing = recommendedMarketingFor(draft.scope, draft.platformId, studio?.reputation ?? 10);
  const price = priceFor(draft.scope, draft.platformId, draft.genreId, state.economy.priceLevel);
  const marketGenre = state.market.genres[draft.genreId];
  const salesInput: SalesInput = {
    genreId: draft.genreId,
    platformId: draft.platformId,
    scopeId: draft.scope,
    quality,
    reviewScore: reviews.score,
    receptionScore: reviews.reception.score,
    reputation: studio?.reputation ?? 10,
    marketingSpend: draft.marketing,
    recommendedMarketing,
    audienceM: platformAudience(draft.platformId, yearFraction(state.calendar)),
    popularity: marketGenre?.popularity ?? genre.basePopularity,
    demand: marketGenre?.demand ?? 60,
    competition: marketGenre?.competition ?? 20,
    completeness: 1,
    bugs: bugsAtShip,
    genreStrength: studio?.genreStrength[draft.genreId] ?? 0,
    priceLevel: state.economy.priceLevel,
    awareness:
      clamp(draft.marketing / Math.max(1, recommendedMarketing), 0, 1) * 0.8 + clamp((studio?.reputation ?? 10) / 100, 0, 1) * 0.35,
  };
  const opening = openingUnits(salesInput);
  const lifetime = estimateLifetimeUnits(salesInput);
  const money = revenueFor(lifetime, { platformId: draft.platformId, price });
  const cashCommitted = draft.budget + draft.marketing + devkitCost;
  const perUnitNet = lifetime > 0 ? money.netRevenue / lifetime : 0;
  const breakEvenUnits = perUnitNet > 0 ? Math.ceil(cashCommitted / perUnitNet) : Infinity;

  const weightSum = QUALITY_DIMENSIONS.reduce((acc, dim) => acc + (genre.criticWeights[dim] ?? 0), 0) || 1;
  const overall = QUALITY_DIMENSIONS.reduce((acc, dim) => acc + quality[dim] * (genre.criticWeights[dim] ?? 0), 0) / weightSum;

  const dims: DimensionForecast[] = QUALITY_DIMENSIONS.map((dim) => ({
    dim,
    projected: quality[dim],
    cap: caps[dim],
    weight: genre.criticWeights[dim] ?? 0,
    descriptor: dimensionDescriptor(dim, quality[dim]),
  }));

  const warnings: string[] = [];
  const blockers: string[] = [];
  const essential = missingRoles(team.map((e) => e.role), genre.essentialRoles);
  const cash = studio?.cash ?? 0;

  if (!studio) blockers.push('No studio to charge.');
  if (team.length === 0) blockers.push('Nobody is assigned to this project.');
  if (!isPlatformAvailable(draft.platformId, state.calendar.year)) blockers.push(`${platform.name} is not on sale in ${state.calendar.year}.`);
  if (draft.budget < 1000) blockers.push('A project needs a budget of at least $1,000.');
  if (cashCommitted > cash) blockers.push(`Costs $${Math.round(cashCommitted).toLocaleString('en-US')} but the studio holds $${Math.round(cash).toLocaleString('en-US')}.`);
  if (draft.title.trim().length < 2) blockers.push('Give the game a title of at least two characters.');

  if (team.length > 0 && team.length < scope.minTeam) warnings.push(`A ${scope.name.toLowerCase()} project wants at least ${scope.minTeam} people; you have ${team.length}.`);
  if (team.length > scope.optimalTeam) warnings.push(`${team.length} people on a ${scope.name.toLowerCase()} project gets in each other's way (sweet spot: ${scope.optimalTeam}).`);
  if (essential.length > 0) {
    const names = essential.map((r) => ROLES[r].name).join(' and no ');
    warnings.push(`No ${names} on the team — the dimensions that role owns will barely move.`);
  }
  if (funding < 0.85) warnings.push(`The budget covers ${Math.round(funding * 100)}% of what this scope needs, which lowers every quality ceiling.`);
  if (labourCost + toolingCost > draft.budget) {
    warnings.push(`Wages and tooling alone need $${(labourCost + toolingCost).toLocaleString('en-US')} over ${totalDays} days — more than the $${draft.budget.toLocaleString('en-US')} budget.`);
  }
  if (draft.marketing < recommendedMarketing * 0.5) warnings.push('Marketing is thin: fewer people will hear about this at launch.');
  if (draft.marketing > recommendedMarketing * 1.7) warnings.push('Marketing is past what this scope can convert; the extra money buys very little.');
  if (totalDays > 620) warnings.push(`At roughly ${totalDays} days this game ties the studio up for two years.`);
  if (draft.crunch) warnings.push('Crunch delivers faster but burns morale, and burned people quit.');
  if (perUnitNet > 0 && lifetime < breakEvenUnits * 0.85) warnings.push('Projected sales are below break-even for this budget.');

  return {
    quality,
    dims,
    overall,
    daysToFeatureComplete,
    daysToPolish,
    totalDays,
    labourCost,
    toolingCost,
    devkitCost,
    marketingCost: draft.marketing,
    cashCommitted,
    recommendedBudget: neededBudget,
    recommendedMarketing,
    price,
    openingUnits: opening,
    lifetimeUnits: lifetime,
    grossRevenue: money.grossRevenue,
    netRevenue: money.netRevenue,
    breakEvenUnits,
    projectedProfit: money.netRevenue - cashCommitted,
    reviewScore: reviews.score,
    receptionScore: reviews.reception.score,
    projectedBugs: Math.round(bugsAtShip),
    headcount: team.length,
    workPerDay: analysis.workPerDay,
    fundingRatio: funding,
    weights: genre.criticWeights,
    warnings,
    blockers,
    salesInput,
  };
}

/** Bug accumulation over the project's whole progress curve, before polish. */
function generateBugs(team: TeamAnalysis, scope: ReturnType<typeof scopeDef>, genre: (typeof GENRES)[GenreId], draft: ProjectDraft, fixed: number): number {
  const generated =
    BALANCE.development.bugsPerProgress *
    scope.bugMult *
    genre.bugMult *
    (1 + clamp(draft.risk, 0, 1) * 0.5) *
    team.bugRateMult *
    (draft.crunch ? 1.25 : 1) *
    (1 - team.qaShare * 0.4);
  return Math.max(0, generated - fixed);
}

const ALL_ROLES: readonly RoleId[] = Object.keys(ROLES) as RoleId[];
