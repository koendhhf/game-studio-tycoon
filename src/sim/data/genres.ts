/**
 * Genre definitions. A genre decides what "good" means: critic weights, what the
 * paying audience cares about, which roles are essential, and its market profile.
 * Genre *state* (popularity/demand/competition) lives in the market system.
 */

import type { GenreId, QualityDimensionId, RoleId } from '../core/types';
import { QUALITY_DIMENSIONS } from '../core/types';

export interface GenreDef {
  id: GenreId;
  name: string;
  blurb: string;
  /** Critic weighting per quality dimension (normalized at use). */
  criticWeights: Record<QualityDimensionId, number>;
  /** Buyer weighting per quality dimension — what sells versus what wins scores. */
  audienceWeights: Record<QualityDimensionId, number>;
  /** Roles whose absence hurts the quality ceiling. */
  essentialRoles: RoleId[];
  /** Popularity the genre starts the game with. */
  basePopularity: number;
  /** How volatile the genre is: multiplier on monthly drift. */
  volatility: number;
  /** Share of the audience that buys this genre at neutral popularity. */
  audienceShare: number;
  /** Relative price tolerance (0.9 = cheap goods, 1.15 = premium). */
  priceMult: number;
  /** Multiplier on bugs produced: systems-heavy genres are buggier. */
  bugMult: number;
  /** Multiplier on how much scope is needed to satisfy expectations. */
  expectationMult: number;
  /** Words used by the review generator for a strong dimension. */
  praise: Record<QualityDimensionId, string>;
  /** Words used by the review generator for a weak dimension. */
  critique: Record<QualityDimensionId, string>;
}

function weights(partial: Partial<Record<QualityDimensionId, number>>): Record<QualityDimensionId, number> {
  const out = { gameplay: 0, graphics: 0, story: 0, audio: 0, innovation: 0, polish: 0 };
  for (const dim of QUALITY_DIMENSIONS) out[dim] = partial[dim] ?? 0;
  return out;
}

function phrases(partial: Partial<Record<QualityDimensionId, string>>): Record<QualityDimensionId, string> {
  const out = { gameplay: '', graphics: '', story: '', audio: '', innovation: '', polish: '' };
  for (const dim of QUALITY_DIMENSIONS) out[dim] = partial[dim] ?? '';
  return out;
}

export const GENRES: Record<GenreId, GenreDef> = {
  action: {
    id: 'action',
    name: 'Action',
    blurb: 'Fast, visceral, control-heavy. Judged on feel and spectacle.',
    criticWeights: weights({ gameplay: 0.34, graphics: 0.22, audio: 0.12, innovation: 0.14, polish: 0.18 }),
    audienceWeights: weights({ gameplay: 0.36, graphics: 0.28, audio: 0.12, innovation: 0.1, polish: 0.14 }),
    essentialRoles: ['programmer', 'artist'],
    basePopularity: 70,
    volatility: 1.1,
    audienceShare: 0.2,
    priceMult: 1.05,
    bugMult: 1.05,
    expectationMult: 1.0,
    praise: phrases({
      gameplay: 'the moment-to-moment combat is superbly judged',
      graphics: 'it looks genuinely next-generation',
      audio: 'the soundtrack pushes you through every set piece',
      polish: 'it runs like a dream with no meaningful complaints',
    }),
    critique: phrases({
      gameplay: 'the controls fight you more than the enemies do',
      graphics: 'the visuals are muddy and indistinct',
      polish: 'frame drops and glitches undercut the spectacle',
      story: 'the plot is an excuse to load the next arena',
    }),
  },
  rpg: {
    id: 'rpg',
    name: 'RPG',
    blurb: 'Systems, growth and world. Tolerates rough edges if the depth is there.',
    criticWeights: weights({ gameplay: 0.28, story: 0.24, graphics: 0.12, audio: 0.1, innovation: 0.14, polish: 0.12 }),
    audienceWeights: weights({ gameplay: 0.3, story: 0.3, graphics: 0.14, audio: 0.08, polish: 0.1 }),
    essentialRoles: ['designer', 'writer'],
    basePopularity: 62,
    volatility: 0.85,
    audienceShare: 0.15,
    priceMult: 1.15,
    bugMult: 1.3,
    expectationMult: 1.35,
    praise: phrases({
      gameplay: 'the progression systems reward curiosity for dozens of hours',
      story: 'the writing gives you people worth caring about',
      innovation: 'it bends the genre in ways you have not seen before',
      audio: 'the score makes the world feel lived-in',
    }),
    critique: phrases({
      gameplay: 'the loots do not add up to a compelling loop',
      story: 'the dialogue is filler, delivered by filler',
      polish: 'game-breaking bugs make late saves a gamble',
      graphics: 'the worlds are big but blank',
    }),
  },
  strategy: {
    id: 'strategy',
    name: 'Strategy',
    blurb: 'Elegant rules, honest AI, readable interface.',
    criticWeights: weights({ gameplay: 0.44, innovation: 0.16, polish: 0.18, graphics: 0.06, story: 0.08, audio: 0.08 }),
    audienceWeights: weights({ gameplay: 0.46, polish: 0.18, graphics: 0.1, innovation: 0.16, audio: 0.1 }),
    essentialRoles: ['designer', 'programmer'],
    basePopularity: 54,
    volatility: 0.7,
    audienceShare: 0.13,
    priceMult: 1.1,
    bugMult: 1.25,
    expectationMult: 1.15,
    praise: phrases({
      gameplay: 'every decision carries weight and every counter carries an answer',
      polish: 'the interface finally gets out of the way',
      innovation: 'its systems interact in ways that surprise even veterans',
    }),
    critique: phrases({
      gameplay: 'the AI cheats rather than thinks',
      polish: 'the UI buries critical information three menus deep',
      graphics: 'the board is unreadable at a glance',
    }),
  },
  simulation: {
    id: 'simulation',
    name: 'Simulation',
    blurb: 'Systems that behave. Depth over drama.',
    criticWeights: weights({ gameplay: 0.36, polish: 0.2, innovation: 0.16, graphics: 0.1, audio: 0.08, story: 0.1 }),
    audienceWeights: weights({ gameplay: 0.38, polish: 0.2, graphics: 0.12, innovation: 0.14, audio: 0.08 }),
    essentialRoles: ['programmer', 'designer'],
    basePopularity: 48,
    volatility: 0.6,
    audienceShare: 0.11,
    priceMult: 1.0,
    bugMult: 1.35,
    expectationMult: 1.05,
    praise: phrases({
      gameplay: 'the model holds together beautifully once it clicks',
      innovation: 'it simulates something nobody has dared simulate',
      polish: 'it is unusually, blessedly stable for a game this ambitious',
    }),
    critique: phrases({
      gameplay: 'the spreadsheet never becomes a game',
      graphics: 'the presentation is a wall of identical text',
      story: 'there is nothing to care about, only numbers to tidy',
    }),
  },
  adventure: {
    id: 'adventure',
    name: 'Adventure',
    blurb: 'Place, puzzle and pacing. Story is the product.',
    criticWeights: weights({ story: 0.34, graphics: 0.16, audio: 0.14, gameplay: 0.16, polish: 0.1, innovation: 0.1 }),
    audienceWeights: weights({ story: 0.36, graphics: 0.22, audio: 0.12, gameplay: 0.18, polish: 0.1 }),
    essentialRoles: ['writer', 'artist'],
    basePopularity: 52,
    volatility: 0.8,
    audienceShare: 0.12,
    priceMult: 0.95,
    bugMult: 0.9,
    expectationMult: 0.95,
    praise: phrases({
      story: 'the writing is confident, funny and genuinely moving',
      graphics: 'every frame is worth staring at',
      audio: 'the voice work sells every scene',
    }),
    critique: phrases({
      story: 'the mystery never earns its own epilogue',
      gameplay: 'the puzzles are really just locked doors',
      audio: 'the delivery is wooden from end to end',
    }),
  },
  sports: {
    id: 'sports',
    name: 'Sports',
    blurb: 'Licence-free athletics: presentation and authenticity.',
    criticWeights: weights({ gameplay: 0.32, graphics: 0.24, polish: 0.2, audio: 0.12, innovation: 0.06, story: 0.06 }),
    audienceWeights: weights({ gameplay: 0.34, graphics: 0.26, polish: 0.18, audio: 0.12, innovation: 0.1 }),
    essentialRoles: ['programmer', 'artist'],
    basePopularity: 58,
    volatility: 0.5,
    audienceShare: 0.13,
    priceMult: 1.1,
    bugMult: 0.95,
    expectationMult: 0.9,
    praise: phrases({
      gameplay: 'the on-pitch simulation reads like the real thing',
      graphics: 'the crowds and arenas give it genuine broadcast energy',
      polish: 'it is tight, quick and forgiving to pick up',
    }),
    critique: phrases({
      gameplay: 'the rules are approximated at best',
      innovation: 'this is last year game with a new box',
      graphics: 'the athletes move like mannequins',
    }),
  },
  racing: {
    id: 'racing',
    name: 'Racing',
    blurb: 'Speed, handling and a sense of machines.',
    criticWeights: weights({ gameplay: 0.34, graphics: 0.24, audio: 0.14, polish: 0.16, innovation: 0.12 }),
    audienceWeights: weights({ gameplay: 0.36, graphics: 0.26, audio: 0.14, polish: 0.14, innovation: 0.1 }),
    essentialRoles: ['programmer', 'artist'],
    basePopularity: 55,
    volatility: 0.75,
    audienceShare: 0.11,
    priceMult: 1.0,
    bugMult: 1.0,
    expectationMult: 0.95,
    praise: phrases({
      gameplay: 'the handling model rewards a heavy right foot',
      graphics: 'the light, blur and motion sell every corner',
      audio: 'the engine notes alone are worth the price',
    }),
    critique: phrases({
      gameplay: 'the AI only knows how to be in the way',
      polish: 'collisions throw you through the map',
      graphics: 'the tracks are pretty but featureless',
    }),
  },
  horror: {
    id: 'horror',
    name: 'Horror',
    blurb: 'Atmosphere, restraint and timing. Audio carries the scare.',
    criticWeights: weights({ audio: 0.22, graphics: 0.2, story: 0.18, gameplay: 0.18, polish: 0.1, innovation: 0.12 }),
    audienceWeights: weights({ audio: 0.2, graphics: 0.24, gameplay: 0.24, story: 0.16, polish: 0.12 }),
    essentialRoles: ['artist', 'audio'],
    basePopularity: 44,
    volatility: 1.35,
    audienceShare: 0.09,
    priceMult: 0.9,
    bugMult: 1.05,
    expectationMult: 0.85,
    praise: phrases({
      audio: 'the sound design does most of the scaring and does it well',
      graphics: 'it stages dread in shadow rather than gore',
      story: 'the slow reveal of its premise is handled with real restraint',
    }),
    critique: phrases({
      audio: 'silence is not the same thing as tension',
      gameplay: 'you spend the runtime walking and looking for keys',
      polish: 'the scare triggers misfire constantly',
    }),
  },
  shooter: {
    id: 'shooter',
    name: 'Shooter',
    blurb: 'Aim, aim assist, and a gun that sounds right.',
    criticWeights: weights({ gameplay: 0.36, graphics: 0.2, polish: 0.18, audio: 0.12, innovation: 0.14 }),
    audienceWeights: weights({ gameplay: 0.38, graphics: 0.24, audio: 0.12, polish: 0.16, innovation: 0.1 }),
    essentialRoles: ['programmer', 'artist'],
    basePopularity: 66,
    volatility: 1.0,
    audienceShare: 0.16,
    priceMult: 1.05,
    bugMult: 1.15,
    expectationMult: 1.0,
    praise: phrases({
      gameplay: 'the gunplay has the kind of snap that stays with you',
      graphics: 'the effects work is loud and legible at once',
      innovation: 'it finds new shapes inside a very old formula',
    }),
    critique: phrases({
      gameplay: 'the levels are corridors with firefights bolted on',
      polish: 'netcode and collision bugs make victories feel provisional',
      story: 'the cutscenes interrupt the game you bought',
    }),
  },
  puzzle: {
    id: 'puzzle',
    name: 'Puzzle',
    blurb: 'One perfect idea, expressed cleanly. Polish is everything.',
    criticWeights: weights({ gameplay: 0.42, innovation: 0.22, polish: 0.22, audio: 0.06, graphics: 0.08 }),
    audienceWeights: weights({ gameplay: 0.4, polish: 0.2, graphics: 0.14, innovation: 0.18, audio: 0.08 }),
    essentialRoles: ['designer'],
    basePopularity: 40,
    volatility: 0.65,
    audienceShare: 0.08,
    priceMult: 0.65,
    bugMult: 0.6,
    expectationMult: 0.7,
    praise: phrases({
      gameplay: 'each level teaches one rule then asks you to bend it',
      innovation: 'the core mechanic is genuinely new',
      polish: 'it never wastes a single click',
    }),
    critique: phrases({
      gameplay: 'the ideas run dry about two hours in',
      innovation: 'it borrows its whole vocabulary from better games',
      graphics: 'the presentation is aggressively interchangeable',
    }),
  },
};

export const GENRE_ORDER: readonly GenreId[] = [
  'action',
  'rpg',
  'strategy',
  'simulation',
  'adventure',
  'sports',
  'racing',
  'horror',
  'shooter',
  'puzzle',
];

export function genreDef(id: GenreId): GenreDef {
  return GENRES[id];
}

export function totalWeight(weights: Record<QualityDimensionId, number>): number {
  let t = 0;
  for (const dim of QUALITY_DIMENSIONS) t += weights[dim];
  return t || 1;
}

/** Weighted quality score in 0..100 using a genre's weighting profile. */
export function weightedQuality(
  quality: Record<QualityDimensionId, number>,
  weights: Record<QualityDimensionId, number>,
): number {
  let total = 0;
  let acc = 0;
  for (const dim of QUALITY_DIMENSIONS) {
    acc += (quality[dim] ?? 0) * weights[dim];
    total += weights[dim];
  }
  return total === 0 ? 0 : acc / total;
}
