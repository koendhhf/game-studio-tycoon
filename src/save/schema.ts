/**
 * Save file format.
 *
 * A save is a versioned envelope around the whole world state plus a checksum of the
 * payload, so corruption is detected instead of silently producing a broken game.
 * Loading validates the shape, repairs anything missing (forward compatible), and runs
 * migrations for older versions.
 */

import { fnv1a, randFor } from '../sim/core/rng';
import { createMarketState } from '../sim/entities/market';
import { WORLD_VERSION, type WorldState } from '../sim/state/world';

export const SAVE_MAGIC = 'studio-mogul-save';
export const SAVE_FORMAT_VERSION = 1;

export interface SaveEnvelope {
  magic: typeof SAVE_MAGIC;
  /** Save-format version (migrations keyed on this). */
  version: number;
  /** World-model version the payload was written with. */
  worldVersion: number;
  savedAt: string;
  label: string;
  /** Tick the save was taken at — cheap sanity check. */
  tick: number;
  checksum: string;
  state: WorldState;
}

export interface SaveResult {
  ok: boolean;
  error?: string;
  warnings?: string[];
}

/** Canonical stringify: sorted object keys, so identical data always hashes identical. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const parts: string[] = [];
  for (const key of keys) {
    const entry = record[key];
    if (entry === undefined) continue;
    parts.push(`${JSON.stringify(key)}:${stableStringify(entry)}`);
  }
  return `{${parts.join(',')}}`;
}

export function checksumOf(payload: unknown): string {
  return fnv1a(stableStringify(payload)).toString(16).padStart(8, '0');
}

/** Serialize a world state into save-file text. */
export function serializeWorld(state: WorldState, label = 'Save'): string {
  const envelope: Omit<SaveEnvelope, 'checksum'> = {
    magic: SAVE_MAGIC,
    version: SAVE_FORMAT_VERSION,
    worldVersion: WORLD_VERSION,
    savedAt: new Date().toISOString(),
    label,
    tick: state.calendar.tick,
    state,
  };
  const checksum = checksumOf({ ...envelope, savedAt: 'fixed' });
  return JSON.stringify({ ...envelope, checksum });
}

type Migration = (data: Record<string, unknown>) => void;

/** Older saves are upgraded here, newest last. Keeping this list append-only is what
 *  lets Phase 5 change the world model without orphaning anyone's save file. */
const MIGRATIONS: Record<number, Migration> = {
  // 2: (data) => { data.newField = 0 },
};

function migrate(raw: Record<string, unknown>, from: number): { data: Record<string, unknown>; applied: number[] } {
  const applied: number[] = [];
  let data = raw;
  for (let v = from + 1; v <= SAVE_FORMAT_VERSION; v++) {
    const migration = MIGRATIONS[v];
    if (migration) {
      migration(data);
      applied.push(v);
    }
  }
  return { data, applied };
}

export interface DeserializedSave {
  ok: boolean;
  state?: WorldState;
  envelope?: SaveEnvelope;
  error?: string;
  warnings: string[];
}

/** Parse and validate save text. Never throws. */
export function deserializeWorld(text: string, options: { verifyChecksum?: boolean } = {}): DeserializedSave {
  const warnings: string[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { ok: false, error: `Not valid JSON (${error instanceof Error ? error.message : 'parse error'})`, warnings };
  }
  if (!parsed || typeof parsed !== 'object') return { ok: false, error: 'Save file is not an object', warnings };

  const envelope = parsed as Partial<SaveEnvelope>;
  if (envelope.magic !== SAVE_MAGIC) return { ok: false, error: 'Unrecognised save file (magic mismatch)', warnings };
  if (typeof envelope.version !== 'number') return { ok: false, error: 'Save file has no format version', warnings };
  if (envelope.version > SAVE_FORMAT_VERSION) {
    return { ok: false, error: `Save file is from a newer version of the game (v${envelope.version})`, warnings };
  }
  if (!envelope.state || typeof envelope.state !== 'object') return { ok: false, error: 'Save file has no world state', warnings };

  if (options.verifyChecksum !== false && typeof envelope.checksum === 'string') {
    const expected = checksumOf({ ...envelope, checksum: undefined, savedAt: 'fixed' });
    if (expected !== envelope.checksum) warnings.push('Checksum mismatch — the file may have been edited or truncated.');
  } else if (typeof envelope.checksum !== 'string') {
    warnings.push('Save file has no checksum.');
  }

  let state = envelope.state as WorldState;
  if (envelope.version < SAVE_FORMAT_VERSION) {
    const { data, applied } = migrate(envelope as unknown as Record<string, unknown>, envelope.version);
    if (applied.length > 0) warnings.push(`Migrated from save format v${envelope.version}.`);
    state = data.state as WorldState;
  }
  if (state.version !== WORLD_VERSION) warnings.push(`World model v${state.version} → v${WORLD_VERSION} normalised.`);

  const repaired = repairWorld(state);
  warnings.push(...repaired.warnings);
  if (repaired.fatal) return { ok: false, error: repaired.fatal, warnings };

  if (typeof envelope.tick === 'number' && envelope.tick !== repaired.state.calendar.tick) {
    warnings.push('Tick counter in the envelope differs from the world state; using the world state.');
  }

  return { ok: true, state: repaired.state, envelope: { ...(envelope as SaveEnvelope), state: repaired.state }, warnings };
}

const REQUIRED_COLLECTIONS = ['studios', 'employees', 'releases'] as const;

/**
 * Fill in anything an older/partial payload is missing and assert referential integrity.
 * The goal is that loading never produces a half-broken world: either it repairs or it
 * refuses with a clear message.
 */
export function repairWorld(input: WorldState): { state: WorldState; warnings: string[]; fatal?: string } {
  const warnings: string[] = [];
  const state = input;

  if (!state || typeof state !== 'object') return { state, warnings, fatal: 'World state is missing' };
  if (!state.calendar || typeof state.calendar.tick !== 'number') return { state, warnings, fatal: 'World state has no calendar' };
  if (!state.rng || typeof state.rng.a !== 'number') return { state, warnings, fatal: 'World state has no RNG state' };
  for (const key of REQUIRED_COLLECTIONS) {
    if (!state[key] || typeof state[key] !== 'object') return { state, warnings, fatal: `World state is missing "${key}"` };
  }
  // Projects and market data are derivable, so a file that lost them is rebuilt rather than
  // thrown away: nothing else in the world can contradict an empty project list, and the
  // market is a pure function of the seed and the year.
  if (!state.projects || typeof state.projects !== 'object') {
    state.projects = {};
    warnings.push('Project list was missing; restored as empty.');
  }
  if (!state.market?.genres) {
    state.market = createMarketState(state.calendar.year, state.seed ?? 1, (key) => randFor(state.seed ?? 1, key));
    warnings.push('Market data was missing; rebuilt from the world seed.');
  }

  state.version = WORLD_VERSION;
  if (!Array.isArray(state.events?.entries)) {
    state.events = { entries: [], capacity: 500, dropped: 0 };
    warnings.push('Event log was missing; started a fresh one.');
  }
  if (!Array.isArray(state.listings)) state.listings = [];
  if (!state.stats) {
    state.stats = {
      ticksRun: state.calendar.tick,
      monthsRun: 0,
      yearsRun: 0,
      gamesReleasedByPlayer: 0,
      gamesReleasedTotal: Object.keys(state.releases).length,
      aiActionsTaken: 0,
      commandsProcessed: 0,
      studiosFounded: 0,
      studiosClosed: 0,
      lastTickMs: 0,
    };
    warnings.push('Run statistics were missing; rebuilt from the world state.');
  }
  if (!state.economy) {
    state.economy = { priceLevel: 1, wageIndex: 1, lastInterestMonthIndex: 0 };
  }
  if (typeof state.nextId !== 'number') {
    state.nextId = highestIdNumber(state) + 1;
    warnings.push('Id counter was missing; recomputed.');
  }
  if (!state.playerStudioId || !state.studios[state.playerStudioId]) {
    return { state, warnings, fatal: 'Player studio is missing from the save' };
  }

  // Drop dangling references (a removed employee still listed by a studio, etc.).
  let dropped = 0;
  for (const studio of Object.values(state.studios)) {
    const before = studio.employeeIds.length + studio.projectIds.length;
    studio.employeeIds = studio.employeeIds.filter((id) => {
      const emp = state.employees[id];
      return Boolean(emp) && emp.studioId === studio.id;
    });
    studio.projectIds = studio.projectIds.filter((id) => Boolean(state.projects[id]));
    studio.releaseIds = studio.releaseIds.filter((id) => Boolean(state.releases[id]));
    dropped += before - (studio.employeeIds.length + studio.projectIds.length);
  }
  for (const project of Object.values(state.projects)) {
    const live = project.status !== 'released' && project.status !== 'cancelled';
    const valid = live ? project.teamIds.filter((id) => state.employees[id]?.studioId === project.studioId) : project.teamIds;
    dropped += project.teamIds.length - valid.length;
    project.teamIds = valid;
    if (project.qualityEffort === undefined) {
      project.qualityEffort = { gameplay: 0, graphics: 0, story: 0, audio: 0, innovation: 0, polish: 0 };
    }
    if (typeof project.risk !== 'number') project.risk = 0.3;
    if (!Array.isArray(project.teamIds)) project.teamIds = [];
  }
  if (dropped > 0) warnings.push(`Removed ${dropped} dangling entity reference(s).`);

  // The other direction: a person who still claims a studio that does not employ them would be
  // invisible — neither hireable nor on a payroll — so they go back on the open market.
  let rehomed = 0;
  for (const emp of Object.values(state.employees)) {
    if (emp.studioId === null) continue;
    const employer = state.studios[emp.studioId];
    if (!employer || !employer.employeeIds.includes(emp.id)) {
      emp.studioId = null;
      emp.status = 'candidate';
      rehomed += 1;
    }
  }
  if (rehomed > 0) warnings.push(`Returned ${rehomed} employee(s) with a broken studio link to the open market.`);

  const highest = highestIdNumber(state);
  if (state.nextId <= highest) state.nextId = highest + 1;

  return { state, warnings };
}

function highestIdNumber(state: WorldState): number {
  let highest = 0;
  const scan = (record: Record<string, unknown>) => {
    for (const id of Object.keys(record)) {
      const n = parseInt(id.replace(/^[a-z]+/, ''), 10);
      if (!Number.isNaN(n) && n > highest) highest = n;
    }
  };
  scan(state.studios);
  scan(state.employees);
  scan(state.projects);
  scan(state.releases);
  return highest;
}
