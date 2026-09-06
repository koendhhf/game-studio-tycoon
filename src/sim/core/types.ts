/** Shared primitive value types for the simulation. */

export type QualityDimensionId = 'gameplay' | 'graphics' | 'story' | 'audio' | 'innovation' | 'polish';

export const QUALITY_DIMENSIONS: readonly QualityDimensionId[] = [
  'gameplay',
  'graphics',
  'story',
  'audio',
  'innovation',
  'polish',
];

export type GenreId =
  | 'action'
  | 'rpg'
  | 'strategy'
  | 'simulation'
  | 'adventure'
  | 'sports'
  | 'racing'
  | 'horror'
  | 'shooter'
  | 'puzzle';

export type RoleId = 'programmer' | 'designer' | 'artist' | 'writer' | 'audio' | 'producer' | 'qa';

export type PlatformId = string;
export type StudioId = string;
export type EmployeeId = string;
export type ProjectId = string;
export type ReleaseId = string;
export type EventId = string;

export type QualityVector = Record<QualityDimensionId, number>;

export type ScopeId = 'prototype' | 'small' | 'medium' | 'large' | 'ambitious';
