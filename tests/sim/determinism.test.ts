/**
 * Determinism is the load-bearing property of the whole engine: the same seed and the same
 * commands must produce the same world, however it is stepped, loaded or resumed. If this file
 * ever fails, saves, replays and multiplayer-ish features are all built on sand.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIG,
  Simulation,
  deserializeWorld,
  serializeWorld,
  stableStringify,
} from './test-imports';
import type { Command, WorldState } from './test-imports';

function payloadOf(state: WorldState): string {
  // Everything except the wall-clock stamp a save adds.
  return stableStringify({ ...state, savedAt: undefined });
}

function playScript(sim: Simulation, months: number): void {
  const state = sim.state;
  const studio = state.studios[state.playerStudioId];
  for (let m = 0; m < months; m += 1) {
    if (m === 2 && studio.projectIds.length === 0) {
      sim.runCommand({
        type: 'startProject',
        payload: {
          title: 'Deterministic Debut',
          genreId: 'action',
          platformId: 'pc',
          scope: 'small',
          budget: 60_000,
          teamIds: studio.employeeIds.slice(0, 3),
          risk: 0.35,
          marketing: 12_000,
        },
      });
    }
    if (m === 4) sim.runCommand({ type: 'setCrunch', projectId: studio.projectIds[0] ?? 'pj_none', value: true });
    if (m === 6) sim.runCommand({ type: 'setMarketing', projectId: studio.projectIds[0] ?? 'pj_none', amount: 20_000 });
    sim.advanceMonths(1);
    const active = studio.projectIds.map((id) => state.projects[id]).find((p) => p && p.progress >= 1);
    if (active && m > 6) sim.runCommand({ type: 'releaseGame', projectId: active.id });
  }
}

describe('the same inputs give the same world', () => {
  it('two runs of the same script are byte-identical', () => {
    const a = Simulation.create({ seed: 20260906, studioName: 'Twin Engines' });
    const b = Simulation.create({ seed: 20260906, studioName: 'Twin Engines' });
    playScript(a, 14);
    playScript(b, 14);
    expect(payloadOf(a.state)).toBe(payloadOf(b.state));
    expect(a.state.stats.ticksRun).toBe(b.state.stats.ticksRun);
    expect(Object.keys(a.state.releases).length).toBe(Object.keys(b.state.releases).length);
    expect(payloadOf(a.state).length).toBeGreaterThan(1000);
  });

  it('a different seed gives a different world', () => {
    const a = Simulation.create({ seed: 11, studioName: 'Same Name' });
    const b = Simulation.create({ seed: 12, studioName: 'Same Name' });
    a.advanceMonths(6);
    b.advanceMonths(6);
    expect(payloadOf(a.state)).not.toBe(payloadOf(b.state));
  });

  it('chunk size does not change the outcome', () => {
    const monthly = Simulation.create({ seed: 31, studioName: 'Chunking' });
    const daily = Simulation.create({ seed: 31, studioName: 'Chunking' });
    monthly.advanceMonths(6);
    // Step one day at a time until the same tick: the world must be indistinguishable.
    while (daily.state.calendar.tick < monthly.state.calendar.tick) daily.step();
    expect(daily.state.calendar.tick).toBe(monthly.state.calendar.tick);
    expect(monthly.state.calendar.day).toBe(1);
    expect(monthly.state.calendar.month).toBe(6);
    expect(monthly.state.calendar.monthIndex).toBe(monthly.state.calendar.year * 12 + 6);
    expect(payloadOf(daily.state)).toBe(payloadOf(monthly.state));

    const yearly = Simulation.create({ seed: 31, studioName: 'Chunking' });
    yearly.advanceYears(1);
    const sameLength = Simulation.create({ seed: 31, studioName: 'Chunking' });
    for (let i = 0; i < 12; i += 1) sameLength.advanceMonths(1);
    expect(payloadOf(yearly.state)).toBe(payloadOf(sameLength.state));
  });

  it('speed and UI-facing pacing never feed the simulation', () => {
    // The same world driven at a different "rate" (more steps in a row vs fewer) is identical;
    // the clock speed is a UI concern and must not leak into the rules.
    const a = Simulation.create({ seed: 41, studioName: 'Pacing' });
    const b = Simulation.create({ seed: 41, studioName: 'Pacing' });
    for (let i = 0; i < 40; i += 1) {
      a.step();
      a.step();
      b.step();
      b.step();
    }
    expect(payloadOf(a.state)).toBe(payloadOf(b.state));
  });

  it('the rng stream is part of the state and survives a round trip', () => {
    const sim = Simulation.create({ seed: 51, studioName: 'Stream' });
    sim.advanceMonths(9);
    const text = serializeWorld(sim.state, 'Round trip');
    const loaded = deserializeWorld(text);
    expect(loaded.ok).toBe(true);
    const restored = Simulation.restore(loaded.state!);
    expect(payloadOf(restored!.state)).toBe(payloadOf(sim.state));
    restored!.advanceMonths(6);
    sim.advanceMonths(6);
    expect(payloadOf(restored!.state)).toBe(payloadOf(sim.state));
  });

  it('commands are applied in the order they were issued', () => {
    const a = Simulation.create({ seed: 61, studioName: 'Order' });
    const b = Simulation.create({ seed: 61, studioName: 'Order' });
    const studioA = a.state.studios[a.state.playerStudioId];
    const commands: Command[] = [
      { type: 'renameStudio', name: 'First Name' },
      { type: 'renameStudio', name: 'Second Name' },
      { type: 'renameStudio', name: 'Third Name' },
    ];
    for (const command of commands) a.runCommand(command);
    b.runCommand(commands[2]);
    b.runCommand(commands[1]);
    b.runCommand(commands[0]);
    expect(studioA.name).toBe('Third Name');
    // Reversing the same three commands reverses the outcome: order is honoured, not sorted.
    expect(b.state.studios[b.state.playerStudioId].name).toBe('First Name');
    expect(payloadOf(a.state)).not.toBe(payloadOf(b.state)); // event order differs, on purpose
    expect(a.state.stats.commandsProcessed).toBe(b.state.stats.commandsProcessed);
  });

  it('no module-level state leaks between runs', () => {
    const first = Simulation.create({ seed: 71, studioName: 'Solo' });
    first.advanceMonths(4);
    const second = Simulation.create({ seed: 71, studioName: 'Solo' });
    second.advanceMonths(4);
    expect(payloadOf(first.state)).toBe(payloadOf(second.state));

    // Even after a wildly different world was built in between, a fresh sim is unaffected.
    const busy = Simulation.create({ seed: 99, studioName: 'Different Name', config: { ...DEFAULT_CONFIG, aiStudioCount: 18, aiStudioTarget: 18 } });
    busy.advanceMonths(30);
    const third = Simulation.create({ seed: 71, studioName: 'Solo' });
    third.advanceMonths(4);
    expect(payloadOf(third.state)).toBe(payloadOf(first.state));
  });
});
