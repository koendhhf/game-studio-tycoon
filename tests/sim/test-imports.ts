/**
 * One import surface for the tests: the engine's public barrel plus the handful of
 * internals a unit test legitimately needs (world construction, entity factories and the
 * low-level operations the systems share). Components never import these — tests do.
 */

export * from '../../src/sim';
export { createWorld, genreMarketOf, monthlyBurn, monthlyOverhead, monthlySalaryBill } from '../../src/sim/state/world';
export { attachEmployee, assignTeam, charge, credit, detachEmployee, emit, releaseEmployeeToPool } from '../../src/sim/operations';
export { createMarketState, genreMarket, genreModifiers, trendOf } from '../../src/sim/entities/market';
export { industryAudienceFor } from '../../src/sim/data/platforms';
export { createQualityVector } from '../../src/sim/entities/project';
export type { MoraleContext } from '../../src/sim/models/employee-model';
export { moraleDrift, growthDelta, experienceDelta, employeeValue, poachOffer, poachSusceptibility, genreInterest, isJunior } from '../../src/sim/models/employee-model';
export { moraleFactor, experienceFactor, averageQuality, contributionShare, analyzeTeam, employeeWorkRate } from '../../src/sim/models/development-model';
export {
  budgetExhausted,
  DIMENSION_BASELINE,
  dimensionCap,
  effortScale,
  fundingRatio,
  makeCapContext,
  platformWorkMult,
  bugScaleFor,
  bugSeverity,
} from '../../src/sim/models/development-model';
export { qualityVector, buildReviewContext, outletScore, calculateReviews } from '../../src/sim/models/review-model';
export type { QualityRecord, ReviewContext, ReviewInput, ReviewOutcome } from '../../src/sim/models/review-model';
export type { SalesInput, SalesWeekResult } from '../../src/sim/models/sales-model';
export type { QualityVector, TeamAnalysis, CapContext, DevelopmentDelta, DevelopInput } from '../../src/sim/models/development-model';
export { demandConsumed, estimatePerformance } from '../../src/sim/models/sales-model';
export { advanceCalendar, calendarAtTick, createCalendar, isMonday, isMonthStart, isWeekEnd, isYearStart } from '../../src/sim/core/calendar';
export { fnv1a, hashString, intFor } from '../../src/sim/core/rng';
export { economySystem, solvencySystem, shutDownStudio } from '../../src/sim/systems/economy';
export { developmentSystem, advanceProject, bugTarget } from '../../src/sim/systems/development';
export { salesSystem } from '../../src/sim/systems/sales';
export { marketSystem, activeProjectsInGenre, recentReleasesInGenre } from '../../src/sim/systems/market';
export { employeeSystem } from '../../src/sim/systems/employees';
export { hiringSystem } from '../../src/sim/systems/hiring';
export { aiSystem, aiStudioMonth } from '../../src/sim/systems/ai';
export { releaseProject } from '../../src/sim/systems/release';
