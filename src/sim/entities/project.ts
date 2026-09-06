/**
 * Development project entity + the pure accessors the systems share.
 */

import type { GenreId, PlatformId, ProjectId, QualityDimensionId, ScopeId, StudioId, EmployeeId } from '../core/types';
import { QUALITY_DIMENSIONS } from '../core/types';
import { SCOPES } from '../data/scopes';
import { clamp } from '../core/math';

export type ProjectStatus = 'development' | 'polish' | 'stalled' | 'ready' | 'released' | 'cancelled';

export interface Project {
  id: ProjectId;
  studioId: StudioId;
  title: string;
  genreId: GenreId;
  platformId: PlatformId;
  scope: ScopeId;
  status: ProjectStatus;

  /** Dollars the studio has committed to the project. */
  budget: number;
  /** Dollars actually spent (team cost + tooling + licence fees). */
  spent: number;
  /** Marketing committed at release. */
  marketing: number;

  workRequired: number;
  workDone: number;
  /** 0..1. */
  progress: number;

  /** Accumulated quality per dimension, 0..100 (soft-capped by scope+budget). */
  quality: Record<QualityDimensionId, number>;
  /** Cumulative skill-weighted effort invested per dimension (drives quality easing). */
  qualityEffort: Record<QualityDimensionId, number>;
  /** 0..1 — how much new ground the project attempts (innovation vs polish/budget risk). */
  risk: number;
  /** Open bug backlog. Drives review penalties and the polish phase. */
  bugs: number;
  bugsFixed: number;
  /** Peak bug count, used for the "shipped broken" event thresholds. */
  bugsPeak: number;

  teamIds: EmployeeId[];
  crunch: boolean;
  /** Set when the studio has run out of budget. */
  stalledDays: number;

  createdTick: number;
  daysInDevelopment: number;
  daysInPolish: number;
  /** Design choices that shape which dimensions are cheap or expensive. */
  focus: QualityDimensionId | null;

  releasedReleaseId: string | null;
}

export function createQualityVector(initial = 0): Record<QualityDimensionId, number> {
  const out = {} as Record<QualityDimensionId, number>;
  for (const dim of QUALITY_DIMENSIONS) out[dim] = initial;
  return out;
}

export function projectScope(project: Project) {
  return SCOPES[project.scope];
}

export function completeness(project: Project): number {
  return clamp(project.progress, 0, 1);
}

/** Fraction of the bug backlog that has been burned down (0 when no bugs ever existed). */
export function polishRatio(project: Project): number {
  const total = project.bugs + project.bugsFixed;
  if (total <= 0) return 1;
  return project.bugsFixed / total;
}

export function bugPressure(project: Project): number {
  const def = SCOPES[project.scope];
  return clamp(project.bugs / (def.workUnits * 0.12), 0, 2);
}

export function isFeatureComplete(project: Project): boolean {
  return project.progress >= 1;
}

export function canRelease(project: Project): boolean {
  return (project.status === 'development' || project.status === 'polish' || project.status === 'stalled' || project.status === 'ready') && project.progress > 0.05;
}

export function averageQuality(project: Project): number {
  let total = 0;
  for (const dim of QUALITY_DIMENSIONS) total += project.quality[dim];
  return total / QUALITY_DIMENSIONS.length;
}
