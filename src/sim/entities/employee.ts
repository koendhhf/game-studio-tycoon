/**
 * Employee entity. Pure data: all behaviour lives in systems/models so the entity
 * can be serialized, diffed and tested without touching the engine.
 */

import { BALANCE } from '../data/balance';
import { ROLES } from '../data/roles';
import { TRAITS, traitSalary } from '../data/traits';
import type { QualityDimensionId, RoleId, StudioId, EmployeeId, GenreId } from '../core/types';
import { QUALITY_DIMENSIONS } from '../core/types';
import { clamp } from '../core/math';

export type EmployeeStatus = 'employed' | 'candidate' | 'unhirable';

export interface Employee {
  id: EmployeeId;
  name: string;
  role: RoleId;
  /** 0..100 per quality dimension. */
  skills: Record<QualityDimensionId, number>;
  /** Career ceiling multiplier on skill growth. */
  potential: number;
  /** Monthly gross salary. */
  salary: number;
  /** Years of shipped experience. */
  experience: number;
  /** 0..100. */
  morale: number;
  /** 0..100 — resistance to being poached. */
  loyalty: number;
  traits: string[];
  /** Owning studio, or null when the employee is in the open labour pool. */
  studioId: StudioId | null;
  hiredTick: number;
  status: EmployeeStatus;
  /** Career statistics, kept for the history/catalogue screens. */
  workUnitsShipped: number;
  gamesShipped: number;
  bestReviewScore: number;
  /** Personal taste — influences the genre they work best in. */
  preferredGenre: GenreId | null;
}

export function emptySkills(): Record<QualityDimensionId, number> {
  return { gameplay: 0, graphics: 0, story: 0, audio: 0, innovation: 0, polish: 0 };
}

export function skillAverage(emp: Employee): number {
  let total = 0;
  for (const dim of QUALITY_DIMENSIONS) total += emp.skills[dim];
  return total / QUALITY_DIMENSIONS.length;
}

/** Average skill in the dimensions this employee's role actually drives. */
export function effectiveSkill(emp: Employee): number {
  const focus = ROLES[emp.role].focus;
  let weighted = 0;
  let total = 0;
  for (const dim of QUALITY_DIMENSIONS) {
    const w = focus[dim] ?? 0;
    weighted += emp.skills[dim] * w;
    total += w;
  }
  return total === 0 ? skillAverage(emp) : weighted / total;
}

export function primarySkill(emp: Employee): number {
  return emp.skills[ROLES[emp.role].primary] ?? skillAverage(emp);
}

/**
 * What the market would pay for this person right now. Used for salary offers,
 * poaching risk, and the "you are underpaying them" morale penalty.
 */
export function marketValue(emp: Employee): number {
  const def = ROLES[emp.role];
  const skill = skillAverage(emp);
  const primary = primarySkill(emp);
  const blended = skill * 0.55 + primary * 0.45;
  const traitMult = traitSalary(emp.traits);
  const value =
    (BALANCE.employee.salaryBase + blended * BALANCE.employee.salaryPerSkill + emp.experience * BALANCE.employee.salaryPerExpYear) *
    def.salaryMult *
    traitMult;
  return Math.round(value / 10) * 10;
}

export function salaryFor(role: RoleId, skills: Record<QualityDimensionId, number>, experience: number, traits: string[]): number {
  const draft: Employee = {
    id: 'temp',
    name: '',
    role,
    skills,
    potential: 1,
    salary: 0,
    experience,
    morale: 60,
    loyalty: 50,
    traits,
    studioId: null,
    hiredTick: 0,
    status: 'candidate',
    workUnitsShipped: 0,
    gamesShipped: 0,
    bestReviewScore: 0,
    preferredGenre: null,
  };
  return Math.max(
    Math.round(BALANCE.employee.salaryBase * BALANCE.employee.salaryFloorRatio),
    marketValue(draft),
  );
}

/** Pay ratio vs the open market; <1 means they feel underpaid. */
export function payRatio(emp: Employee): number {
  const value = marketValue(emp);
  return value <= 0 ? 1 : emp.salary / value;
}

export function traitNames(emp: Employee): string[] {
  return emp.traits.map((t) => TRAITS[t as keyof typeof TRAITS]?.name ?? t);
}

export function moraleBand(morale: number): 'elated' | 'content' | 'wavering' | 'unhappy' | 'mutinous' {
  if (morale >= 85) return 'elated';
  if (morale >= 68) return 'content';
  if (morale >= 50) return 'wavering';
  if (morale >= 30) return 'unhappy';
  return 'mutinous';
}

export function skillBand(skill: number): 'novice' | 'capable' | 'strong' | 'expert' | 'legendary' {
  if (skill >= 88) return 'legendary';
  if (skill >= 74) return 'expert';
  if (skill >= 58) return 'strong';
  if (skill >= 38) return 'capable';
  return 'novice';
}

export function clampEmployee(emp: Employee): Employee {
  emp.morale = clamp(emp.morale, 0, 100);
  emp.loyalty = clamp(emp.loyalty, 0, 100);
  emp.experience = Math.max(0, emp.experience);
  for (const dim of QUALITY_DIMENSIONS) emp.skills[dim] = clamp(emp.skills[dim], 0, 100);
  return emp;
}
