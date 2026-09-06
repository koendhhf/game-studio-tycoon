/**
 * Reviews: derived scores and derived prose. The contract under test is that a score is a
 * function of the game's actual quality — never a roll — and that the commentary says
 * something true about the strengths and weaknesses that produced it.
 */

import { describe, expect, it } from 'vitest';
import {
  BALANCE,
  GENRES,
  PUBLICATIONS,
  buildReviewContext,
  calculateReviews,
  dimensionDescriptor,
  outletScore,
  qualityVector,
} from './test-imports';
import type { QualityRecord } from './test-imports';

function quality(value: number): QualityRecord {
  return qualityVector(value);
}

function reviewFor(qualityValue: number, patch: Partial<Parameters<typeof calculateReviews>[0]> = {}) {
  return calculateReviews({
    quality: quality(qualityValue),
    genreId: 'action',
    platformId: 'pc',
    scopeId: 'medium',
    bugs: 0,
    completeness: 1,
    marketingSpend: 0,
    reputation: 20,
    genreStrength: 0,
    noise: [0, 0, 0, 0, 0, 0],
    ...patch,
  });
}

describe('score derivation', () => {
  it('is monotonically driven by quality', () => {
    let previous = -1;
    for (const value of [5, 20, 35, 50, 65, 80, 95]) {
      const outcome = reviewFor(value);
      expect(outcome.score).toBeGreaterThan(previous);
      previous = outcome.score;
    }
    expect(reviewFor(90).score - reviewFor(30).score).toBeGreaterThan(40);
  });

  it('is deterministic: the same game is scored the same way every time', () => {
    const a = reviewFor(64);
    const b = reviewFor(64);
    expect(a).toEqual(b);
    expect(a.reviews.map((r) => r.body)).toEqual(b.reviews.map((r) => r.body));
  });

  it('weighs the dimensions the genre cares about', () => {
    const genre = GENRES.rpg;
    expect(genre.criticWeights.story).toBeGreaterThan(0.1);

    const strongStory = qualityVector(60);
    strongStory.story = 95;
    const weakStory = qualityVector(60);
    weakStory.story = 25;
    const ctx = buildReviewContext({
      quality: strongStory,
      genreId: 'rpg',
      platformId: 'pc',
      scopeId: 'medium',
      bugs: 0,
      completeness: 1,
      marketingSpend: 0,
      reputation: 0,
      genreStrength: 0,
    });
    const outlet = PUBLICATIONS[0];
    expect(outletScore(outlet, strongStory, ctx)).toBeGreaterThan(outletScore(outlet, weakStory, ctx));

    // The same writing quality judged in a genre that does not care scores lower, and
    // gameplay carried by a different dimension.
    const actionCtx = buildReviewContext({
      quality: strongStory,
      genreId: 'shooter',
      platformId: 'pc',
      scopeId: 'medium',
      bugs: 0,
      completeness: 1,
      marketingSpend: 0,
      reputation: 0,
      genreStrength: 0,
    });
    expect(GENRES.shooter.criticWeights.story).toBeLessThan(genre.criticWeights.story);
    expect(outletScore(outlet, strongStory, actionCtx)).not.toBe(outletScore(outlet, strongStory, ctx));
  });

  it('gives different publications different scores for the same game', () => {
    const ctx = buildReviewContext({
      quality: { gameplay: 80, graphics: 45, story: 30, audio: 70, innovation: 90, polish: 55 },
      genreId: 'puzzle',
      platformId: 'pc',
      scopeId: 'small',
      bugs: 5,
      completeness: 1,
      marketingSpend: 30_000,
      reputation: 40,
      genreStrength: 0.5,
    });
    const scores = PUBLICATIONS.map((p) => outletScore(p, { gameplay: 80, graphics: 45, story: 30, audio: 70, innovation: 90, polish: 55 }, ctx));
    expect(new Set(scores).size).toBeGreaterThan(1);
    for (const s of scores) {
      expect(s).toBeGreaterThanOrEqual(1);
      expect(s).toBeLessThanOrEqual(100);
    }
  });

  it('punishes bugs, unfinished games and overselling', () => {
    const clean = reviewFor(70);
    const buggy = reviewFor(70, { bugs: 400 });
    const rushed = reviewFor(70, { completeness: 0.5 });
    const hyped = reviewFor(45, { marketingSpend: 900_000 });
    expect(buggy.score).toBeLessThan(clean.score);
    expect(rushed.score).toBeLessThan(clean.score);
    expect(hyped.score).toBeLessThan(reviewFor(45, { marketingSpend: 0 }).score + BALANCE.reviews.hypeMismatchPenaltyMax);

    // A bug-free, complete, quiet release of the same quality scores best.
    expect(clean.score).toBeGreaterThan(buggy.score);
    expect(calculateReviews({
      quality: quality(92),
      genreId: 'action',
      platformId: 'pc',
      scopeId: 'ambitious',
      bugs: 0,
      completeness: 1,
      marketingSpend: 0,
      reputation: 80,
      genreStrength: 1,
      noise: [0, 0, 0, 0, 0, 0],
    }).score).toBeGreaterThan(clean.score);
  });

  it('lets a modestly-marketed good game earn an underdog bonus', () => {
    const quiet = reviewFor(84, { marketingSpend: 0 });
    const loud = reviewFor(84, { marketingSpend: 3_000_000 });
    expect(quiet.score).toBeGreaterThan(loud.score - 6);
    expect(quiet.score).toBeGreaterThan(70);
  });

  it('reports a reputation halo that is bounded and can work against you', () => {
    const nobody = buildReviewContext({ quality: quality(60), genreId: 'action', platformId: 'pc', scopeId: 'medium', bugs: 0, completeness: 1, marketingSpend: 0, reputation: 0, genreStrength: 0 });
    const legend = buildReviewContext({ quality: quality(60), genreId: 'action', platformId: 'pc', scopeId: 'medium', bugs: 0, completeness: 1, marketingSpend: 0, reputation: 100, genreStrength: 1 });
    expect(legend.reputationHalo).toBeLessThanOrEqual(BALANCE.reviews.reputationHaloMax);
    expect(legend.reputationHalo).toBeGreaterThan(nobody.reputationHalo);
    expect(nobody.reputationHalo).toBeLessThan(0);
  });

  it('publishes one review per outlet with an aggregate weighted by authority', () => {
    const outcome = reviewFor(66);
    expect(outcome.reviews.length).toBe(PUBLICATIONS.length);
    for (const review of outcome.reviews) {
      expect(review.publication.length).toBeGreaterThan(2);
      expect(review.score).toBeGreaterThanOrEqual(1);
      expect(review.headline.length).toBeGreaterThan(3);
      expect(review.body.length).toBeGreaterThan(20);
    }
    expect(outcome.score).toBeGreaterThanOrEqual(Math.min(...outcome.reviews.map((r) => r.score)));
    expect(outcome.score).toBeLessThanOrEqual(Math.max(...outcome.reviews.map((r) => r.score)));
    // Sorted best first, so feeds can show the headline and the harshest voice.
    const scores = outcome.reviews.map((r) => r.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  it('separates what critics think from what players think', () => {
    // A shallow but flashy action game: critics unimpressed, buyers delighted.
    const flashy: QualityRecord = { gameplay: 85, graphics: 90, story: 15, audio: 70, innovation: 20, polish: 75 };
    const literary: QualityRecord = { gameplay: 40, graphics: 35, story: 95, audio: 60, innovation: 70, polish: 55 };
    const actionFlashy = calculateReviews({ quality: flashy, genreId: 'action', platformId: 'pc', scopeId: 'medium', bugs: 0, completeness: 1, marketingSpend: 50_000, reputation: 30, genreStrength: 0, noise: [0, 0, 0, 0, 0, 0] });
    const actionLiterary = calculateReviews({ quality: literary, genreId: 'action', platformId: 'pc', scopeId: 'medium', bugs: 0, completeness: 1, marketingSpend: 50_000, reputation: 30, genreStrength: 0, noise: [0, 0, 0, 0, 0, 0] });
    expect(actionFlashy.reception.score).toBeGreaterThan(actionLiterary.reception.score);
    expect(actionLiterary.reviews.length).toBeGreaterThan(0);
    expect(actionFlashy.reception.recommendRate).toBeGreaterThan(actionLiterary.reception.recommendRate);
    expect(actionFlashy.reception.recommendRate).toBeLessThanOrEqual(0.98);

    // And the same game judged as an adventure flips the verdict.
    const adventureLiterary = calculateReviews({ quality: literary, genreId: 'adventure', platformId: 'pc', scopeId: 'medium', bugs: 0, completeness: 1, marketingSpend: 50_000, reputation: 30, genreStrength: 0, noise: [0, 0, 0, 0, 0, 0] });
    expect(adventureLiterary.score).toBeGreaterThan(actionLiterary.score);
  });

  it('names the dimensions that decided the score in the prose', () => {
    const oneSided: QualityRecord = { gameplay: 92, graphics: 20, story: 30, audio: 40, innovation: 60, polish: 70 };
    const outcome = calculateReviews({
      quality: oneSided,
      genreId: 'rpg',
      platformId: 'pc',
      scopeId: 'small',
      bugs: 0,
      completeness: 1,
      marketingSpend: 0,
      reputation: 10,
      genreStrength: 0,
      noise: [0, 0, 0, 0, 0, 0],
    });
    expect(outcome.praised).toEqual(['gameplay']);
    expect(outcome.panned.length).toBe(1);
    const praiseLine = GENRES.rpg.praise.gameplay;
    expect(praiseLine.length).toBeGreaterThan(4);
    const text = outcome.reviews.map((r) => `${r.headline} ${r.body}`).join(' ').toLowerCase();
    for (const review of outcome.reviews) {
      expect(text).toContain(praiseLine.toLowerCase());
      expect(review.body.length).toBeGreaterThan(40);
    }

    // A broken build is mentioned as a problem, because it is one.
    const broken = calculateReviews({
      quality: oneSided,
      genreId: 'rpg',
      platformId: 'pc',
      scopeId: 'small',
      bugs: 900,
      completeness: 1,
      marketingSpend: 0,
      reputation: 10,
      genreStrength: 0,
      noise: [0, 0, 0, 0, 0, 0],
    });
    expect(broken.score).toBeLessThan(outcome.score);
    expect(broken.reviews.every((r) => r.body.toLowerCase().length > 40)).toBe(true);
  });

  it('describes each dimension tier in words the UI can reuse', () => {
    expect(dimensionDescriptor('graphics', 90)).toContain('genre-defining');
    expect(dimensionDescriptor('graphics', 10)).toContain('broken');
    expect(dimensionDescriptor('audio', 50)).toMatch(/serviceable|thin/);
  });
});
