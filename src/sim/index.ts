/**
 * Public simulation API. The UI imports from here and nowhere deeper, so the engine can
 * be refactored without touching components.
 */

export { Simulation } from './simulation';
export type { TickReport } from './simulation';
export { generateWorld } from './setup';
export { DEFAULT_CONFIG } from './state/world';
export type { NewGameOptions } from './setup';
export { WORLD_VERSION, allocateId, genreMarketOf } from './state/world';
export type { WorldState, SimConfig, SimStats, EconomyState, JobListing } from './state/world';
export {
  applyCommand,
  fail,
  OK,
  validateHire,
  validateRelease,
  validateStartProject,
} from './commands';
export { listingCost } from './commands';
export type { Command, CommandResult, StartProjectPayload } from './commands';

// Core
export { Rng, createRngState, hashString, randFor } from './core/rng';
export type { RngState } from './core/rng';
export {
  advanceCalendar,
  calendarAtTick,
  createCalendar,
  daysInMonth,
  formatDate,
  formatMonth,
  formatQuarter,
  formatShortDate,
  isLeapYear,
  isMonthStart,
  isWeekEnd,
  isYearStart,
  MONTH_NAMES,
  quarterOf,
  WEEKDAY_NAMES,
} from './core/calendar';
export type { CalendarState, GameDate } from './core/calendar';
export { recentEvents } from './core/events';
export type { GameEvent, EventDraft, EventCategory, EventTone } from './core/events';
export { compareIds, sortedIds, sortedValues } from './core/ids';
export { clamp, clamp01, lerp, mean, round1, saturate, smoothToward, sum, weightedAvg } from './core/math';
export { QUALITY_DIMENSIONS } from './core/types';
export type { GenreId, PlatformId, QualityDimensionId, ReleaseId, RoleId, ScopeId, StudioId, EmployeeId, ProjectId } from './core/types';

// Data
export { BALANCE } from './data/balance';
export { GENRES, GENRE_ORDER, genreDef, weightedQuality } from './data/genres';
export type { GenreDef } from './data/genres';
export { ROLES, ROLE_ORDER, roleFocus } from './data/roles';
export type { RoleDef } from './data/roles';
export { SCOPES, SCOPE_ORDER, scopeDef } from './data/scopes';
export type { ScopeDef } from './data/scopes';
export { PLATFORMS, PLATFORM_ORDER, availablePlatforms, isPlatformAvailable, platformAudience, platformDef } from './data/platforms';
export type { PlatformDef } from './data/platforms';
export { NEGATIVE_TRAITS, TRAITS, TRAIT_ORDER } from './data/traits';
export type { TraitDef, TraitId } from './data/traits';
export { PUBLICATIONS } from './data/publications';
export { gameTitle } from './data/names';

// Entities
export {
  clampEmployee,
  effectiveSkill,
  emptySkills,
  marketValue,
  moraleBand,
  payRatio,
  primarySkill,
  skillAverage,
  skillBand,
} from './entities/employee';
export type { Employee, EmployeeStatus } from './entities/employee';
export { bugPressure, completeness, createQualityVector, isFeatureComplete, polishRatio, projectScope } from './entities/project';
export type { Project, ProjectStatus } from './entities/project';
export { profitOf } from './entities/game';
export type { ReleasedGame, ReviewRecord, PlayerReception, SalesPoint } from './entities/game';
export { emptyFinanceLedger, runwayMonths, studioHeadcount, activeProjectIds } from './entities/studio';
export type { AiProfile, MonthLedger, Studio, StudioStatus } from './entities/studio';
export { genreMarket, platformAudienceModifier, trendOf } from './entities/market';
export { missingRolesFor } from './operations';
export type { GenreMarketState, MarketModifier, MarketState, TrendDirection } from './entities/market';
export { createEmployee, createProject, createStudio, suggestBudget, platformLicenceFee } from './entities/factory';

// State selectors
export {
  activeStudios,
  aiStudios,
  employeeOf,
  allReleasedGames,
  candidatesInPool,
  employeesOfStudio,
  monthlyBurn,
  monthlyOverhead,
  monthlySalaryBill,
  playerStudio,
  projectOf,
  projectsOfStudio,
  releasesOfStudio,
  roleCounts,
} from './state/world';

// Models
export {
  analyzeTeam,
  averageQuality,
  developProject,
  dimensionCap,
  employeeWorkRate,
  estimateRemainingDays,
  projectQualityForecast,
} from './models/development-model';
export { calculateReviews, dimensionDescriptor, recommendedMarketingFor, outletScore, buildReviewContext } from './models/review-model';
export { planProject } from './models/planning-model';
export type { ProjectDraft, ProjectPlan, DimensionForecast } from './models/planning-model';
export type { ReviewInput, ReviewOutcome } from './models/review-model';
export { estimateLifetimeUnits, estimatePerformance, openingUnits, priceFor, revenueFor, weeklyMultiplier } from './models/sales-model';
export type { SalesInput } from './models/sales-model';
export { employeeValue, genreInterest, growthDelta, hireUpfrontCost, moraleDrift, poachOffer, poachSusceptibility, shipmentMoraleDelta } from './models/employee-model';

// Systems
export { SYSTEMS, systemIds } from './systems/index';
export type { System, SystemContext } from './systems/types';
export { releaseProject } from './systems/release';
export { aiStudioMonth } from './systems/ai';
export { shutDownStudio } from './systems/economy';
export { bugTarget, optimalTeamFor } from './systems/development';

// Save/load
export {
  SAVE_FORMAT_VERSION,
  SAVE_MAGIC,
  checksumOf,
  deserializeWorld,
  repairWorld,
  serializeWorld,
  stableStringify,
} from '../save/schema';
export type { SaveEnvelope, DeserializedSave } from '../save/schema';
export { AUTOSAVE_SLOT, MANUAL_SLOTS, SaveManager, fromSaveText, toSaveText } from '../save/storage';
export type { SaveMeta, SaveBackend, SaveRecord } from '../save/storage';
