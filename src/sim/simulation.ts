/**
 * The Simulation: owns the world state, the RNG stream, the command queue and the
 * system pipeline. This is the only object the UI talks to, and the only place that
 * knows how time advances.
 */

import { Rng } from './core/rng';
import type { GameEvent, EventDraft } from './core/events';
import { pushEvent } from './core/events';
import { sortedIds } from './core/ids';
import { applyCommand, type Command, type CommandResult } from './commands';
import { SYSTEMS, type System, type SystemContext } from './systems';
import { allocateId, DEFAULT_CONFIG, playerStudio, type SimConfig, type WorldState } from './state/world';
import { generateWorld, type NewGameOptions } from './setup';
import { advanceCalendar, isMonthStart, isMonday, isWeekEnd, isYearStart, type CalendarState } from './core/calendar';
import type { Studio } from './entities/studio';

export interface TickReport {
  tick: number;
  events: number;
  systemsRun: number;
  commandsApplied: number;
  ms: number;
}

export class Simulation {
  state: WorldState;
  readonly systems: System[];
  private rngHandle: Rng;
  private queue: Command[] = [];
  private listeners = new Set<() => void>();
  /** Bumped on every state change so React can cheaply detect updates. */
  version = 0;
  /** When true (default) commands apply immediately; the loop disables it for determinism. */
  autoFlush = true;
  private commandsThisTick = 0;

  constructor(state: WorldState, systems: System[] = SYSTEMS) {
    this.state = state;
    this.systems = [...systems].sort((a, b) => a.order - b.order);
    this.rngHandle = new Rng(state.rng);
  }

  /** Build a brand new world from a seed. */
  static create(options: NewGameOptions = {}): Simulation {
    return new Simulation(generateWorld(options));
  }

  /** Rehydrate from a previously saved state (used by save/load and replays). */
  static restore(state: WorldState): Simulation {
    return new Simulation(state);
  }

  static newGame(seed: number, studioName: string, config: Partial<SimConfig> = {}): Simulation {
    return Simulation.create({ seed, studioName, config: { ...DEFAULT_CONFIG, ...config } });
  }

  get calendar(): CalendarState {
    return this.state.calendar;
  }

  get studio(): Studio {
    return playerStudio(this.state);
  }

  /** Days elapsed since the run began. */
  get dayCount(): number {
    return this.state.calendar.tick;
  }

  get rng(): Rng {
    return this.rngHandle;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getVersion = (): number => this.version;

  notify(): void {
    this.version += 1;
    for (const listener of this.listeners) listener();
  }

  /** Queue a player action. Applied at the next flush point so ordering stays deterministic. */
  dispatch(command: Command): void {
    this.queue.push(command);
    if (this.autoFlush) this.flush();
  }

  /** Queue several commands as a single atomic group. */
  dispatchAll(commands: readonly Command[]): void {
    this.queue.push(...commands);
    if (this.autoFlush) this.flush();
  }

  /**
   * Apply one command immediately (the UI path when the clock is paused) and report the
   * outcome. Equivalent to queueing it and letting the next tick flush it — the state
   * result is identical either way, which is what makes saves and replays trustworthy.
   */
  runCommand(command: Command): CommandResult {
    this.queue.push(command);
    const results = this.flush();
    this.notify();
    return results[0] ?? { ok: false, error: 'Command was not applied' };
  }

  get pendingCommands(): number {
    return this.queue.length;
  }

  /** Apply queued commands in arrival order. */
  flush(): CommandResult[] {
    const results: CommandResult[] = [];
    while (this.queue.length > 0) {
      const command = this.queue.shift()!;
      results.push(this.applyNow(command));
    }
    return results;
  }

  private applyNow(command: Command): CommandResult {
    try {
      const result = applyCommand(this.state, this.rngHandle, command);
      if (result.ok) {
        this.state.stats.commandsProcessed += 1;
        this.commandsThisTick += 1;
      }
      return result;
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Command failed' };
    }
  }

  emitEvent(draft: EventDraft): GameEvent {
    return pushEvent(this.state.events, () => allocateId(this.state, 'event'), this.state.calendar, {
      ...draft,
      aboutPlayer: draft.aboutPlayer ?? draft.studioIds?.includes(this.state.playerStudioId) ?? false,
    });
  }

  /** Advance exactly one in-game day. */
  tick(): TickReport {
    const startedAt = performanceNow();
    const state = this.state;
    const eventsBefore = state.events.entries.length;

    advanceCalendar(state.calendar);
    state.stats.ticksRun += 1;
    if (isMonthStart(state.calendar)) state.stats.monthsRun += 1;
    if (isYearStart(state.calendar)) state.stats.yearsRun += 1;

    const cadence = {
      monthStart: isMonthStart(state.calendar),
      weekEnd: isWeekEnd(state.calendar),
      monday: isMonday(state.calendar),
      yearStart: isYearStart(state.calendar),
    };

    this.commandsThisTick = 0;
    this.flush();

    const ctx: SystemContext = {
      state,
      rng: this.rngHandle,
      emit: (draft) => this.emitEvent(draft),
      sortedIds,
      cadence,
    };

    for (const system of this.systems) system.tick(ctx);

    return {
      tick: state.calendar.tick,
      events: state.events.entries.length - eventsBefore,
      systemsRun: this.systems.length,
      commandsApplied: this.commandsThisTick,
      ms: performanceNow() - startedAt,
    };
  }

  /** Advance n days (bounded, so a bad call cannot hang the tab). */
  advance(days: number): TickReport | null {
    const n = Math.max(0, Math.min(days, 365 * 60));
    let last: TickReport | null = null;
    this.autoFlush = false;
    for (let i = 0; i < n; i++) last = this.tick();
    this.autoFlush = true;
    this.flush();
    this.notify();
    return last;
  }

  advanceMonths(months: number): void {
    const count = Math.max(0, Math.round(months));
    this.autoFlush = false;
    for (let i = 0; i < count; i++) this.advanceUntil(isMonthStart, 31);
    this.autoFlush = true;
    this.flush();
    this.notify();
  }

  advanceYears(years: number): void {
    this.advanceMonths(Math.round(years) * 12);
  }

  /**
   * Run days until the predicate holds. Always advances at least one day, so "skip to the
   * next month start" means the next one even when today already is one.
   */
  advanceUntil(stop: (cal: CalendarState) => boolean, maxDays = 400): void {
    this.autoFlush = false;
    let days = 0;
    do {
      this.tick();
      days += 1;
    } while (days < maxDays && !stop(this.state.calendar));
    this.autoFlush = true;
    this.notify();
  }

  /** Advance one day and notify subscribers (used by the UI's step button and speed loop). */
  step(): TickReport {
    const report = this.tick();
    this.notify();
    return report;
  }

  /** Replace the world (save loading). */
  replaceState(state: WorldState): void {
    this.state = state;
    this.rngHandle = new Rng(state.rng);
    this.queue = [];
    this.notify();
  }
}

function performanceNow(): number {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}
