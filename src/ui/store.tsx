/**
 * React binding for the engine.
 *
 * The UI layer holds a Simulation and nothing else: it reads the world state for display
 * and sends Commands in. There is deliberately no game rule in this file (or in any
 * component) — that is what keeps the simulation testable without a browser.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Simulation } from '../sim/simulation';
import type { Command, CommandResult } from '../sim/commands';
import type { WorldState } from '../sim/state/world';
import { BALANCE } from '../sim/data/balance';
import { SaveManager, AUTOSAVE_SLOT } from '../save/storage';
import type { SaveMeta } from '../save/storage';

export const SPEEDS = [
  { label: 'Pause', ms: 0 },
  { label: '1×', ms: 420 },
  { label: '2×', ms: 190 },
  { label: '4×', ms: 70 },
] as const;

export interface GameApi {
  sim: Simulation;
  state: WorldState;
  version: number;
  speed: number;
  setSpeed: (index: number) => void;
  step: (days?: number) => void;
  dispatch: (command: Command) => CommandResult;
  lastMessage: { text: string; ok: boolean } | null;
  saves: SaveMeta[];
  saveTo: (slot: string, label?: string) => void;
  loadFrom: (slot: string) => void;
  deleteSave: (slot: string) => void;
  exportText: () => string;
  importText: (text: string) => { ok: boolean; message: string };
  restart: (seed: number, name: string) => void;
  bankrupt: boolean;
}

const GameContext = createContext<GameApi | null>(null);

export function GameProvider({ children, initial }: { children: React.ReactNode; initial?: Simulation }): React.JSX.Element {
  const [sim, setSim] = useState<Simulation>(() => initial ?? Simulation.newGame(defaultSeed(), 'Mogul Works'));
  const [speed, setSpeed] = useState(1);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [saves, setSaves] = useState<SaveMeta[]>([]);
  const managerRef = useRef<SaveManager | null>(null);
  if (!managerRef.current) managerRef.current = new SaveManager();

  const version = useSyncExternalStore(
    useCallback((onChange: () => void) => sim.subscribe(onChange), [sim]),
    useCallback(() => sim.getVersion(), [sim]),
    // Server snapshot: the app is renderable outside a browser (used by the render smoke test).
    useCallback(() => sim.getVersion(), [sim]),
  );

  const state = sim.state;
  const bankrupt = state.studios[state.playerStudioId]?.status !== 'active';

  const refreshSaves = useCallback(() => setSaves(managerRef.current!.list()), []);
  useEffect(refreshSaves, [refreshSaves]);

  // Game clock: one tick per interval at the selected speed.
  useEffect(() => {
    if (speed === 0 || bankrupt) return;
    const delay = SPEEDS[speed].ms;
    const handle = window.setInterval(() => {
      sim.step();
      const monthStart = sim.state.calendar.day === 1;
      if (monthStart) {
        const manager = managerRef.current!;
        if (manager.maybeAutosave(sim.state, BALANCE.save.autosaveEveryMonths)) refreshSaves();
      }
    }, delay);
    return () => window.clearInterval(handle);
  }, [speed, sim, bankrupt, refreshSaves]);

  useEffect(() => {
    if (bankrupt && speed !== 0) setSpeed(0);
  }, [bankrupt, speed]);

  const dispatch = useCallback(
    (command: Command): CommandResult => {
      const result = sim.runCommand(command);
      if (!result.ok) setMessage({ text: result.error ?? 'Action refused', ok: false });
      else if (result.detail) setMessage({ text: result.detail, ok: true });
      else setMessage(null);
      return result;
    },
    [sim],
  );

  const value = useMemo<GameApi>(
    () => ({
      sim,
      state,
      version,
      speed,
      setSpeed,
      step: (days = 1) => {
        for (let i = 0; i < days; i++) sim.step();
      },
      dispatch,
      lastMessage: message,
      saves,
      saveTo: (slot, label) => {
        managerRef.current!.save(slot, sim.state, label ?? `${sim.state.studios[sim.state.playerStudioId]?.name ?? 'Save'} · ${sim.state.calendar.year}`);
        refreshSaves();
      },
      loadFrom: (slot) => {
        const loaded = managerRef.current!.load(slot);
        if (!loaded) {
          setMessage({ text: 'No save in that slot', ok: false });
          return;
        }
        setSim(Simulation.restore(loaded.state));
        setSpeed(0);
        setMessage({ text: loaded.warnings.length > 0 ? `Loaded (${loaded.warnings.length} note${loaded.warnings.length > 1 ? 's' : ''})` : 'Game loaded', ok: true });
      },
      deleteSave: (slot) => {
        managerRef.current!.remove(slot);
        refreshSaves();
      },
      exportText: () => managerRef.current!.export(AUTOSAVE_SLOT) ?? '',
      importText: (text) => {
        const result = managerRef.current!.import(text);
        if (result.error || !result.state) return { ok: false, message: result.error ?? 'Unreadable save data' };
        setSim(Simulation.restore(result.state));
        setSpeed(0);
        refreshSaves();
        return { ok: true, message: 'Save imported' };
      },
      restart: (seed, name) => {
        setSim(Simulation.newGame(seed, name));
        setSpeed(0);
        setMessage({ text: 'New game started', ok: true });
      },
      bankrupt,
    }),
    [sim, state, version, speed, dispatch, message, saves, refreshSaves, bankrupt],
  );

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}

export function useGame(): GameApi {
  const api = useContext(GameContext);
  if (!api) throw new Error('useGame must be used inside <GameProvider>');
  return api;
}

/** Fresh seed for a browser session; deterministic once chosen. */
export function defaultSeed(): number {
  const stored = typeof localStorage !== 'undefined' ? localStorage.getItem('studio-mogul:last-seed') : null;
  if (stored && !Number.isNaN(Number(stored))) return Number(stored);
  const seed = Math.floor(Math.random() * 900000) + 1000;
  try {
    localStorage?.setItem('studio-mogul:last-seed', String(seed));
  } catch {
    /* private mode: just use it for this session */
  }
  return seed;
}
