/**
 * The world state: one plain, JSON-serializable object containing everything the
 * simulation knows. No classes, no functions, no Maps, no cycles-by-reference
 * other than id lookups. This is the save file, the UI snapshot source, and the
 * thing tests assert against.
 */

import { createCalendar, type CalendarState } from '../core/calendar';
import { createEventLog, type EventLogState } from '../core/events';
import { compareIds, formatId, type EntityKind } from '../core/ids';
import type { RngState } from '../core/rng';
import type { EmployeeId, GenreId, ProjectId, ReleaseId, RoleId, StudioId } from '../core/types';
import type { Employee } from '../entities/employee';
import type { Project } from '../entities/project';
import type { ReleasedGame } from '../entities/game';
import type { MarketState } from '../entities/market';
import type { Studio } from '../entities/studio';
import { BALANCE } from '../data/balance';

export const WORLD_VERSION = 1;

export interface SimConfig {
  /** Year the player founds their studio. */
  startYear: number;
  /** Number of AI-controlled competitors generated at world creation. */
  aiStudioCount: number;
  /** Target live AI studio count (the industry grows/shrinks around this). */
  aiStudioTarget: number;
  /** Player's starting bankroll. */
  startingCash: number;
  /** Player's starting reputation. */
  startingReputation: number;
  /** How many people the player starts with. Their first project is their own decision. */
  startingEmployees: number;
}

export const DEFAULT_CONFIG: SimConfig = {
  startYear: 1990,
  // The economy knobs live in data/balance.ts; the config only mirrors them so a saved
  // game carries the numbers it was played with even if balance later changes.
  aiStudioCount: BALANCE.studio.aiCount,
  aiStudioTarget: BALANCE.studio.aiCount,
  startingCash: BALANCE.studio.startingCash,
  startingReputation: BALANCE.studio.repStartPlayer,
  startingEmployees: BALANCE.studio.playerStartStaff,
};

export interface SimStats {
  ticksRun: number;
  monthsRun: number;
  yearsRun: number;
  gamesReleasedByPlayer: number;
  gamesReleasedTotal: number;
  aiActionsTaken: number;
  commandsProcessed: number;
  studiosFounded: number;
  studiosClosed: number;
  /** Last measured milliseconds per tick, for the debug strip. */
  lastTickMs: number;
}

/** Global, tick-scoped counters the finance/economy systems keep. */
export interface EconomyState {
  /** Indexing into a price level so late-game money is not trivially easy. */
  priceLevel: number;
  /** Average industry salary level, drifting up over the decades. */
  wageIndex: number;
  lastInterestMonthIndex: number;
}

export interface JobListing {
  id: string;
  studioId: StudioId;
  /** Roles the listing is chasing; empty means "whoever applies". */
  roles: RoleId[];
  /** 0..1 — paying for a better ad raises the tier of applicants. */
  prestige: number;
  postedMonthIndex: number;
  expiresMonthIndex: number;
  cost: number;
}

export interface WorldState {
  version: number;
  seed: number;
  config: SimConfig;
  calendar: CalendarState;
  rng: RngState;
  nextId: number;
  playerStudioId: StudioId;
  studios: Record<StudioId, Studio>;
  employees: Record<EmployeeId, Employee>;
  projects: Record<ProjectId, Project>;
  releases: Record<ReleaseId, ReleasedGame>;
  market: MarketState;
  events: EventLogState;
  stats: SimStats;
  economy: EconomyState;
  /** Active job listings: posting one biases the next candidate batch toward it. */
  listings: JobListing[];
  /** Autosave bookkeeping. */
  lastAutosaveMonthIndex: number;
}

export function allocateId(state: WorldState, kind: EntityKind): string {
  const n = state.nextId;
  state.nextId = n + 1;
  return formatId(kind, n);
}

export function createWorld(seed: number, config: SimConfig): WorldState {
  return {
    version: WORLD_VERSION,
    seed,
    config,
    calendar: createCalendar({ year: config.startYear, month: 0, day: 1 }),
    rng: { a: 0, b: 0, c: 0, d: 0 },
    nextId: 1,
    playerStudioId: 'st1',
    studios: {},
    employees: {},
    projects: {},
    releases: {},
    market: {
      genres: {} as WorldState['market']['genres'],
      modifiers: [],
      industryAudience: 0,
      industryAudienceLastYear: 0,
      talkingAboutReleaseId: null,
      talkingAboutLabel: '',
      lastUpdatedMonthIndex: 0,
    },
    events: createEventLog(),
    stats: {
      ticksRun: 0,
      monthsRun: 0,
      yearsRun: 0,
      gamesReleasedByPlayer: 0,
      gamesReleasedTotal: 0,
      aiActionsTaken: 0,
      commandsProcessed: 0,
      studiosFounded: 0,
      studiosClosed: 0,
      lastTickMs: 0,
    },
    economy: { priceLevel: 1, wageIndex: 1, lastInterestMonthIndex: 0 },
    listings: [],
    lastAutosaveMonthIndex: 0,
  };
}

export function studioOf(state: WorldState, id: StudioId): Studio | undefined {
  return state.studios[id];
}

export function playerStudio(state: WorldState): Studio {
  const studio = state.studios[state.playerStudioId];
  if (!studio) throw new Error(`Player studio ${state.playerStudioId} missing from world state`);
  return studio;
}

export function employeeOf(state: WorldState, id: EmployeeId): Employee | undefined {
  return state.employees[id];
}

export function projectOf(state: WorldState, id: ProjectId): Project | undefined {
  return state.projects[id];
}

export function employeesOfStudio(state: WorldState, studioId: StudioId): Employee[] {
  const studio = state.studios[studioId];
  if (!studio) return [];
  return studio.employeeIds
    .slice()
    .sort(compareIds)
    .map((id) => state.employees[id])
    .filter((e): e is Employee => Boolean(e));
}

export function candidatesInPool(state: WorldState): Employee[] {
  return Object.values(state.employees)
    .filter((e) => e.status === 'candidate' && e.studioId === null)
    .sort((a, b) => compareIds(a.id, b.id));
}

export function projectsOfStudio(state: WorldState, studioId: StudioId): Project[] {
  const studio = state.studios[studioId];
  if (!studio) return [];
  return studio.projectIds
    .slice()
    .sort(compareIds)
    .map((id) => state.projects[id])
    .filter((p): p is Project => Boolean(p) && p.status !== 'released' && p.status !== 'cancelled');
}

export function releasesOfStudio(state: WorldState, studioId: StudioId): ReleasedGame[] {
  const studio = state.studios[studioId];
  if (!studio) return [];
  return studio.releaseIds
    .slice()
    .sort(compareIds)
    .map((id) => state.releases[id])
    .filter((g): g is ReleasedGame => Boolean(g));
}

export function allReleasedGames(state: WorldState): ReleasedGame[] {
  return Object.values(state.releases).sort((a, b) => b.releaseTick - a.releaseTick || compareIds(a.id, b.id));
}

export function activeStudios(state: WorldState): Studio[] {
  return Object.values(state.studios)
    .filter((s) => s.status === 'active')
    .sort((a, b) => compareIds(a.id, b.id));
}

export function aiStudios(state: WorldState): Studio[] {
  return activeStudios(state).filter((s) => !s.isPlayer);
}

export function roleCounts(state: WorldState, studioId: StudioId): Record<RoleId, number> {
  const counts = { programmer: 0, designer: 0, artist: 0, writer: 0, audio: 0, producer: 0, qa: 0 } as Record<RoleId, number>;
  for (const e of employeesOfStudio(state, studioId)) counts[e.role] += 1;
  return counts;
}

export function monthlySalaryBill(state: WorldState, studioId: StudioId): number {
  let total = 0;
  for (const e of employeesOfStudio(state, studioId)) total += e.salary;
  return total;
}

export function monthlyOverhead(state: WorldState, studioId: StudioId): number {
  const headcount = employeesOfStudio(state, studioId).length;
  return BALANCE.studio.overheadBase + headcount * BALANCE.studio.overheadPerEmployee;
}

/** Fixed monthly cost of keeping a studio alive, before project burn. */
export function monthlyBurn(state: WorldState, studioId: StudioId): number {
  return monthlySalaryBill(state, studioId) + monthlyOverhead(state, studioId);
}

export function genreMarketOf(state: WorldState, genreId: GenreId) {
  return state.market.genres[genreId];
}
