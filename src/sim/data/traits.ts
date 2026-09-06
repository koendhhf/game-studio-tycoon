/**
 * Personality traits. Each trait is a bundle of numeric modifiers applied in the
 * development / morale / salary models. Adding a trait later is a data change only.
 */

import type { RoleId } from '../core/types';

export type TraitId =
  | 'perfectionist'
  | 'rockstar'
  | 'mentor'
  | 'workaholic'
  | 'diplomat'
  | 'frugal'
  | 'prodigy'
  | 'plodding'
  | 'ideaMachine'
  | 'cowboy'
  | 'teamPlayer'
  | 'burnout';

export interface TraitDef {
  id: TraitId;
  name: string;
  blurb: string;
  /** Multiplier on personal work throughput. */
  speed?: number;
  /** Flat daily morale drift added by the trait. */
  moralePerDay?: number;
  /** Multiplier on how much of their own work converts into team-wide output. */
  teamSpeed?: number;
  /** Multiplier on polish accumulation. */
  polish?: number;
  /** Multiplier on innovation accumulation. */
  innovation?: number;
  /** Multiplier on bug creation. */
  bugs?: number;
  /** Multiplier on bug fixing during the polish phase. */
  fixRate?: number;
  /** Salary expectation multiplier. */
  salary?: number;
  /** Experience/skill growth multiplier. */
  growth?: number;
  /** Raises the skills of teammates in the same role. */
  teachesRole?: RoleId | 'any';
  /** How attractive they are to poachers (higher = harder to steal). */
  loyalty?: number;
  /** Review-visible quality bonus for marketing/hype. */
  hype?: number;
  /** Morale effect on the rest of the team, per day. */
  teamMorale?: number;
}

export const TRAITS: Record<TraitId, TraitDef> = {
  perfectionist: {
    id: 'perfectionist',
    name: 'Perfectionist',
    blurb: 'Slower, but squeezes extra polish out of every build.',
    speed: 0.9,
    polish: 1.35,
    bugs: 0.85,
    moralePerDay: -0.05,
  },
  rockstar: {
    id: 'rockstar',
    name: 'Rockstar',
    blurb: 'Massive output that quietly irritates everyone else.',
    speed: 1.25,
    teamMorale: -0.06,
    salary: 1.25,
    loyalty: -10,
  },
  mentor: {
    id: 'mentor',
    name: 'Mentor',
    blurb: 'Levels up junior teammates working on the same project.',
    teamSpeed: 1.02,
    teachesRole: 'any',
    growth: 1.5,
    moralePerDay: 0.04,
  },
  workaholic: {
    id: 'workaholic',
    name: 'Workaholic',
    blurb: 'Thrives on crunch; burns out if the project stalls.',
    speed: 1.15,
    moralePerDay: 0.06,
    bugs: 1.1,
  },
  diplomat: {
    id: 'diplomat',
    name: 'Diplomat',
    blurb: 'Keeps the team settled through reorgs and delays.',
    teamMorale: 0.09,
    salary: 1.05,
  },
  frugal: {
    id: 'frugal',
    name: 'Frugal',
    blurb: 'Happy with less money; cheap to keep and hard to poach.',
    salary: 0.82,
    loyalty: 15,
  },
  prodigy: {
    id: 'prodigy',
    name: 'Prodigy',
    blurb: 'Skills climb very fast while shipping real projects.',
    growth: 2.2,
    speed: 1.05,
  },
  plodding: {
    id: 'plodding',
    name: 'Plodding',
    blurb: 'Steady, unhurried, and never the first to an idea.',
    speed: 0.88,
    innovation: 0.85,
    moralePerDay: 0.05,
    salary: 0.9,
  },
  ideaMachine: {
    id: 'ideaMachine',
    name: 'Idea Machine',
    blurb: 'Endless concepts — brilliant, but leaves a mess to clean up.',
    innovation: 1.45,
    bugs: 1.2,
    polish: 0.9,
  },
  cowboy: {
    id: 'cowboy',
    name: 'Cowboy Coder',
    blurb: 'Ships fast, breaks things, fixes them in a patch later.',
    speed: 1.2,
    bugs: 1.45,
    polish: 0.88,
  },
  teamPlayer: {
    id: 'teamPlayer',
    name: 'Team Player',
    blurb: 'Reliable across the board and lifts the whole room.',
    teamSpeed: 1.03,
    teamMorale: 0.05,
    loyalty: 10,
  },
  burnout: {
    id: 'burnout',
    name: 'Burnt Out',
    blurb: 'Needs a light schedule; crumbles under pressure.',
    speed: 0.95,
    moralePerDay: -0.12,
    salary: 0.95,
  },
};

export const TRAIT_ORDER: readonly TraitId[] = Object.keys(TRAITS) as TraitId[];

/** Traits that are considered a drawback, used by candidate scoring/UI badges. */
export const NEGATIVE_TRAITS: readonly TraitId[] = ['plodding', 'burnout', 'cowboy', 'rockstar'];

export type TraitEffects = 'polish' | 'innovation' | 'bugs' | 'fixRate' | 'salary' | 'growth';

/** Trait helpers accept `string[]` because entities store trait ids as plain strings. */
function fold(ids: readonly string[], key: keyof TraitDef, initial: number, combine: (acc: number, v: number) => number): number {
  let acc = initial;
  for (const id of ids) {
    const def = TRAITS[id as TraitId];
    if (!def) continue;
    const value = def[key] as number | string | RoleId | 'any' | undefined;
    if (typeof value === 'number') acc = combine(acc, value);
  }
  return acc;
}

export const traitSpeed = (ids: readonly string[]): number => fold(ids, 'speed', 1, (a, v) => a * v);

export const traitMult = (ids: readonly string[], key: TraitEffects): number => fold(ids, key, 1, (a, v) => a * v);

export const traitSalary = (ids: readonly string[]): number => fold(ids, 'salary', 1, (a, v) => a * v);

export const traitMoralePerDay = (ids: readonly string[]): number => fold(ids, 'moralePerDay', 0, (a, v) => a + v);

export const traitTeamMorale = (ids: readonly string[]): number => fold(ids, 'teamMorale', 0, (a, v) => a + v);

export const traitTeamSpeed = (ids: readonly string[]): number => fold(ids, 'teamSpeed', 1, (a, v) => a * v);

export const traitLoyalty = (ids: readonly string[]): number => fold(ids, 'loyalty', 0, (a, v) => a + v);

export const traitHype = (ids: readonly string[]): number => fold(ids, 'hype', 0, (a, v) => a + v);

/** Growth multiplier used by the skill-development model. */
export const traitGrowth = (ids: readonly string[]): number => fold(ids, 'growth', 1, (a, v) => a * v);

export function isKnownTrait(id: string): id is TraitId {
  return Object.prototype.hasOwnProperty.call(TRAITS, id);
}
