/**
 * Employee-level dynamics: morale drift, skill growth, poaching susceptibility.
 * Pure functions so the AI, the player UI and the tests all read the same maths.
 */

import { BALANCE } from '../data/balance';
import { ROLES } from '../data/roles';
import { GENRES } from '../data/genres';
import { QUALITY_DIMENSIONS, type GenreId, type QualityDimensionId } from '../core/types';
import { clamp } from '../core/math';
import type { Employee } from '../entities/employee';
import { marketValue, payRatio, skillAverage } from '../entities/employee';
import { traitGrowth, traitLoyalty, traitMoralePerDay, traitTeamMorale } from '../data/traits';
// shipmentMoraleDelta is exported for the release system.

export interface MoraleContext {
  /** Is this person assigned to a project that is actually moving? */
  working: boolean;
  /** 0..1 — how overloaded the team is relative to its optimal size. */
  overwork: number;
  crunch: boolean;
  /** The studio is behind on money this month. */
  cashCrisis: boolean;
  /** Producer cover etc. — damps the bad stuff. */
  moraleShield: number;
  /** Average morale of teammates, for the "team player/diplomat" effects. */
  teamMorale: number;
  /** Did the studio ship a flop recently? Applied as a one-off by the caller. */
  shippedFlopPenalty?: number;
}

export function moraleDrift(emp: Employee, ctx: MoraleContext): number {
  const B = BALANCE.employee;
  let delta = 0;

  // Steady pull back toward the studio baseline: teams recover, given a month or two.
  delta += (B.moraleTarget - emp.morale) * B.moraleDriftPerDay;

  // Being underpaid is the single biggest daily drain, scaled by how badly.
  const ratio = payRatio(emp);
  if (ratio < B.underpayThreshold) {
    const gap = (B.underpayThreshold - ratio) / B.underpayThreshold;
    delta += B.moraleUnderpayPerDay * clamp(gap * 1.6, 0, 2);
  } else if (ratio > 1.1) {
    delta += 0.05;
  }

  // Work: doing nothing sours people; too many people per task exhausts them.
  if (ctx.working) {
    if (ctx.overwork > 1.05) delta += B.moraleOvertimePerDay * clamp((ctx.overwork - 1) * 2, 0, 2) * ctx.moraleShield;
    else delta += 0.045;
  } else {
    delta += B.moraleIdlePerDay;
  }

  if (ctx.crunch) delta -= B.crunchMoralePerDay * ctx.moraleShield;
  if (ctx.cashCrisis) delta -= B.moraleCrisisPerDay * ctx.moraleShield;

  delta += traitMoralePerDay(emp.traits);
  delta += traitTeamMorale(emp.traits);
  delta += (ctx.teamMorale - emp.morale) * 0.008;
  if (ctx.shippedFlopPenalty) delta -= ctx.shippedFlopPenalty;

  return delta;
}

/** Morale hit (or boost) applied once, on the day a game ships. */
export function shipmentMoraleDelta(reviewScore: number): number {
  if (reviewScore >= 80) return 11;
  if (reviewScore >= 68) return 7;
  if (reviewScore >= 55) return 2;
  if (reviewScore >= 42) return -4;
  return -9;
}

/** Daily skill/experience growth while shipping real work. */
export function growthDelta(emp: Employee, projectDimWeights: Record<QualityDimensionId, number>, hoursWorked: number): Partial<Record<QualityDimensionId, number>> {
  const out: Partial<Record<QualityDimensionId, number>> = {};
  if (hoursWorked <= 0) return out;
  const B = BALANCE.employee;
  const growthMult = traitGrowth(emp.traits) * (1 + (emp.potential - 1) * 1.5);
  for (const dim of QUALITY_DIMENSIONS) {
    const weight = projectDimWeights[dim] ?? 0;
    if (weight <= 0) continue;
    const current = emp.skills[dim];
    const ceiling = clamp(current + 12 + emp.potential * 18 + emp.experience * 3, 0, 100);
    if (current >= ceiling) continue;
    const room = ceiling - current;
    const gain = B.skillGrowthPerDay * growthMult * weight * hoursWorked * clamp(room / 40, 0.05, 1);
    if (gain > 0) out[dim] = gain;
  }
  return out;
}

export function experienceDelta(emp: Employee, working: boolean): number {
  if (!working) return 0;
  return BALANCE.employee.expPerDevDay;
}

/** How tempting this person is to a rival, 0..1. */
export function poachSusceptibility(emp: Employee, offerSalary: number): number {
  const value = marketValue(emp);
  const premium = value > 0 ? offerSalary / value : 1;
  const loyalty = clamp((emp.loyalty + traitLoyalty(emp.traits)) / 100, 0, 1.4);
  const unhappy = clamp((62 - emp.morale) / 62, 0, 1);
  const base = 0.06 + clamp(premium - 1, 0, 0.8) * 0.9 + unhappy * 0.55;
  return clamp(base * (1.35 - loyalty * 0.8), 0, 0.95);
}

/** What a rival must offer to pry someone loose. */
/**
 * Money that must be in the bank to hire someone at a given salary: the signing bonus plus
 * their first month. The UI uses it to grey out offers it knows the studio cannot pay.
 */
export function hireUpfrontCost(emp: Employee, salary = emp.salary): number {
  return Math.round(salary * (1 + BALANCE.hiring.signingBonusMonths));
}

export function poachOffer(emp: Employee): number {
  return Math.round(marketValue(emp) * (1.2 + (100 - emp.loyalty) / 400));
}

/** Hiring/layoff ranking used by AI and the UI ("who should I keep?"). */
export function employeeValue(emp: Employee): number {
  const roleDef = ROLES[emp.role];
  let focused = 0;
  let weight = 0;
  for (const dim of QUALITY_DIMENSIONS) {
    const w = roleDef.focus[dim] ?? 0;
    focused += (emp.skills[dim] / 100) * w;
    weight += w;
  }
  const skill = weight ? focused / weight : skillAverage(emp) / 100;
  const cost = Math.max(1, emp.salary);
  return (skill * 100) / Math.sqrt(cost / 2200) + emp.experience * 2 + (emp.morale - 55) * 0.15;
}

/** Genre-specific bonus: people who love the genre push it harder. */
export function genreInterest(emp: Employee, genreId: GenreId): number {
  if (emp.preferredGenre === genreId) return 1.08;
  const genre = GENRES[genreId];
  const relevant = genre.criticWeights[ROLES[emp.role].primary] ?? 0;
  return 1 + (relevant - 0.2) * 0.1;
}

export function isJunior(emp: Employee): boolean {
  return skillAverage(emp) < BALANCE.employee.seniorSkillAvg && emp.experience < 3;
}
