/**
 * Release pipeline — shared by the player command and the AI brain.
 *
 * Shipping a game is the moment every system meets: it scores the six quality
 * dimensions through the review model, prices the game, opens a sales tail, drains
 * market demand, moves the studio's reputation and writes the permanent history entry.
 */

import { BALANCE } from '../data/balance';
import { formatDate, yearFraction } from '../core/calendar';
import { clamp } from '../core/math';
import type { Rng } from '../core/rng';
import { GENRES } from '../data/genres';
import { QUALITY_DIMENSIONS } from '../core/types';
import { platformAudience, platformDef } from '../data/platforms';
import { scopeDef } from '../data/scopes';
import type { ReleasedGame } from '../entities/game';
import type { Project } from '../entities/project';
import { calculateReviews, recommendedMarketingFor } from '../models/review-model';
import { shipmentMoraleDelta } from '../models/employee-model';
import { demandConsumed, estimateLifetimeUnits, openingUnits, priceFor, type SalesInput } from '../models/sales-model';
import { PUBLICATIONS } from '../data/publications';
import { adjustReputation, charge, emit, teamOf } from '../operations';
import type { WorldState } from '../state/world';
import { allocateId } from '../state/world';

export interface ReleaseOptions {
  /** Extra marketing committed at ship time (AI uses this; player sets it earlier). */
  marketingTopUp?: number;
}

export interface ReleaseResult {
  game: ReleasedGame;
  reviewScore: number;
  receptionScore: number;
  reputationDelta: number;
  projectedUnits: number;
}

/** Deterministic per-publication noise: derived from the run seed and the release index. */
function reviewNoise(seed: number, releaseId: string, count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    // Small, bounded, and stable for a given (seed, release) pair.
    let h = 2166136261 ^ i * 0x9e3779b9;
    for (let k = 0; k < releaseId.length; k++) {
      h ^= releaseId.charCodeAt(k);
      h = Math.imul(h, 16777619);
    }
    h ^= seed;
    h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
    const unit = ((h >>> 0) % 100000) / 100000;
    out.push((unit * 2 - 1) * BALANCE.reviews.noise);
  }
  return out;
}

/**
 * Release a project. Callers must have validated that the project belongs to an active
 * studio and has some progress. Returns null when the release is not possible.
 */
export function releaseProject(state: WorldState, rng: Rng, project: Project, opts: ReleaseOptions = {}): ReleaseResult | null {
  const studio = state.studios[project.studioId];
  // A closed studio ships nothing: this is the last line of defence behind the command
  // validator, and it is what stops a bankrupt studio from releasing after game over.
  if (!studio || studio.status !== 'active') return null;
  if (project.status !== 'development' && project.status !== 'polish' && project.status !== 'stalled' && project.status !== 'ready') {
    return null;
  }
  if (project.progress <= 0.01) return null;

  const cal = state.calendar;
  const genre = GENRES[project.genreId];
  const scope = scopeDef(project.scope);
  const platform = platformDef(project.platformId);
  const marketGenre = state.market.genres[project.genreId];
  const audienceM = platformAudience(project.platformId, yearFraction(cal));

  const recommended = recommendedMarketingFor(project.scope, project.platformId, studio.reputation);
  const marketingSpend = Math.max(0, Math.round(project.marketing + (opts.marketingTopUp ?? 0)));
  const actualMarketing = Math.min(marketingSpend, Math.max(0, studio.cash));
  if (actualMarketing > 0) charge(state, studio, 'marketing', actualMarketing);

  const team = teamOf(state, project);
  const noise = reviewNoise(state.seed, project.id, Math.max(BALANCE.reviews.publicationCount, PUBLICATIONS.length));
  const outcome = calculateReviews(
    {
      quality: project.quality,
      genreId: project.genreId,
      platformId: project.platformId,
      scopeId: project.scope,
      bugs: project.bugs,
      completeness: clamp(project.progress, 0, 1),
      marketingSpend: actualMarketing,
      reputation: studio.reputation,
      genreStrength: studio.genreStrength[project.genreId] ?? 0,
      noise,
    },
    PUBLICATIONS.slice(0, Math.max(3, Math.min(PUBLICATIONS.length, BALANCE.reviews.publicationCount + 1))),
  );

  const price = priceFor(project.scope, project.platformId, project.genreId, state.economy.priceLevel);
  const awareness = clamp(actualMarketing / Math.max(1, recommended), 0, 1) * 0.8 + clamp(studio.reputation / 100, 0, 1) * 0.35;

  const salesInput: SalesInput = {
    genreId: project.genreId,
    platformId: project.platformId,
    scopeId: project.scope,
    quality: project.quality,
    reviewScore: outcome.score,
    receptionScore: outcome.reception.score,
    reputation: studio.reputation,
    marketingSpend: actualMarketing,
    recommendedMarketing: recommended,
    audienceM,
    popularity: (marketGenre?.popularity ?? 50) + 0,
    demand: marketGenre?.demand ?? 60,
    competition: marketGenre?.competition ?? 20,
    completeness: clamp(project.progress, 0, 1),
    bugs: project.bugs,
    genreStrength: studio.genreStrength[project.genreId] ?? 0,
    priceLevel: state.economy.priceLevel,
    awareness,
  };

  const projectedUnits = estimateLifetimeUnits(salesInput);
  const openingUnits = openingUnitsFor(salesInput);

  const id = allocateId(state, 'release');
  const game: ReleasedGame = {
    id,
    studioId: studio.id,
    studioName: studio.name,
    isPlayerGame: studio.isPlayer,
    title: project.title,
    genreId: project.genreId,
    platformId: project.platformId,
    scope: project.scope,
    releaseTick: cal.tick,
    releaseYear: cal.year,
    releaseMonth: cal.month,
    releaseDay: cal.day,
    releaseLabel: formatDate(cal),
    developmentCost: Math.round(project.spent),
    marketingSpend: actualMarketing,
    revenue: 0,
    grossRevenue: 0,
    unitsSold: 0,
    openingUnits,
    price,
    teamHeadcount: team.length,
    credits: team.map((e) => ({
      employeeId: e.id,
      name: e.name,
      role: e.role,
      skill: Math.round(QUALITY_DIMENSIONS.reduce((acc, dim) => acc + e.skills[dim], 0) / QUALITY_DIMENSIONS.length),
    })),
    developmentDays: project.daysInDevelopment + project.daysInPolish,
    quality: { ...project.quality },
    bugsAtRelease: Math.round(project.bugs),
    completeness: clamp(project.progress, 0, 1),
    reviewScore: outcome.score,
    reviews: outcome.reviews,
    reception: outcome.reception,
    sales: [],
    weeksOnSale: 0,
    peakWeeklyUnits: 0,
    status: 'selling',
    roi: 0,
    reputationDelta: 0,
    legacy: 0,
  };

  state.releases[id] = game;
  studio.releaseIds.push(id);
  studio.projectIds = studio.projectIds.filter((pid) => pid !== project.id);
  project.status = 'released';
  project.releasedReleaseId = id;
  // Release the team: they are no longer assigned, so nothing dangles if they later leave.
  project.teamIds = [];

  // Everyone who shipped feels it, then moves on to the next thing.
  const qualityDelta = outcome.score - 60;
  for (const emp of team) {
    emp.gamesShipped += 1;
    emp.bestReviewScore = Math.max(emp.bestReviewScore, outcome.score);
    emp.morale = clamp(emp.morale + shipmentMoraleDelta(outcome.score), 0, 100);
  }

  const reputationDelta = applyReleaseReputation(studio, outcome.score, project, projectedUnits, audienceM, price);
  game.reputationDelta = adjustReputation(studio, reputationDelta);

  // Market consequences: a great release cools demand and heats the genre; a bad one sours it.
  if (marketGenre) {
    const drained = demandConsumed(projectedUnits, audienceM, genre.audienceShare);
    marketGenre.demand = clamp(marketGenre.demand - drained, BALANCE.market.demandMin, BALANCE.market.demandMax);
    if (outcome.score >= BALANCE.market.hitThresholdScore) {
      marketGenre.popularity = clamp(marketGenre.popularity + BALANCE.market.hitPopularityGain, BALANCE.market.popularityMin, 100);
      marketGenre.fatigue = clamp(marketGenre.fatigue - 4, 0, 40);
    } else if (outcome.score <= BALANCE.market.flopThresholdScore) {
      marketGenre.popularity = clamp(marketGenre.popularity - BALANCE.market.flopPopularityLoss, BALANCE.market.popularityMin, 100);
    }
  }

  // Studio competence in the genre improves with success.
  const strengthGain = clamp((outcome.score - 45) / 260, -0.02, 0.06);
  studio.genreStrength[project.genreId] = clamp((studio.genreStrength[project.genreId] ?? 0) + strengthGain, 0, 1);
  studio.lastReleaseTick = cal.tick;
  studio.lastReleaseReview = outcome.score;
  studio.finances.lifetime.gamesReleased += 1;
  if (qualityDelta < -10) studio.consecutiveLosses += 1;
  else if (qualityDelta > 8) studio.consecutiveLosses = 0;

  const top = outcome.reviews[0];
  const bottom = outcome.reviews[outcome.reviews.length - 1];
  emit(state, {
    category: 'release',
    tone: qualityDelta >= 0 ? 'positive' : 'negative',
    studioIds: [studio.id],
    title: `${studio.name} released "${game.title}"`,
    detail: `${genre.name} on ${platform.name} · ${project.progress < 1 ? 'shipped incomplete; ' : ''}consensus ${outcome.score} (${top?.score ?? '-'} ${top?.publication ?? ''}${bottom && bottom !== top ? `, ${bottom.score} ${bottom.publication}` : ''})`,
  });

  emit(state, {
    category: 'review',
    tone: 'neutral',
    studioIds: [studio.id],
    title: `"${game.title}" reception: ${outcome.reception.headline}`,
    detail: outcome.reviews.map((r) => `${r.publication} ${r.score}`).join(' · '),
  });

  state.stats.gamesReleasedTotal += 1;
  if (studio.isPlayer) state.stats.gamesReleasedByPlayer += 1;

  // Keep the "game everyone is talking about" pointer fresh.
  if (outcome.score >= BALANCE.market.hitThresholdScore && projectedUnits > 120000) {
    state.market.talkingAboutReleaseId = id;
    state.market.talkingAboutLabel = `${game.title} (${game.studioName})`;
  }

  return {
    game,
    reviewScore: outcome.score,
    receptionScore: outcome.reception.score,
    reputationDelta,
    projectedUnits,
  };
}

/**
 * Reputation move from a release: driven by the review score, how it compared to what
 * people expected of this studio, and how the game actually sold relative to its scope.
 */
function applyReleaseReputation(
  studio: { reputation: number },
  score: number,
  project: Project,
  projectedUnits: number,
  audienceM: number,
  price: number,
): number {
  const scope = scopeDef(project.scope);
  // Reviews dominate; a shockingly good commercial result on a small game adds a bonus.
  // Famous studios gain name slowly and lose it fast-ish; nobody rides to 100 in two games.
  const saturation = clamp(1 - studio.reputation / 135, 0.16, 1);
  const criticDelta = (score - 60) * BALANCE.studio.repPerReviewPoint * (0.55 + 0.45 * scope.repMult) * (score >= 60 ? saturation : 1.05);
  const share = audienceM > 0 ? projectedUnits / (audienceM * 1_000_000) : 0;
  const expectation = 0.01 + (price > 30 ? 0.01 : 0);
  const commercial = clamp((share - expectation) * 26, -1.5, 2.6) * (share >= expectation ? saturation : 1);
  return Math.round((criticDelta + commercial) * 10) / 10;
}

/** Opening-week units, exposed so tests can assert the release maths without a full tick. */
export function openingUnitsFor(input: SalesInput): number {
  return openingUnits(input);
}
