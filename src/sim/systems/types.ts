/**
 * System contract.
 *
 * A system is a pure-ish function of (state, rng, calendar) that mutates the world a
 * little. Systems are registered in a fixed order and every one of them iterates entity
 * maps in sorted-id order, which is what keeps a run reproducible from (seed, commands).
 */

import type { Rng } from '../core/rng';
import type { EventDraft, GameEvent } from '../core/events';
import type { WorldState } from '../state/world';

export interface SystemContext {
  state: WorldState;
  rng: Rng;
  /** Append to the event log. */
  emit(draft: EventDraft): GameEvent;
  /** Sorted, deterministic iteration order. */
  sortedIds<T>(record: Record<string, T>): string[];
  /** Cadence helpers so systems do not re-derive them. */
  cadence: {
    monthStart: boolean;
    weekEnd: boolean;
    monday: boolean;
    yearStart: boolean;
  };
}

export interface System {
  id: string;
  /** Lower runs earlier. */
  order: number;
  tick(ctx: SystemContext): void;
}
