/**
 * Economy system: monthly payroll, overhead, ledger close, financing and solvency.
 * Applied identically to the player and to every AI studio.
 */

import { BALANCE } from '../data/balance';
import { clamp } from '../core/math';
import { closeMonth, emit, payMonthlyCosts } from '../operations';
import { activeStudios, employeesOfStudio, monthlyBurn, type WorldState } from '../state/world';
import type { System, SystemContext } from './types';

/** Monthly rate on reserves (reward) and on overdrafts (punishment). */
const CREDIT_RATE = 0.0035;
const OVERDRAFT_RATE = 0.009;

function studioMonth(state: WorldState, studioId: string): void {
  const s = state.studios[studioId];
  if (!s || s.status !== 'active') return;

  payMonthlyCosts(state, s);

  // Financing: positive interest is booked as a reduction of "other" costs.
  const interest = s.cash >= 0 ? s.cash * CREDIT_RATE : s.cash * OVERDRAFT_RATE;
  s.cash += interest;
  s.finances.current.other -= interest;
  s.finances.lifetime.other -= interest;

  closeMonth(state, s, state.calendar);

  if (s.cash < 0) {
    s.monthsBroke += 1;
    if (s.monthsBroke === 1) {
      emit(state, {
        category: 'finance',
        tone: 'negative',
        studioIds: [s.id],
        title: `${s.name} finished the month in the red`,
        detail: `Cash ${Math.round(s.cash).toLocaleString('en-US')} against a monthly burn of ${Math.round(monthlyBurn(state, s.id)).toLocaleString('en-US')}.`,
      });
    }
  } else if (s.monthsBroke > 0) {
    s.monthsBroke = 0;
  }

  // Years without a release quietly erode a name.
  const monthsSinceRelease = s.lastReleaseTick < 0 ? 999 : (state.calendar.tick - s.lastReleaseTick) / 30;
  if (monthsSinceRelease > 30 && s.reputation > BALANCE.studio.repStartPlayer) {
    s.reputation = clamp(s.reputation - BALANCE.studio.repDecayPerYear / 12, BALANCE.studio.repMin, BALANCE.studio.repMax);
  }
}

/** Everyone expects a raise eventually; this keeps salaries roughly in step with the era. */
function applyWageDrift(state: WorldState): void {
  const factor = 1 + Math.min(0.06, (state.economy.wageIndex - 1) * 0.03 + 0.014);
  for (const s of activeStudios(state)) {
    for (const emp of employeesOfStudio(state, s.id)) {
      emp.salary = Math.round(emp.salary * factor);
    }
  }
}

export const economySystem: System = {
  id: 'economy',
  order: 20,
  tick(ctx: SystemContext) {
    if (!ctx.cadence.monthStart) return;
    const state = ctx.state;
    for (const s of activeStudios(state)) studioMonth(state, s.id);

    if (ctx.cadence.yearStart) {
      // Industry-wide price/wage drift: the 2000s are not the 1990s with bigger numbers.
      state.economy.priceLevel *= 1.021;
      state.economy.wageIndex *= 1.033;
      applyWageDrift(state);
    }
  },
};

/** Studios broke for too long shut down and release their staff to the open market. */
export const solvencySystem: System = {
  id: 'solvency',
  order: 25,
  tick(ctx: SystemContext) {
    if (!ctx.cadence.monthStart) return;
    const state = ctx.state;
    for (const s of activeStudios(state)) {
      const grace = s.isPlayer ? BALANCE.studio.playerGraceMonths : BALANCE.studio.graceMonths;
      if (s.monthsBroke < grace) continue;
      if (s.isPlayer) {
        emit(state, {
          category: 'finance',
          tone: 'negative',
          studioIds: [s.id],
          title: `${s.name} is bankrupt`,
          detail: `${BALANCE.studio.playerGraceMonths} consecutive months without cash to pay the bills. The studio is closed and the staff have gone to the open market.`,
        });
      }
      shutDownStudio(state, s.id);
    }
  },
};

export function shutDownStudio(state: WorldState, studioId: string): void {
  const s = state.studios[studioId];
  if (!s || s.status !== 'active') return;

  const staffCount = s.employeeIds.length;
  s.status = 'defunct';
  s.defunctTick = state.calendar.tick;
  state.stats.studiosClosed += 1;

  // Staff hit the open market — the player can hire the survivors.
  for (const empId of [...s.employeeIds].sort()) {
    const emp = state.employees[empId];
    if (emp) {
      emp.studioId = null;
      emp.status = 'candidate';
      emp.morale = clamp(emp.morale - 14, 0, 100);
      emp.loyalty = clamp(emp.loyalty - 5, 0, 100);
    }
    s.employeeIds = s.employeeIds.filter((id) => id !== empId);
  }

  for (const projectId of [...s.projectIds]) {
    const project = state.projects[projectId];
    if (project) {
      project.status = 'cancelled';
      project.teamIds = [];
      emit(state, {
        category: 'industry',
        tone: 'negative',
        studioIds: [s.id],
        title: `${s.name} cancelled "${project.title}"`,
        detail: 'The studio could not fund it to completion.',
      });
    }
    s.projectIds = s.projectIds.filter((id) => id !== projectId);
  }

  emit(state, {
    category: 'industry',
    tone: 'negative',
    studioIds: [s.id],
    title: `${s.name} has closed its doors`,
    detail: `${s.releaseIds.length} released games, founded ${s.foundedYear}${staffCount > 0 ? `, ${staffCount} staff now looking for work` : ''}.`,
  });
}
