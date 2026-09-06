/**
 * Review model.
 *
 * Press scores are *derived*, never rolled: each publication weighs the game's six
 * quality dimensions through its own bias, then completeness, bugs, platform pressure,
 * hype and the studio's name nudge the result. The only stochastic term is the small,
 * bounded per-publication taste jitter the caller supplies (`noise`), so the same release
 * is always scored the same way and a save replays identically.
 *
 * Commentary is selected from the dimensions that actually carried or sank the score, so
 * a review says something true about the game rather than something random.
 */

import { QUALITY_DIMENSIONS, type GenreId, type PlatformId, type QualityDimensionId, type ScopeId } from '../core/types';
import { GENRES, weightedQuality } from '../data/genres';
import { platformDef } from '../data/platforms';
import { PUBLICATIONS, type PublicationDef } from '../data/publications';
import { scopeDef } from '../data/scopes';
import { bugSeverity } from './development-model';
import { BALANCE } from '../data/balance';
import { clamp } from '../core/math';
import { Rng, createRngState, mixInts } from '../core/rng';
import type { PlayerReception, ReviewRecord } from '../entities/game';

export type QualityRecord = Record<QualityDimensionId, number>;

/** All six dimensions at one value — the shape tests and planners keep needing. */
export function qualityVector(value: number): QualityRecord {
  const out = {} as QualityRecord;
  for (const dim of QUALITY_DIMENSIONS) out[dim] = value;
  return out;
}

export interface ReviewInput {
  /** The game's actual quality, as reached at ship time. */
  quality: QualityRecord;
  genreId: GenreId;
  platformId: PlatformId;
  scopeId: ScopeId;
  /** Open bug backlog at release. */
  bugs: number;
  /** 0..1 — how much of the design was finished. */
  completeness: number;
  marketingSpend: number;
  reputation: number;
  /** 0..1 — how well this studio is known for this genre. */
  genreStrength: number;
  /** Deterministic per-publication jitter, ±BALANCE.reviews.noise. */
  noise?: readonly number[];
}

export interface ReviewOutcome {
  /** Authority-weighted critic consensus. */
  score: number;
  /** Per-publication reviews, best first. */
  reviews: ReviewRecord[];
  /** How the buyers themselves reacted. */
  reception: PlayerReception;
  /** Which dimensions the press singled out, for the UI and for tests. */
  praised: QualityDimensionId[];
  panned: QualityDimensionId[];
}

/** Adjustments every outlet agrees on, computed once per release. */
export interface ReviewContext {
  readonly genreId: GenreId;
  readonly platformId: PlatformId;
  readonly scopeId: ScopeId;
  readonly bugPenalty: number;
  readonly completeness: number;
  readonly hype: number;
  readonly overclaim: number;
  readonly reputationHalo: number;
  readonly genreStrengthBonus: number;
  readonly riskPenalty: number;
  readonly innovationBonus: number;
}

/** Everything but the outlet's own weighting and jitter. Exported for the planner. */
export function buildReviewContext(input: ReviewInput): ReviewContext {
  const genre = GENRES[input.genreId];
  const scope = scopeDef(input.scopeId);
  const qualityWeighted = weightedQuality(input.quality, genre.criticWeights);
  const expected = clamp(38 + scope.expectationMult * 14, 30, 80);

  const recommended = recommendedMarketingFor(input.scopeId, input.platformId, input.reputation);
  const hype = clamp(input.marketingSpend / Math.max(1, recommended), 0, 2);
  // Loud ads for a mediocre game are punished; a quiet gem is rewarded.
  const overclaim = clamp(hype - qualityWeighted / Math.max(1, expected), -1.2, 1.6);

  const rawBugs = bugSeverity(input.bugs, input.scopeId);

  return {
    genreId: input.genreId,
    platformId: input.platformId,
    scopeId: input.scopeId,
    bugPenalty: rawBugs,
    completeness: clamp(input.completeness, 0, 1),
    hype,
    overclaim,
    reputationHalo: clamp((input.reputation - 40) / 22, -1, 1) * BALANCE.reviews.reputationHaloMax,
    genreStrengthBonus: clamp(input.genreStrength, 0, 1) * 3,
    riskPenalty:
      Math.max(0, input.quality.innovation - input.quality.polish) > 18
        ? clamp((input.quality.innovation - input.quality.polish - 18) / 45, 0, 1) * BALANCE.reviews.riskPenaltyMax
        : 0,
    innovationBonus:
      input.quality.innovation > BALANCE.reviews.innovationFloor
        ? clamp((input.quality.innovation - BALANCE.reviews.innovationFloor) / 40, 0, 1) * BALANCE.reviews.innovationBonusMax
        : 0,
  };
}

/**
 * The score one publication gives. Both the release pass and the pre-release planner call
 * this, so a projected review score on the Create Game screen cannot drift from reality.
 *
 * `BALANCE.reviews.qualityWeight` is the share of the score the game itself owns: 78% is
 * the weighted quality of the six dimensions, 22% is everything around it (a big name, a
 * well-run campaign, a studio known for this genre, a risky design). Bugs, unfinished
 * halves and oversold marketing come off the total, because they hurt a game no matter how
 * good its ideas were.
 */
export function outletScore(outlet: PublicationDef, quality: QualityRecord, ctx: ReviewContext, jitter = 0): number {
  const genre = GENRES[ctx.genreId];
  const platform = platformDef(ctx.platformId);

  // The outlet's own priorities, layered on the genre's: a technical magazine weights
  // graphics and polish harder, a narrative one weights story.
  const combined: QualityRecord = { ...quality };
  for (const dim of QUALITY_DIMENSIONS) combined[dim] = (genre.criticWeights[dim] ?? 0) * (outlet.bias[dim] ?? 1);

  const base = weightedQuality(quality, combined);
  // A machine that cannot show this genre off pulls visual-heavy scores down, and lets a
  // charming little 8-bit thing keep its own scale.
  const adjusted = clamp(base + (platform.graphicsPressure - 1) * (quality.graphics - base) * 0.35, 0, 100);

  const context =
    50 +
    ctx.reputationHalo +
    (ctx.genreStrengthBonus - 1) +
    ctx.innovationBonus * 0.5 -
    ctx.riskPenalty * 0.5 +
    clamp((ctx.hype - 0.6) * 2, 0, 3) +
    outlet.skew +
    jitter;

  let score = adjusted * BALANCE.reviews.qualityWeight + context * (1 - BALANCE.reviews.qualityWeight);
  score -= Math.min(BALANCE.reviews.bugPenaltyMax, ctx.bugPenalty * 14 * (outlet.bias.bugs ?? 1));
  if (ctx.overclaim > 0) score -= ctx.overclaim * BALANCE.reviews.hypeMismatchPenaltyMax;
  else if (base >= 70) score += BALANCE.reviews.underpromiseBonus * clamp(-ctx.overclaim, 0, 1);
  if (ctx.completeness < 1) score -= (1 - ctx.completeness) * 20;

  return clamp(Math.round(score), 1, 100);
}

/** Compute the review set for a release from the game's actual final quality. */
export function calculateReviews(input: ReviewInput, outlets: readonly PublicationDef[] = PUBLICATIONS): ReviewOutcome {
  const ctx = buildReviewContext(input);
  const genre = GENRES[input.genreId];
  const rng = new Rng(createRngState(mixInts(Math.round(sum(input.quality) * 64), hash3(input.genreId), hash3(input.platformId), Math.round(input.bugs), Math.round(input.marketingSpend / 500))));
  const noise = input.noise ?? [];

  const scored = outlets.map((outlet, i) => ({
    outlet,
    score: outletScore(outlet, input.quality, ctx, noise[i] ?? 0),
  }));
  scored.sort((a, b) => b.score - a.score || b.outlet.authority - a.outlet.authority);

  let weight = 0;
  let acc = 0;
  const reviews: ReviewRecord[] = scored.map(({ outlet, score }) => {
    weight += outlet.authority;
    acc += score * outlet.authority;
    const review = reviewText(rng, outlet, input, ctx, score);
    return { publicationId: outlet.id, publication: outlet.name, score, headline: review.headline, body: review.body };
  });

  const consensus = weight > 0 ? Math.round(acc / weight) : 50;
  const audience = weightedQuality(input.quality, genre.audienceWeights);
  // Players judge the game itself: how well it hits what this genre's buyers want, minus
  // what they had to put up with. No free points for a loud ad campaign.
  const receptionScore = clamp(
    Math.round(
      audience * ctx.completeness +
        (ctx.completeness >= 1 ? 0 : -6) -
        ctx.bugPenalty * 11 -
        Math.max(0, ctx.overclaim) * 7 +
        ctx.genreStrengthBonus * 0.4,
    ),
    1,
    100,
  );

  const ranking = QUALITY_DIMENSIONS.map((dim) => ({ dim, value: input.quality[dim] * (genre.audienceWeights[dim] ?? 0) })).sort((a, b) => b.value - a.value);
  const notes = [
    `${genre.name} buyers rated it ${receptionScore >= audience ? 'above' : 'below'} what the critics heard.`,
    `Strongest for players: ${QUALITY_LABEL[ranking[0].dim]} · weakest: ${QUALITY_LABEL[ranking[ranking.length - 1].dim]}.`,
  ];
  if (input.bugs > scopeDef(input.scopeId).workUnits * 0.12) notes.push('Refund chatter about bugs and crashes.');
  if (ctx.completeness < 0.95) notes.push('Players noticed the game ends early for what it promised.');
  if (ctx.overclaim < -0.4 && consensus >= 70) notes.push('Word of mouth is carrying it: “underrated” is the recurring word.');

  return {
    score: consensus,
    reviews,
    praised: pickDims(input.quality, genre.criticWeights, 1, true),
    panned: pickDims(input.quality, genre.criticWeights, 1, false),
    reception: {
      score: receptionScore,
      headline: receptionHeadline(receptionScore),
      notes,
      recommendRate: clamp((receptionScore - 22) / 78, 0.02, 0.98),
    },
  };
}

/** Marketing that this scope can actually convert, given the platform and the studio's name. */
export function recommendedMarketingFor(scopeId: ScopeId, platformId: PlatformId, reputation: number): number {
  const scope = scopeDef(scopeId);
  const platform = platformDef(platformId);
  const reach = clamp(0.72 + clamp(reputation, 0, 100) / 240, 0.72, 1.14);
  return Math.round(scope.marketingBase * reach * (platform.kind === 'digital' ? 0.72 : 1));
}

/** Human-readable verdict for one dimension — used by the UI's quality readouts. */
export function dimensionDescriptor(dim: QualityDimensionId, value: number): string {
  const tier =
    value >= 88 ? 'genre-defining' : value >= 76 ? 'excellent' : value >= 62 ? 'strong' : value >= 48 ? 'serviceable' : value >= 34 ? 'thin' : value >= 20 ? 'weak' : 'broken';
  return `${tier} ${QUALITY_LABEL[dim]}`;
}

const QUALITY_LABEL: Record<QualityDimensionId, string> = {
  gameplay: 'gameplay',
  graphics: 'presentation',
  story: 'writing',
  audio: 'sound',
  innovation: 'originality',
  polish: 'finishing',
};

// ---------------------------------------------------------------------------
// Commentary generation
// ---------------------------------------------------------------------------

function reviewText(rng: Rng, outlet: PublicationDef, input: ReviewInput, ctx: ReviewContext, score: number): { headline: string; body: string } {
  const genre = GENRES[input.genreId];
  const ranked = QUALITY_DIMENSIONS.map((dim) => ({ dim, value: input.quality[dim] * (genre.criticWeights[dim] ?? 0) })).sort((a, b) => b.value - a.value);
  const bestDim = ranked[0].dim;
  const worstDim = ranked[ranked.length - 1].dim;
  const parts: string[] = [];

  const praise = genre.praise[bestDim] || `${bestDim} is in great shape`;
  const critique = genre.critique[worstDim] || `${worstDim} needs work`;

  if (score >= 88) parts.push(rng.pick(['The best in its genre this year.', 'A new high-water mark.', 'Everything a fan of the genre wanted.']));
  else if (score >= 74) parts.push(rng.pick(['Easily recommended.', 'Confident, well-made and a lot of fun.', 'Worth full price on day one.']));
  else if (score >= 60) parts.push(rng.pick(['A solid, unspectacular release.', 'Good bones, soft middle.', 'Fine, if a little safe.']));
  else if (score >= 45) parts.push(rng.pick(['Hard to recommend at full price.', 'Ambition it cannot quite cash.', 'Waits for a sale.']));
  else parts.push(rng.pick(['A slog.', 'Misses more than it hits.', 'Hard to finish.']));

  parts.push(`Its strength is ${praise}`);
  if (input.quality[worstDim] < 45) parts.push(`and it is held back by ${critique}`);
  else if (score >= 72) parts.push('— and even its weakest area holds up.');
  else parts.push(`, while ${critique}`);

  if (ctx.bugPenalty > 0.9) parts.push(rng.pick(['It also crashes far too often.', 'The bug list is impossible to ignore.', 'Unpatched at launch, and it shows.']));
  else if (ctx.bugPenalty > 0.4) parts.push('A patch will fix what still snags.');
  if (ctx.completeness < 0.9) parts.push('It stops abruptly, well short of finished.');
  if (input.quality.innovation > 76) parts.push(rng.pick(['It dares to be strange.', 'Ideas here that nobody else is trying.']));
  else if (input.quality.innovation < 30 && score < 62) parts.push('It never tries anything it has not seen before.');
  if (ctx.overclaim > 0.45) parts.push('The campaign wrote cheques this game cannot cash.');
  if (input.quality.polish > 84 && ctx.bugPenalty < 0.3) parts.push('It runs like clockwork.');

  const body = parts.filter(Boolean).join(' ').replace(/\s+([,.])/g, '$1');
  return { headline: headlineFor(rng, score, genre.name), body: `${outlet.blurb.split('.')[0]}: ${body.charAt(0).toUpperCase()}${body.slice(1)}.` };
}

function headlineFor(rng: Rng, score: number, genreName: string): string {
  if (score >= 88) return rng.pick([`${genreName} royalty`, 'Instant classic', 'Category winner', 'A must-play']);
  if (score >= 74) return rng.pick(['Very good', 'Highly recommended', 'Big entry', 'Clear winner']);
  if (score >= 60) return rng.pick(['A good time', 'Worth a look', 'Solid', 'Nearly there']);
  if (score >= 45) return rng.pick(['Mixed feelings', 'Uneven', 'On the fence', 'Nearly, but no']);
  return rng.pick(['Disappointing', 'Misses', 'A hard sell', 'Undercooked']);
}

function receptionHeadline(reception: number): string {
  if (reception >= 85) return 'the players love it';
  if (reception >= 70) return 'players approve';
  if (reception >= 55) return 'players are broadly happy';
  if (reception >= 40) return 'players are split';
  if (reception >= 25) return 'players are lukewarm';
  return 'players turned away';
}

function pickDims(quality: QualityRecord, weights: QualityRecord, count: number, best: boolean): QualityDimensionId[] {
  const ranked = QUALITY_DIMENSIONS.map((dim) => ({ dim, value: (quality[dim] ?? 0) * (weights[dim] ?? 0) })).sort((a, b) => (best ? b.value - a.value : a.value - b.value));
  return ranked.slice(0, count).map((r) => r.dim);
}

function sum(values: QualityRecord): number {
  let total = 0;
  for (const dim of QUALITY_DIMENSIONS) total += values[dim] ?? 0;
  return total;
}

function hash3(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
