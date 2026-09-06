/**
 * Event log. Every notable thing that happens in the world is recorded here —
 * the dashboard reads it, the industry feed reads it, and it is part of the
 * serialized state so replays/saves reproduce the same history.
 */

import type { CalendarState } from './calendar';
import { formatDate } from './calendar';

export type EventCategory =
  | 'release'
  | 'review'
  | 'market'
  | 'studio'
  | 'employee'
  | 'finance'
  | 'project'
  | 'industry';

export type EventTone = 'positive' | 'negative' | 'neutral';

export interface GameEvent {
  id: string;
  tick: number;
  year: number;
  month: number;
  day: number;
  dateLabel: string;
  category: EventCategory;
  tone: EventTone;
  /** Short headline shown in feeds. */
  title: string;
  /** Optional supporting sentence. */
  detail?: string;
  /** Ids the event references, so the UI can link to entities. */
  studioIds?: string[];
  /** When true the event is relevant to the player (highlighted / filtered). */
  aboutPlayer: boolean;
}

export interface EventLogState {
  entries: GameEvent[];
  capacity: number;
  dropped: number;
}

export function createEventLog(capacity = 900): EventLogState {
  return { entries: [], capacity, dropped: 0 };
}

export interface EventDraft {
  category: EventCategory;
  title: string;
  detail?: string;
  tone?: EventTone;
  studioIds?: string[];
  aboutPlayer?: boolean;
}

/** Append an event, keeping the log bounded (oldest entries are dropped first). */
export function pushEvent(
  log: EventLogState,
  nextId: () => string,
  cal: CalendarState,
  draft: EventDraft,
): GameEvent {
  const event: GameEvent = {
    id: nextId(),
    tick: cal.tick,
    year: cal.year,
    month: cal.month,
    day: cal.day,
    dateLabel: formatDate(cal),
    category: draft.category,
    tone: draft.tone ?? 'neutral',
    title: draft.title,
    detail: draft.detail,
    studioIds: draft.studioIds,
    aboutPlayer: draft.aboutPlayer ?? false,
  };
  log.entries.push(event);
  if (log.entries.length > log.capacity) {
    const excess = log.entries.length - log.capacity;
    log.entries.splice(0, excess);
    log.dropped += excess;
  }
  return event;
}

export function recentEvents(log: EventLogState, count: number, filter?: (e: GameEvent) => boolean): GameEvent[] {
  const all = filter ? log.entries.filter(filter) : log.entries;
  return all.slice(Math.max(0, all.length - count)).reverse();
}
