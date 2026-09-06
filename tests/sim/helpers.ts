/**
 * Shared test scaffolding. Tests build tiny, fully-controlled worlds through the same
 * factories the game uses, so a change to an entity shape breaks the tests loudly instead
 * of silently making them vacuous.
 */

import {
  allocateId,
  Simulation,
  createStudio,
  DEFAULT_CONFIG,
  QUALITY_DIMENSIONS,
  attachEmployee,
  createMarketState,
  createWorld,
  Rng,
  createRngState,
  randFor,
} from './test-imports';
import type { Employee, QualityDimensionId, RoleId, ScopeId, Studio, WorldState } from './test-imports';

export type { Employee, QualityDimensionId, RoleId, ScopeId, Studio, WorldState };

/** An empty world: no AI studios, no starter team, no seeded history — but a real market. */
export function bareWorld(seed = 7): WorldState {
  const state = createWorld(seed, { ...DEFAULT_CONFIG, aiStudioCount: 0, aiStudioTarget: 0 });
  state.rng = createRngState(seed);
  state.market = createMarketState(state.calendar.year, seed, (key) => randFor(seed, key));
  state.playerStudioId = '' as never;
  return state;
}

export function testRng(seed = 1234): Rng {
  return new Rng(createRngState(seed));
}

export function addStudio(state: WorldState, opts: { name?: string; isPlayer?: boolean; cash?: number; reputation?: number } = {}): Studio {
  const studio = createStudio(state, testRng(99), {
    name: opts.name ?? 'Test Studio',
    isPlayer: opts.isPlayer ?? true,
    foundedYear: state.calendar.year,
    cash: opts.cash ?? 500_000,
    reputation: opts.reputation ?? 20,
  });
  if (studio.isPlayer) state.playerStudioId = studio.id;
  return studio;
}

/** A person with exact skills, so model tests are arithmetic rather than statistical. */
export function addEmployee(
  state: WorldState,
  studio: Studio | null,
  opts: {
    role: RoleId;
    skills?: Partial<Record<QualityDimensionId, number>>;
    salary?: number;
    morale?: number;
    loyalty?: number;
    experience?: number;
    traits?: string[];
    name?: string;
    potential?: number;
    preferredGenre?: Employee['preferredGenre'];
  },
): Employee {
  const skills = {} as Record<QualityDimensionId, number>;
  for (const dim of QUALITY_DIMENSIONS) skills[dim] = opts.skills?.[dim] ?? 50;
  const emp: Employee = {
    id: allocateId(state, 'employee'),
    name: opts.name ?? `Person ${Object.keys(state.employees).length + 1}`,
    role: opts.role,
    skills,
    potential: opts.potential ?? 1,
    salary: opts.salary ?? 2500,
    experience: opts.experience ?? 5,
    morale: opts.morale ?? 70,
    loyalty: opts.loyalty ?? 60,
    traits: opts.traits ?? [],
    studioId: studio?.id ?? null,
    hiredTick: state.calendar.tick,
    status: studio ? 'employed' : 'candidate',
    workUnitsShipped: 0,
    gamesShipped: 0,
    bestReviewScore: 0,
    preferredGenre: opts.preferredGenre ?? null,
  };
  state.employees[emp.id] = emp;
  if (studio) attachEmployee(state, studio, emp);
  return emp;
}

/** A team with the given roles, all at `skill` in every dimension. */
export function addTeam(state: WorldState, studio: Studio, roles: readonly RoleId[], skill = 60): Employee[] {
  return roles.map((role) =>
    addEmployee(state, studio, {
      role,
      skills: Object.fromEntries(QUALITY_DIMENSIONS.map((dim) => [dim, skill])) as Record<QualityDimensionId, number>,
      salary: Math.round(900 + skill * 32),
    }),
  );
}

export const SMALL: ScopeId = 'small';

/**
 * A world with the player's starter studio but no competing AI: enough to exercise the
 * systems honestly, small enough that a test can assert on it deterministically.
 */
export function soloSim(seed = 5, name = 'Solo Studio'): import('../../src/sim').Simulation {
  return Simulation.create({ seed, studioName: name, config: { aiStudioCount: 0, aiStudioTarget: 0 } });
}
