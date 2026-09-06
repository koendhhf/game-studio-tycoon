/**
 * Labour market: the shared candidate pool that both the player and the AI hire from.
 *
 * Graduates arrive every month, hiring studios' job listings skew the incoming batch
 * toward the roles they want and pay for, and candidates leave when they take a job
 * elsewhere or give up on the industry. This is what makes hiring feel like competition
 * rather than a shop menu.
 */

import { BALANCE } from '../data/balance';
import { clamp } from '../core/math';
import { ROLES, ROLE_ORDER } from '../data/roles';
import type { RoleId } from '../core/types';
import { createEmployee } from '../entities/factory';
import { candidatesInPool, type WorldState } from '../state/world';
import { emit } from '../operations';
import type { System, SystemContext } from './types';

export function listingBoostFor(state: WorldState, studioId: string, role: RoleId): number {
  let boost = 0;
  for (const listing of state.listings) {
    if (listing.studioId !== studioId) continue;
    if (listing.roles.length > 0 && !listing.roles.includes(role)) continue;
    boost = Math.max(boost, 0.12 + listing.prestige * 0.3);
  }
  return boost;
}

/** Overall quality tier of this month's applicant pool. */
function poolTier(state: WorldState): number {
  const health = clamp(state.market.industryAudience / 130, 0.05, 1);
  const playerRep = state.studios[state.playerStudioId]?.reputation ?? 10;
  return clamp(0.22 + health * 0.34 + (playerRep / 100) * 0.16, 0.1, 0.95);
}

export const hiringSystem: System = {
  id: 'hiring',
  order: 50,
  tick(ctx: SystemContext) {
    if (!ctx.cadence.monthStart) return;
    const state = ctx.state;
    const rng = ctx.rng;

    // Expire job listings.
    const before = state.listings.length;
    state.listings = state.listings.filter((listing) => listing.expiresMonthIndex > state.calendar.monthIndex);
    void before;

    const pool = candidatesInPool(state);
    const entrants = Math.max(
      1,
      Math.round(BALANCE.hiring.monthlyEntrants * (0.7 + Object.keys(state.studios).length / 45)),
    );
    const baseTier = poolTier(state);

    for (let i = 0; i < entrants; i++) {
      const tier = clamp(baseTier + rng.range(-0.16, 0.2), 0.05, 1);
      const candidate = createEmployee(state, rng, {
        tier,
        year: state.calendar.year,
        seniority: clamp(rng.range(0, 0.75), 0, 1),
      });
      state.employees[candidate.id] = candidate;
    }

    // Listings attract applicants aimed at the roles being chased.
    for (const listing of state.listings) {
      const roles = listing.roles.length > 0 ? listing.roles : [...ROLE_ORDER];
      const count = 1 + (rng.chance(0.4 + listing.prestige * 0.5) ? 1 : 0);
      for (let i = 0; i < count; i++) {
        const role = roles[rng.int(0, roles.length - 1)];
        const tier = clamp(0.3 + listing.prestige * 0.45 + rng.range(-0.1, 0.22), 0.05, 1);
        const candidate = createEmployee(state, rng, {
          role,
          tier,
          year: state.calendar.year,
          seniority: clamp(rng.range(0.1, 0.95), 0, 1),
        });
        state.employees[candidate.id] = candidate;
      }
    }

    // Some candidates drift out of the market.
    const current = candidatesInPool(state);
    for (const candidate of current) {
      if (rng.chance(BALANCE.hiring.attritionChance)) {
        delete state.employees[candidate.id];
      }
    }

    // Keep the pool from ballooning: surplus applicants quietly take work elsewhere.
    const overflow = candidatesInPool(state).length - Math.round(BALANCE.hiring.poolTarget * 1.8);
    if (overflow > 0) {
      const ordered = candidatesInPool(state).sort((a, b) => {
        const av = a.skills[ROLES[a.role].primary] + a.experience * 2;
        const bv = b.skills[ROLES[b.role].primary] + b.experience * 2;
        return av - bv;
      });
      for (let i = 0; i < overflow; i++) delete state.employees[ordered[i].id];
    }

    // A periodic note about the labour market, so the industry feed stays informative.
    if (state.calendar.month % 6 === 0) {
      const hotRole = rng.pick(ROLE_ORDER);
      emit(state, {
        category: 'industry',
        tone: 'neutral',
        title: `${ROLES[hotRole].name}s are ${rng.chance(0.5) ? 'in demand' : 'plentiful'} this quarter`,
        detail: `The open pool holds ${candidatesInPool(state).length} applicants across ${ROLE_ORDER.length} disciplines.`,
      });
    }
  },
};
