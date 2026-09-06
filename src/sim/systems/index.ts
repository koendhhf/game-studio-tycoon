/**
 * System registry. Order matters: money and releases must be settled in the same
 * sequence every tick for the simulation to be reproducible.
 */

import type { System } from './types';
import { developmentSystem } from './development';
import { employeeSystem } from './employees';
import { economySystem, solvencySystem } from './economy';
import { salesSystem } from './sales';
import { marketSystem } from './market';
import { hiringSystem } from './hiring';
import { aiSystem } from './ai';

export const SYSTEMS: System[] = [
  developmentSystem,
  employeeSystem,
  economySystem,
  solvencySystem,
  salesSystem,
  marketSystem,
  hiringSystem,
  aiSystem,
].sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1));

export function systemIds(systems: System[] = SYSTEMS): string[] {
  return systems.map((s) => s.id);
}

export type { System, SystemContext } from './types';
