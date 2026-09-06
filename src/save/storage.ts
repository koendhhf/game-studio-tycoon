/**
 * Save storage: named slots + autosave, backed by localStorage in the browser and by an
 * in-memory store anywhere else (tests, the headless sim CLI). The serialisation format is
 * identical in both cases, so a save produced by the CLI loads in the UI and vice versa.
 */

import { SAVE_MAGIC, deserializeWorld, serializeWorld, type SaveEnvelope } from './schema';
import type { WorldState } from '../sim/state/world';

export interface SaveMeta {
  slot: string;
  label: string;
  savedAt: string;
  tick: number;
  year: number;
  month: number;
  studioName: string;
  cash: number;
  reputation: number;
  gamesReleased: number;
  size: number;
  isAutosave: boolean;
}

export interface SaveRecord extends SaveMeta {
  raw: string;
}

export interface SaveBackend {
  read(key: string): string | null;
  write(key: string, value: string): void;
  remove(key: string): void;
  keys(): string[];
}

const PREFIX = 'studio-mogul:';

class MemoryBackend implements SaveBackend {
  private map = new Map<string, string>();
  read(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  write(key: string, value: string): void {
    this.map.set(key, value);
  }
  remove(key: string): void {
    this.map.delete(key);
  }
  keys(): string[] {
    return [...this.map.keys()];
  }
}

class LocalBackend implements SaveBackend {
  constructor(private readonly storage: Storage) {}
  read(key: string): string | null {
    try {
      return this.storage.getItem(key);
    } catch {
      return null;
    }
  }
  write(key: string, value: string): void {
    try {
      this.storage.setItem(key, value);
    } catch {
      /* quota or privacy mode: the caller keeps the in-memory copy */
    }
  }
  remove(key: string): void {
    try {
      this.storage.removeItem(key);
    } catch {
      /* ignore */
    }
  }
  keys(): string[] {
    const out: string[] = [];
    try {
      for (let i = 0; i < this.storage.length; i++) {
        const key = this.storage.key(i);
        if (key) out.push(key);
      }
    } catch {
      /* ignore */
    }
    return out;
  }
}

function defaultBackend(): SaveBackend {
  if (typeof globalThis !== 'undefined') {
    const g = globalThis as unknown as { localStorage?: Storage };
    if (g.localStorage) {
      try {
        g.localStorage.setItem('studio-mogul:probe', '1');
        g.localStorage.removeItem('studio-mogul:probe');
        return new LocalBackend(g.localStorage);
      } catch {
        /* fall through */
      }
    }
  }
  return new MemoryBackend();
}

export const AUTOSAVE_SLOT = 'autosave';
export const MANUAL_SLOTS = ['slot1', 'slot2', 'slot3', 'slot4', 'slot5', 'slot6'];

export class SaveManager {
  private cache = new Map<string, SaveRecord>();
  autosaveCounter = 0;

  constructor(private readonly backend: SaveBackend = defaultBackend()) {
    for (const key of this.backend.keys()) {
      if (!key.startsWith(PREFIX)) continue;
      const raw = this.backend.read(key);
      if (raw) {
        const meta = this.describe(key.slice(PREFIX.length), raw);
        if (meta) this.cache.set(meta.slot, meta);
      }
    }
  }

  private describe(slot: string, raw: string): SaveRecord | null {
    try {
      const parsed = JSON.parse(raw) as SaveEnvelope;
      // Anything that is not ours — a truncated write, a different game's file, a stray key —
      // is not a save slot, so it must not show up in the list at all.
      if (!parsed || parsed.magic !== SAVE_MAGIC || !parsed.state) return null;
      const state = parsed.state;
      return {
        slot,
        label: parsed.label ?? slot,
        savedAt: parsed.savedAt ?? '',
        tick: state?.calendar?.tick ?? 0,
        year: state?.calendar?.year ?? 0,
        month: (state?.calendar?.month ?? 0) + 1,
        studioName: state?.studios?.[state?.playerStudioId]?.name ?? 'Unknown studio',
        cash: state?.studios?.[state?.playerStudioId]?.cash ?? 0,
        reputation: state?.studios?.[state?.playerStudioId]?.reputation ?? 0,
        gamesReleased: state?.studios?.[state?.playerStudioId]?.releaseIds?.length ?? 0,
        size: raw.length,
        isAutosave: slot === AUTOSAVE_SLOT,
        raw,
      };
    } catch {
      return null;
    }
  }

  save(slot: string, state: WorldState, label = slot): SaveRecord {
    const raw = serializeWorld(state, label);
    this.backend.write(PREFIX + slot, raw);
    const meta = this.describe(slot, raw) ?? {
      slot,
      label,
      savedAt: new Date().toISOString(),
      tick: state.calendar.tick,
      year: state.calendar.year,
      month: state.calendar.month + 1,
      studioName: state.studios[state.playerStudioId]?.name ?? '',
      cash: state.studios[state.playerStudioId]?.cash ?? 0,
      reputation: state.studios[state.playerStudioId]?.reputation ?? 0,
      gamesReleased: state.studios[state.playerStudioId]?.releaseIds.length ?? 0,
      size: raw.length,
      isAutosave: slot === AUTOSAVE_SLOT,
      raw,
    };
    this.cache.set(slot, meta);
    return meta;
  }

  load(slot: string): { state: WorldState; warnings: string[] } | null {
    const raw = this.backend.read(PREFIX + slot) ?? this.cache.get(slot)?.raw ?? null;
    if (!raw) return null;
    const result = deserializeWorld(raw);
    if (!result.ok || !result.state) return null;
    return { state: result.state, warnings: result.warnings };
  }

  /** Load from arbitrary text (file import). */
  import(text: string): { state: WorldState; warnings: string[]; error?: string } {
    const result = deserializeWorld(text);
    if (!result.ok || !result.state) return { state: null as unknown as WorldState, warnings: result.warnings, error: result.error };
    return { state: result.state, warnings: result.warnings };
  }

  export(slot: string): string | null {
    return this.backend.read(PREFIX + slot) ?? this.cache.get(slot)?.raw ?? null;
  }

  list(): SaveMeta[] {
    const slots = new Set<string>([...this.cache.keys(), ...this.backend.keys().filter((k) => k.startsWith(PREFIX)).map((k) => k.slice(PREFIX.length))]);
    const out: SaveMeta[] = [];
    for (const slot of slots) {
      const raw = this.backend.read(PREFIX + slot) ?? this.cache.get(slot)?.raw;
      if (!raw) continue;
      const meta = this.describe(slot, raw);
      if (meta) {
        const { raw: _drop, ...rest } = meta;
        void _drop;
        out.push(rest);
      }
    }
    return out.sort((a, b) => (a.isAutosave === b.isAutosave ? b.tick - a.tick : a.isAutosave ? -1 : 1));
  }

  remove(slot: string): void {
    this.backend.remove(PREFIX + slot);
    this.cache.delete(slot);
  }

  clear(): void {
    for (const slot of [...this.cache.keys()]) this.remove(slot);
  }

  /** Called by the engine each month; writes the rolling autosave on the configured cadence. */
  maybeAutosave(state: WorldState, everyMonths: number): boolean {
    const monthIndex = state.calendar.monthIndex;
    if (state.lastAutosaveMonthIndex !== 0 && monthIndex - state.lastAutosaveMonthIndex < everyMonths) return false;
    if (state.lastAutosaveMonthIndex === 0 && monthIndex < everyMonths) return false;
    state.lastAutosaveMonthIndex = monthIndex;
    this.autosaveCounter += 1;
    this.save(AUTOSAVE_SLOT, state, `Autosave · ${state.calendar.year}`);
    return true;
  }
}

/** Standalone helpers, used by the UI and by tests. */
export function toSaveText(state: WorldState, label?: string): string {
  return serializeWorld(state, label);
}

export function fromSaveText(text: string): { state: WorldState; warnings: string[]; error?: string } {
  const result = deserializeWorld(text);
  if (!result.ok || !result.state) return { state: null as unknown as WorldState, warnings: result.warnings, error: result.error };
  return { state: result.state, warnings: result.warnings };
}
