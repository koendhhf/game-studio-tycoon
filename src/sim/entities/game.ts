/**
 * ReleasedGame — the permanent record of a shipped title. This is the object the
 * Games catalogue and Industry history screens read, and it is never deleted.
 */

import type { GenreId, PlatformId, QualityDimensionId, ReleaseId, RoleId, ScopeId, StudioId } from '../core/types';

export interface ReviewRecord {
  publicationId: string;
  publication: string;
  score: number;
  headline: string;
  body: string;
}

export interface PlayerReception {
  /** 0..100 audience score, which can diverge from critic consensus. */
  score: number;
  headline: string;
  notes: string[];
  /** Fraction of buyers who recommend it — drives the word-of-mouth tail. */
  recommendRate: number;
}

export interface SalesPoint {
  week: number;
  units: number;
  revenue: number;
}

export interface ReleasedGame {
  id: ReleaseId;
  studioId: StudioId;
  studioName: string;
  isPlayerGame: boolean;

  title: string;
  genreId: GenreId;
  platformId: PlatformId;
  scope: ScopeId;

  releaseTick: number;
  releaseYear: number;
  releaseMonth: number;
  releaseDay: number;
  releaseLabel: string;

  /** Money in, money out — kept denormalised so history never needs to be re-derived. */
  developmentCost: number;
  marketingSpend: number;
  /** Total dollars paid to the studio across all sales weeks. */
  revenue: number;
  /** Manufacturing + platform royalties already netted out of `revenue`. */
  grossRevenue: number;
  unitsSold: number;
  /** Launch-week units, frozen at release so the weekly tail can decay from it. */
  openingUnits: number;
  price: number;
  teamHeadcount: number;
  /** Who shipped it, frozen as names at release time (no live references → no dangling ids). */
  credits: ReleaseCredit[];
  developmentDays: number;

  quality: Record<QualityDimensionId, number>;
  bugsAtRelease: number;
  /** 0..1 — how much of the design was actually finished when it shipped. */
  completeness: number;

  reviewScore: number;
  reviews: ReviewRecord[];
  reception: PlayerReception;

  sales: SalesPoint[];
  weeksOnSale: number;
  peakWeeklyUnits: number;
  status: 'selling' | 'retired';
  /** Break-even multiplier: revenue / (dev + marketing). */
  roi: number;
  /** Reputation delta this release caused its studio. */
  reputationDelta: number;
  /** Fanbase memory: how well this title is still remembered. */
  legacy: number;
}

export interface ReleaseCredit {
  employeeId: string;
  name: string;
  role: RoleId;
  /** Average skill at ship time, for the "did this person make the game good" read. */
  skill: number;
}

export type ReleasedGameRecord = Record<ReleaseId, ReleasedGame>;

export function profitOf(game: ReleasedGame): number {
  return game.revenue - game.developmentCost - game.marketingSpend;
}

export function gamesByYear(games: readonly ReleasedGame[]): Map<number, ReleasedGame[]> {
  const out = new Map<number, ReleasedGame[]>();
  for (const g of games) {
    const list = out.get(g.releaseYear);
    if (list) list.push(g);
    else out.set(g.releaseYear, [g]);
  }
  return out;
}
