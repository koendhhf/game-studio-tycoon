/** Shared display labels, so screens and the engine stay decoupled. */

import type { QualityDimensionId, RoleId, ScopeId } from '../sim/core/types';
import { NEGATIVE_TRAITS, TRAITS } from '../sim';

export const QUALITY_LABELS: Record<QualityDimensionId, string> = {
  gameplay: 'Gameplay',
  graphics: 'Graphics',
  story: 'Story',
  audio: 'Audio',
  innovation: 'Innovation',
  polish: 'Polish',
};

export const ROLE_LABELS: Record<RoleId, string> = {
  programmer: 'Programmer',
  designer: 'Designer',
  artist: 'Artist',
  writer: 'Writer',
  audio: 'Audio',
  producer: 'Producer',
  qa: 'QA',
};

export const SCOPE_LABELS: Record<ScopeId, string> = {
  prototype: 'Prototype',
  small: 'Small',
  medium: 'Medium',
  large: 'Large',
  ambitious: 'Ambitious',
};

export const STATUS_LABELS: Record<string, string> = {
  development: 'In development',
  polish: 'Polishing',
  ready: 'Ready to ship',
  stalled: 'Stalled',
  released: 'Released',
  cancelled: 'Cancelled',
};

export const CATEGORY_LABELS: Record<string, string> = {
  release: 'Release',
  review: 'Review',
  market: 'Market',
  studio: 'Studio',
  employee: 'Staff',
  finance: 'Finance',
  project: 'Project',
  industry: 'Industry',
};

export const DIMENSION_HELP: Record<QualityDimensionId, string> = {
  gameplay: 'How the game plays: systems, controls, pacing. Driven by designers and programmers.',
  graphics: 'Visual quality, limited by the hardware and the artists you employ.',
  story: 'Writing, narrative and world detail. Needs writers to go anywhere.',
  audio: 'Music, effects and voice. An audio specialist is the only real path to a high score here.',
  innovation: 'How fresh the ideas feel. Pushed by strong designers and by taking risks.',
  polish: 'How finished and stable the build is. Grown by QA burning down the bug backlog.',
};

/** Employees store trait ids as plain strings, so lookups go through these. */
export function traitName(id: string): string {
  return traitDef(id)?.name ?? id;
}

export function traitBlurb(id: string): string {
  return traitDef(id)?.blurb ?? '';
}

export function isGoodTrait(id: string): boolean {
  return !(NEGATIVE_TRAITS as readonly string[]).includes(id);
}

function traitDef(id: string): (typeof TRAITS)[keyof typeof TRAITS] | undefined {
  return (TRAITS as Record<string, (typeof TRAITS)[keyof typeof TRAITS]>)[id];
}

export const RISK_LABELS = ['Cautious', 'Steady', 'Bold', 'Visionary'] as const;

export function riskLabel(risk: number): string {
  if (risk < 0.25) return RISK_LABELS[0];
  if (risk < 0.5) return RISK_LABELS[1];
  if (risk < 0.78) return RISK_LABELS[2];
  return RISK_LABELS[3];
}
