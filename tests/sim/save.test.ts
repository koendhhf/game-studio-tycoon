/**
 * Save/load integrity. A save is the world, so "it loads and looks right" is not the bar —
 * the bar is that a loaded world is *the* world and keeps being it, and that a damaged file is
 * refused or repaired with a clear reason instead of half-loaded.
 */

import { describe, expect, it } from 'vitest';
import {
  AUTOSAVE_SLOT,
  MANUAL_SLOTS,
  SAVE_FORMAT_VERSION,
  SaveManager,
  Simulation,
  WORLD_VERSION,
  checksumOf,
  deserializeWorld,
  repairWorld,
  serializeWorld,
  stableStringify,
  toSaveText,
  fromSaveText,
} from './test-imports';
import { SAVE_MAGIC } from '../../src/save/schema';
import type { WorldState } from './test-imports';
import { addStudio, addTeam, bareWorld, soloSim } from './helpers';

function payloadOf(state: WorldState): string {
  return stableStringify({ ...state, savedAt: undefined });
}

function agedWorld(seed: number, months: number): Simulation {
  const sim = soloSim(seed);
  // Give the world something to remember: a project, a release, staff changes and a market.
  const state = sim.state;
  const studio = state.studios[state.playerStudioId];
  sim.runCommand({
    type: 'startProject',
    payload: {
      title: 'Save Me',
      genreId: 'rpg',
      platformId: 'pc',
      scope: 'small',
      budget: 120_000,
      teamIds: studio.employeeIds.slice(),
      risk: 0.4,
      marketing: 20_000,
    },
  });
  sim.runCommand({ type: 'setCrunch', projectId: studio.projectIds[0], value: true });
  sim.advanceMonths(months);
  const ready = studio.projectIds.map((id) => state.projects[id]).find((p) => p.progress >= 1);
  if (ready) sim.runCommand({ type: 'releaseGame', projectId: ready.id });
  sim.advanceMonths(2);
  return sim;
}

describe('the serialiser', () => {
  it('writes an envelope that says what it is', () => {
    const sim = agedWorld(1, 10);
    const text = serializeWorld(sim.state, 'Chapter One');
    const parsed = JSON.parse(text) as Record<string, unknown>;
    expect(parsed.magic).toBe(SAVE_MAGIC);
    expect(parsed.version).toBe(SAVE_FORMAT_VERSION);
    expect(parsed.label).toBe('Chapter One');
    expect(typeof parsed.savedAt).toBe('string');
    expect(parsed.tick).toBe(sim.state.calendar.tick);
    expect(typeof parsed.checksum).toBe('string');
    expect((parsed.checksum as string).length).toBeGreaterThan(4);
    expect(parsed.state).toBeTruthy();
    expect(text.length).toBeGreaterThan(1000);
    expect(text.length).toBeLessThan(4_000_000);
  });

  it('round-trips a live world exactly', () => {
    const sim = agedWorld(2, 14);
    const before = payloadOf(sim.state);
    const loaded = deserializeWorld(serializeWorld(sim.state, 'Round'));
    expect(loaded.error).toBeUndefined();
    expect(loaded.warnings).toEqual([]);
    expect(loaded.ok).toBe(true);
    expect(payloadOf(loaded.state!)).toBe(before);
    // Every collection the game can show survived, not just the studio.
    const state = loaded.state!;
    expect(Object.keys(state.studios).length).toBe(Object.keys(sim.state.studios).length);
    expect(Object.keys(state.employees).length).toBe(Object.keys(sim.state.employees).length);
    expect(Object.keys(state.releases).length).toBe(Object.keys(sim.state.releases).length);
    expect(Object.keys(state.projects).length).toBe(Object.keys(sim.state.projects).length);
    expect(Object.keys(state.market.genres).length).toBe(10);
    expect(state.events.entries.length).toBe(sim.state.events.entries.length);
    expect(state.calendar).toEqual(sim.state.calendar);
    expect(state.rng).toEqual(sim.state.rng);
    expect(state.config).toEqual(sim.state.config);
  });

  it('keeps the history readable: quality, reviews and sales survive intact', () => {
    const sim = agedWorld(3, 14);
    const original = Object.values(sim.state.releases)[0];
    if (!original) throw new Error('the fixture should have shipped a game');
    const state = deserializeWorld(serializeWorld(sim.state, 'History')).state!;
    const restored = state.releases[original.id];
    expect(restored).toBeTruthy();
    expect(restored.quality).toEqual(original.quality);
    expect(restored.reviews).toEqual(original.reviews);
    expect(restored.sales).toEqual(original.sales);
    expect(restored.credits).toEqual(original.credits);
    expect(restored.reception).toEqual(original.reception);
    expect(restored.reviewScore).toBe(original.reviewScore);
    expect(restored.unitsSold).toBe(original.unitsSold);
    expect(restored.releaseYear).toBe(original.releaseYear);
  });

  it('a loaded world keeps running identically to one that never stopped', () => {
    const live = agedWorld(4, 12);
    const snapshot = serializeWorld(live.state, 'Mid-game');
    const restored = Simulation.restore(deserializeWorld(snapshot).state!);
    const before = payloadOf(restored.state);
    for (let i = 0; i < 6; i += 1) {
      live.advanceMonths(1);
      restored.advanceMonths(1);
    }
    expect(payloadOf(restored.state)).not.toBe(before);
    expect(payloadOf(restored.state)).toBe(payloadOf(live.state));
    expect(restored.state.stats.ticksRun).toBe(live.state.stats.ticksRun);
  });

  it('stableStringify ignores key order but not values', () => {
    expect(stableStringify({ a: 1, b: [1, 2], c: { d: 'x' } })).toBe(stableStringify({ c: { d: 'x' }, b: [1, 2], a: 1 }));
    expect(stableStringify({ a: 1 })).not.toBe(stableStringify({ a: 2 }));
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]));
    expect(checksumOf({ a: 1, b: 2 })).toBe(checksumOf({ b: 2, a: 1 }));
    expect(checksumOf({ a: 1, b: 2 })).not.toBe(checksumOf({ a: 1, b: 3 }));
  });
});

describe('damaged files', () => {
  it('refuses to pretend nonsense is a save', () => {
    const cases: Array<[string, string]> = [
      ['', 'Not valid JSON'],
      ['not json at all', 'Not valid JSON'],
      ['{"hello":1}', 'magic'],
      [`{"magic":"${SAVE_MAGIC}","state":{}}`, 'version'],
      [`{"magic":"${SAVE_MAGIC}","version":${SAVE_FORMAT_VERSION},"state":null}`, 'no world state'],
      [JSON.stringify({ magic: SAVE_MAGIC, version: SAVE_FORMAT_VERSION + 1, state: {} }), 'newer version'],
    ];
    for (const [text, needle] of cases) {
      const result = deserializeWorld(text);
      expect(result.ok, text.slice(0, 40)).toBe(false);
      expect((result.error ?? '').toLowerCase()).toContain(needle.toLowerCase());
    }
  });

  it('notices a hand-edited payload', () => {
    const sim = soloSim(5);
    const text = serializeWorld(sim.state, 'Honest');
    const parsed = JSON.parse(text) as { state: { studios: Record<string, { cash: number }> } };
    const studioKey = Object.keys(parsed.state.studios)[0];
    parsed.state.studios[studioKey].cash += 90_000_000;
    const tampered = JSON.stringify(parsed);
    const result = deserializeWorld(tampered);
    expect(result.ok).toBe(true); // it still loads — the game does not hold money in the save
    expect(result.warnings.join(' ')).toContain('Checksum mismatch');
    expect(result.state!.studios[studioKey].cash).toBe(sim.state.studios[studioKey].cash + 90_000_000);
    // And with verification asked for explicitly the same file is accepted but flagged:
    const strict = deserializeWorld(tampered, { verifyChecksum: true });
    expect(strict.warnings.length).toBeGreaterThan(0);
    const clean = deserializeWorld(text, { verifyChecksum: true });
    expect(clean.warnings).toEqual([]);
  });

  it('survives a truncated file', () => {
    const sim = soloSim(6);
    const text = serializeWorld(sim.state, 'Whole');
    const truncated = text.slice(0, Math.floor(text.length * 0.6));
    const result = deserializeWorld(truncated);
    expect(result.ok).toBe(false);
    expect(result.error!.length).toBeGreaterThan(5);
  });
});

describe('repairing a partial world', () => {
  it('fills in what a world must always have', () => {
    const state = bareWorld(7);
    addStudio(state, { name: 'Repair Shop' });
    const stripped = JSON.parse(JSON.stringify(state)) as WorldState & { projects?: unknown };
    delete (stripped as { market?: unknown }).market;
    delete (stripped as { projects?: unknown }).projects;
    (stripped as { version?: number }).version = 0;
    const repaired = repairWorld(stripped);
    expect(repaired.fatal).toBeUndefined();
    expect(repaired.state.version).toBe(WORLD_VERSION);
    expect(repaired.state.projects).toEqual({});
    expect(Object.keys(repaired.state.market.genres).length).toBe(10);
    expect(repaired.warnings.join(' ')).toContain('Project list was missing');
    expect(repaired.warnings.join(' ')).toContain('Market data was missing');
    expect(repaired.state.calendar.tick).toBe(state.calendar.tick);
    // A rebuilt market is the same market the seed describes, so sales stay coherent.
    expect(repaired.state.market.genres.action.popularity).toBeGreaterThan(0);
  });

  it('drops references that no longer exist instead of crashing later', () => {
    const state = bareWorld(8);
    const studio = addStudio(state, { name: 'Haunt House' });
    addTeam(state, studio, ['programmer', 'designer'], 60);
    // Break every kind of reference at once.
    studio.employeeIds.push('em_ghost');
    studio.projectIds.push('pj_ghost');
    studio.releaseIds.push('rl_ghost');
    const orphan = Object.values(state.employees)[0];
    expect(orphan).toBeTruthy();
    orphan!.studioId = 'st_ghost';
    const copy = JSON.parse(JSON.stringify(state)) as WorldState;
    const repaired = repairWorld(copy);
    expect(repaired.state.studios[studio.id].employeeIds).not.toContain('em_ghost');
    expect(repaired.state.studios[studio.id].projectIds).not.toContain('pj_ghost');
    expect(repaired.state.studios[studio.id].releaseIds).not.toContain('rl_ghost');
    const repairedOrphan = Object.values(repaired.state.employees).find((e) => e.id === orphan?.id);
    expect(repairedOrphan?.studioId).toBeNull();
    // They are not lost: they come back on the market, hireable by the player or a rival.
    expect(repairedOrphan?.status).toBe('candidate');
    expect(repaired.warnings.join(' ')).toContain('open market');
    expect(repaired.warnings.join(' ')).toContain('dangling');
    // The repair is idempotent: repairing the repaired world has nothing left to say.
    const again = repairWorld(repaired.state);
    expect(again.warnings).toEqual([]);
  });

  it('refuses a world with no player studio at all', () => {
    const state = bareWorld(9);
    const copy = JSON.parse(JSON.stringify(state)) as WorldState;
    copy.studios = {};
    const repaired = repairWorld(copy);
    expect(repaired.fatal).toBeTruthy();
    expect(repaired.fatal!.length).toBeGreaterThan(5);
  });
});

describe('the save manager', () => {
  it('saves, lists, loads and removes slots', () => {
    const sim = agedWorld(10, 6);
    const manager = new SaveManager();
    expect(manager.list()).toHaveLength(0);
    const record = manager.save(MANUAL_SLOTS[0], sim.state, 'My first save');
    expect(record.slot).toBe(MANUAL_SLOTS[0]);
    expect(record.label).toBe('My first save');
    expect(record.year).toBe(sim.state.calendar.year);
    expect(record.month).toBe(sim.state.calendar.month + 1);
    expect(record.tick).toBe(sim.state.calendar.tick);
    expect(record.gamesReleased).toBe(sim.state.studios[sim.state.playerStudioId].releaseIds.length);
    expect(record.size).toBeGreaterThan(100);
    expect(record.studioName.length).toBeGreaterThan(2);

    const listed = manager.list();
    expect(listed.length).toBe(1);
    expect(listed[0].slot).toBe(MANUAL_SLOTS[0]);

    const loaded = manager.load(MANUAL_SLOTS[0]);
    expect(loaded).toBeTruthy();
    expect(payloadOf(loaded!.state)).toBe(payloadOf(sim.state));
    expect(loaded!.warnings).toEqual([]);

    manager.save(MANUAL_SLOTS[1], sim.state, 'Second');
    expect(manager.list().length).toBe(2);
    manager.remove(MANUAL_SLOTS[1]);
    expect(manager.list().length).toBe(1);
    expect(manager.load(MANUAL_SLOTS[1])).toBeNull();
    manager.clear();
    expect(manager.list()).toHaveLength(0);
  });

  it('keeps six manual slots plus an autosave, as the UI promises', () => {
    expect(MANUAL_SLOTS.length).toBe(6);
    const manager = new SaveManager();
    for (const slot of MANUAL_SLOTS) manager.save(slot, soloSim(11).state, `Slot ${slot}`);
    manager.save(AUTOSAVE_SLOT, soloSim(12).state, 'Autosave');
    const slots = manager.list().map((m) => m.slot).sort();
    expect(slots).toEqual([...MANUAL_SLOTS, AUTOSAVE_SLOT].sort());
    const autosave = manager.list().find((m) => m.slot === AUTOSAVE_SLOT);
    expect(autosave?.isAutosave).toBe(true);
    expect(manager.list().find((m) => m.slot === MANUAL_SLOTS[0])?.isAutosave).toBe(false);
  });

  it('autosaves on the interval the config asks for, not more often', () => {
    const sim = soloSim(13);
    const manager = new SaveManager();
    expect(manager.maybeAutosave(sim.state, 6)).toBe(true);
    const first = manager.list().find((m) => m.slot === AUTOSAVE_SLOT);
    expect(first).toBeTruthy();
    expect(manager.maybeAutosave(sim.state, 6)).toBe(false);
    sim.advanceMonths(5);
    expect(manager.maybeAutosave(sim.state, 6)).toBe(false);
    sim.advanceMonths(1);
    expect(manager.maybeAutosave(sim.state, 6)).toBe(true);
    expect(manager.list().filter((m) => m.slot === AUTOSAVE_SLOT)).toHaveLength(1);
    expect(manager.autosaveCounter).toBeGreaterThan(0);
    expect(sim.state.lastAutosaveMonthIndex).toBe(sim.state.calendar.monthIndex);
  });

  it('exports text that imports back into the same world', () => {
    const sim = agedWorld(14, 8);
    const manager = new SaveManager();
    manager.save(MANUAL_SLOTS[2], sim.state, 'Exported');
    const text = manager.export(MANUAL_SLOTS[2])!;
    expect(text.length).toBeGreaterThan(500);
    const imported = manager.import(text);
    expect(imported.error).toBeUndefined();
    expect(payloadOf(imported.state!)).toBe(payloadOf(sim.state));
    const viaHelpers = fromSaveText(toSaveText(sim.state, 'Plain'));
    expect(viaHelpers.error).toBeUndefined();
    expect(payloadOf(viaHelpers.state!)).toBe(payloadOf(sim.state));
    expect(manager.import('}{').error).toBeTruthy();
  });

  it('ignores files it cannot read instead of failing to start', () => {
    const broken: Record<string, string> = {
      'studio-mogul:slot1': '{ not json',
      'studio-mogul:slot2': JSON.stringify({ magic: 'other-game', version: 1, state: {} }),
      'studio-mogul:not-ours': 'whatever',
    };
    const backend = {
      read: (key: string) => broken[key] ?? null,
      write: (key: string, value: string) => {
        broken[key] = value;
      },
      remove: (key: string) => {
        delete broken[key];
      },
      keys: () => Object.keys(broken),
    };
    const manager = new SaveManager(backend);
    expect(manager.list()).toHaveLength(0);
    expect(manager.load('slot1')).toBeNull();
    manager.save('slot3', soloSim(15).state, 'Works anyway');
    expect(manager.list().length).toBe(1);
    expect(broken['studio-mogul:slot3'].length).toBeGreaterThan(100);
  });

  it('a reload of the same backend sees the same saves', () => {
    const store: Record<string, string> = {};
    const backend = {
      read: (key: string) => store[key] ?? null,
      write: (key: string, value: string) => {
        store[key] = value;
      },
      remove: (key: string) => {
        delete store[key];
      },
      keys: () => Object.keys(store),
    };
    const sim = agedWorld(16, 5);
    const writer = new SaveManager(backend);
    writer.save(MANUAL_SLOTS[3], sim.state, 'Persistent');
    const reader = new SaveManager(backend);
    const listed = reader.list();
    expect(listed).toHaveLength(1);
    expect(listed[0].label).toBe('Persistent');
    const loaded = reader.load(MANUAL_SLOTS[3]);
    expect(payloadOf(loaded!.state)).toBe(payloadOf(sim.state));
  });
});
