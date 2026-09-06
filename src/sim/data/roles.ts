/**
 * Roles. A role is data, not behaviour: it decides which quality dimensions an
 * employee naturally pushes, how fast they work, and what they expect to be paid.
 * New roles in later phases are additive — see `ROLE_ORDER`.
 */

import type { QualityDimensionId, RoleId } from '../core/types';

export interface RoleDef {
  id: RoleId;
  name: string;
  blurb: string;
  /** How a day of this role's effort is distributed over the quality dimensions. Sums to 1. */
  focus: Partial<Record<QualityDimensionId, number>>;
  /** Throughput multiplier on work units. */
  speed: number;
  /** Salary expectation multiplier. */
  salaryMult: number;
  /** Primary skill used for "is this person good at their job" checks. */
  primary: QualityDimensionId;
  /** Skills a candidate of this role is generated with (weights over dimension skills). */
  skillShape: Partial<Record<QualityDimensionId, number>>;
  /** Bug fixing throughput during the polish phase. */
  fixRate: number;
  /** Whole-team throughput boost while at least one of these is assigned. */
  teamSpeedMult?: number;
  /** Multiplier on negative morale drift for the team. */
  moraleShieldMult?: number;
  /** Multiplier on bug creation for the team. */
  bugRateMult?: number;
}

export const ROLES: Record<RoleId, RoleDef> = {
  programmer: {
    id: 'programmer',
    name: 'Programmer',
    blurb: 'Turns designs into shippable code. Drives gameplay feel, tech graphics and polish.',
    focus: { gameplay: 0.3, graphics: 0.14, audio: 0.04, innovation: 0.18, polish: 0.34 },
    speed: 1.0,
    salaryMult: 1.15,
    primary: 'gameplay',
    skillShape: { gameplay: 0.34, graphics: 0.18, innovation: 0.24, polish: 0.32 },
    fixRate: 1.0,
  },
  designer: {
    id: 'designer',
    name: 'Designer',
    blurb: 'Shapes systems, levels and rules. The main engine of gameplay and innovation.',
    focus: { gameplay: 0.44, graphics: 0.06, story: 0.1, innovation: 0.24, polish: 0.16 },
    speed: 1.0,
    salaryMult: 1.0,
    primary: 'gameplay',
    skillShape: { gameplay: 0.5, story: 0.16, innovation: 0.28, polish: 0.06 },
    fixRate: 0.2,
  },
  artist: {
    id: 'artist',
    name: 'Artist',
    blurb: 'Produces the visuals. Carries the graphics dimension almost alone.',
    focus: { graphics: 0.78, gameplay: 0.04, story: 0.04, innovation: 0.08, polish: 0.06 },
    speed: 1.05,
    salaryMult: 0.92,
    primary: 'graphics',
    skillShape: { graphics: 0.8, story: 0.05, innovation: 0.15 },
    fixRate: 0.15,
  },
  writer: {
    id: 'writer',
    name: 'Writer',
    blurb: 'Story, dialogue and lore. Matters most for narrative-heavy genres.',
    focus: { story: 0.78, gameplay: 0.08, innovation: 0.08, polish: 0.06 },
    speed: 1.1,
    salaryMult: 0.8,
    primary: 'story',
    skillShape: { story: 0.85, gameplay: 0.1, innovation: 0.05 },
    fixRate: 0.1,
  },
  audio: {
    id: 'audio',
    name: 'Audio',
    blurb: 'Music, SFX and voice direction. Owns the audio dimension.',
    focus: { audio: 0.84, story: 0.04, innovation: 0.06, polish: 0.06 },
    speed: 1.1,
    salaryMult: 0.85,
    primary: 'audio',
    skillShape: { audio: 0.9, innovation: 0.1 },
    fixRate: 0.1,
  },
  producer: {
    id: 'producer',
    name: 'Producer',
    blurb: 'Keeps scope honest. Boosts throughput, morale and team stability.',
    focus: { gameplay: 0.1, graphics: 0.1, story: 0.1, audio: 0.1, polish: 0.4, innovation: 0.2 },
    speed: 0.8,
    salaryMult: 1.3,
    primary: 'polish',
    skillShape: { polish: 0.5, gameplay: 0.2, innovation: 0.15, story: 0.15 },
    fixRate: 0.4,
    /** Producers multiply the whole team's throughput while assigned. */
    teamSpeedMult: 1.07,
    /** Producers damp morale decay from crunch and overwork. */
    moraleShieldMult: 0.6,
    bugRateMult: 0.9,
  },
  qa: {
    id: 'qa',
    name: 'QA',
    blurb: 'Finds and burns down bugs. Converts a rough build into a polished one.',
    focus: { polish: 0.82, gameplay: 0.06, graphics: 0.04, innovation: 0.08 },
    speed: 1.15,
    salaryMult: 0.7,
    primary: 'polish',
    skillShape: { polish: 0.9, gameplay: 0.1 },
    fixRate: 2.2,
  },
};

export const ROLE_ORDER: readonly RoleId[] = [
  'programmer',
  'designer',
  'artist',
  'writer',
  'audio',
  'producer',
  'qa',
];

export function roleSpeed(role: RoleId): number {
  return ROLES[role].speed;
}

export function roleFocus(role: RoleId, dim: QualityDimensionId): number {
  return ROLES[role].focus[dim] ?? 0;
}

/**
 * Team-level bonus granted by role coverage (currently: producers).
 * Reads the role definitions so new support roles can opt in through data alone.
 */
export function producerBonus(roles: readonly RoleId[]): { speed: number; morale: number; bugs: number } {
  const out = { speed: 1, morale: 1, bugs: 1 };
  for (const role of roles) {
    const def = ROLES[role];
    if (!def) continue;
    if (def.teamSpeedMult) out.speed *= def.teamSpeedMult;
    if (def.moraleShieldMult) out.morale *= def.moraleShieldMult;
    if (def.bugRateMult) out.bugs *= def.bugRateMult;
  }
  return out;
}

/** Roles a team is missing, given the coverage a project expects. */
export function missingRoles(present: readonly RoleId[], wanted: readonly RoleId[]): RoleId[] {
  return wanted.filter((role) => !present.includes(role));
}
