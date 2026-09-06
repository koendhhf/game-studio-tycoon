/**
 * Stable entity ids.
 *
 * Ids are prefixed strings ("<kind><n>") generated from a single counter that
 * lives inside the world state, so ids are reproducible from a seed and survive
 * save/load untouched. Systems must iterate entity maps in sorted-id order to
 * keep the tick order deterministic — see `sortedIds`.
 */

export type EntityKind = 'studio' | 'employee' | 'project' | 'release' | 'event' | 'candidate' | 'mod';

const PREFIX: Record<EntityKind, string> = {
  studio: 'st',
  employee: 'em',
  project: 'pr',
  release: 'rl',
  event: 'ev',
  candidate: 'ca',
  mod: 'md',
};

export function formatId(kind: EntityKind, n: number): string {
  return `${PREFIX[kind]}${n}`;
}

/** Numeric suffix of an id, used as a stable tiebreaker. */
export function idNumber(id: string): number {
  const n = parseInt(id.replace(/^[a-z]+/, ''), 10);
  return Number.isNaN(n) ? 0 : n;
}

export function compareIds(a: string, b: string): number {
  const na = idNumber(a);
  const nb = idNumber(b);
  if (na !== nb) return na - nb;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Deterministic iteration order for a record keyed by entity id. */
export function sortedIds<T>(record: Record<string, T>): string[] {
  return Object.keys(record).sort(compareIds);
}

export function sortedValues<T>(record: Record<string, T>): T[] {
  return sortedIds(record).map((id) => record[id]);
}
