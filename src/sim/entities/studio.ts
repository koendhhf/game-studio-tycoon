/**
 * Studio entity — used for both the player's company and AI-controlled rivals.
 * The only difference is `isPlayer` and the presence of an `ai` profile.
 */

import type { GenreId, StudioId, ProjectId, ReleaseId, EmployeeId } from '../core/types';
import { GENRE_ORDER } from '../data/genres';

export type StudioStatus = 'active' | 'defunct' | 'acquired';

export interface AiProfile {
  /** 0..1 — how much cash they will risk on a project. */
  ambition: number;
  /** 0..1 — willingness to attempt something novel. */
  riskAppetite: number;
  /** 0..1 — quality-maximising vs ship-early. */
  qualityFocus: number;
  /** 0..1 — marketing spender vs "the game sells itself". */
  marketingFocus: number;
  /** 0..1 — propensity to grow headcount. */
  hiringAppetite: number;
  /** 0..1 — how quickly they abandon a genre when the market turns. */
  adaptability: number;
  /** 0..1 — loyalty of their staff policy (layoffs vs ride-it-out). */
  loyalty: number;
  /** Genres they over-index on. */
  preferredGenres: GenreId[];
  /** House style label shown in the Industry screen. */
  style: string;
  /** Tagline/flavour. */
  tagline: string;
}

export interface MonthLedger {
  year: number;
  month: number;
  openingCash: number;
  revenue: number;
  salaries: number;
  overhead: number;
  development: number;
  marketing: number;
  other: number;
  net: number;
  closingCash: number;
}

export interface FinanceLedger {
  /** Rolling monthly history (oldest first). */
  months: MonthLedger[];
  /** Accumulators for the month currently in progress. */
  current: Omit<MonthLedger, 'year' | 'month' | 'openingCash' | 'closingCash' | 'net'>;
  lifetime: {
    revenue: number;
    salaries: number;
    overhead: number;
    development: number;
    marketing: number;
    other: number;
    gamesReleased: number;
    unitsSold: number;
    peakCash: number;
    lowestCash: number;
  };
}

export interface Studio {
  id: StudioId;
  name: string;
  foundedYear: number;
  isPlayer: boolean;
  status: StudioStatus;
  cash: number;
  /** 0..100. */
  reputation: number;
  employeeIds: EmployeeId[];
  projectIds: ProjectId[];
  releaseIds: ReleaseId[];
  /** Per-genre accumulated competence (0..1), grown by shipping in that genre. */
  genreStrength: Record<GenreId, number>;
  /** Genre popularity-following memory for the AI brain. */
  lastReleaseTick: number;
  lastReleaseReview: number;
  consecutiveLosses: number;
  monthsBroke: number;
  layoffs: number;
  hires: number;
  defunctTick: number | null;
  ai: AiProfile | null;
  finances: FinanceLedger;
}

export function emptyFinanceLedger(cash: number): FinanceLedger {
  return {
    months: [],
    current: { revenue: 0, salaries: 0, overhead: 0, development: 0, marketing: 0, other: 0 },
    lifetime: {
      revenue: 0,
      salaries: 0,
      overhead: 0,
      development: 0,
      marketing: 0,
      other: 0,
      gamesReleased: 0,
      unitsSold: 0,
      peakCash: cash,
      lowestCash: cash,
    },
  };
}

export function emptyGenreStrength(): Record<GenreId, number> {
  const out = {} as Record<GenreId, number>;
  for (const g of GENRE_ORDER) out[g] = 0;
  return out;
}

export function studioHeadcount(studio: Studio): number {
  return studio.employeeIds.length;
}

/** Months of cash left given a monthly burn — used by both AI and the dashboard. */
export function runwayMonths(cash: number, monthlyBurn: number): number {
  if (monthlyBurn <= 0) return Infinity;
  return cash / monthlyBurn;
}

export function activeProjectIds(studio: Studio): ProjectId[] {
  return studio.projectIds;
}

export function isDefunct(studio: Studio): boolean {
  return studio.status !== 'active';
}
