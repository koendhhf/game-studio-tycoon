/**
 * Employee system: daily morale/skill upkeep for people who are *not* on a project,
 * plus weekly resignation checks. People who are working are handled by the
 * development system, so nobody gets double-counted.
 */

import { BALANCE } from '../data/balance';
import { clamp } from '../core/math';
import { compareIds } from '../core/ids';
import { payRatio } from '../entities/employee';
import { moraleDrift } from '../models/employee-model';
import { emit } from '../operations';
import type { WorldState } from '../state/world';
import type { System, SystemContext } from './types';

/** Ids of every employee currently assigned to a live project. */
export function busyEmployeeIds(state: WorldState): Set<string> {
  const busy = new Set<string>();
  for (const id of Object.keys(state.projects).sort(compareIds)) {
    const project = state.projects[id];
    if (!project || project.status === 'released' || project.status === 'cancelled') continue;
    for (const empId of project.teamIds) busy.add(empId);
  }
  return busy;
}

export const employeeSystem: System = {
  id: 'employees',
  order: 15,
  tick(ctx: SystemContext) {
    const state = ctx.state;
    const busy = busyEmployeeIds(state);

    for (const id of ctx.sortedIds(state.employees)) {
      const emp = state.employees[id];
      if (!emp || emp.studioId === null) continue;
      const studio = state.studios[emp.studioId];
      if (!studio || studio.status !== 'active') continue;

      if (!busy.has(emp.id)) {
        // On the bench: skills rust slowly, morale sinks, and idle people get headhunted.
        emp.morale = clamp(
          emp.morale +
            moraleDrift(emp, {
              working: false,
              overwork: 0,
              crunch: false,
              cashCrisis: studio.cash < 0,
              moraleShield: 1,
              teamMorale: 60,
            }),
          0,
          100,
        );
      }

      if (ctx.cadence.weekEnd) {
        const unhappy = emp.morale < 12 && payRatio(emp) < 0.92;
        const broke = studio.monthsBroke > BALANCE.studio.quitCashMonths && emp.morale < 28;
        const risk = unhappy ? 0.012 : broke ? 0.01 : 0;
        if (risk > 0 && ctx.rng.chance(risk)) {
          emp.status = 'candidate';
          emp.studioId = null;
          emp.morale = clamp(emp.morale + 8, 0, 100);
          studio.employeeIds = studio.employeeIds.filter((sid) => sid !== emp.id);
          for (const projectId of studio.projectIds) {
            const project = state.projects[projectId];
            if (project) project.teamIds = project.teamIds.filter((tid) => tid !== emp.id);
          }
          emit(state, {
            category: 'employee',
            tone: 'negative',
            studioIds: [studio.id],
            title: `${emp.name} quit ${studio.name}`,
            detail: `${BALANCE.employee.moraleTarget > emp.morale ? 'Morale was ' : 'Unhappy at '}${Math.round(emp.morale)} and pay was ${Math.round(payRatio(emp) * 100)}% of market rate.`,
          });
        }
        // Loyalty slowly recovers toward neutral when people are treated well.
        if (payRatio(emp) > 1.05 && emp.morale > 65) {
          emp.loyalty = clamp(emp.loyalty + 0.4, 0, 100);
        }
      }
    }
  },
};
