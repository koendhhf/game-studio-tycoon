/**
 * Central balance file. Every tuning constant the simulation uses lives here so
 * the numbers can be reasoned about (and re-tuned between phases) in one place.
 * Formulas that consume these values live in `src/sim/models`.
 */

export const BALANCE = {
  time: {
    /** Days per working week for project throughput (weekends count, but slowly). */
    weekendFactor: 0.35,
    /** How many days a month of "work" a person-month represents. */
    workDaysPerMonth: 22,
  },

  employee: {
    /** Salary = base per role + skill-scaled premium (monthly, in dollars). */
    salaryBase: 900,
    salaryPerSkill: 32,
    salaryPerExpYear: 205,
    salaryFloorRatio: 0.55,
    /** Daily pull toward the studio baseline. */
    moraleDriftPerDay: 0.035,
    moraleTarget: 62,
    /** Morale multiplier applied to work throughput: mult = min + (max-min)*morale. */
    moraleMinMult: 0.45,
    moraleMaxMult: 1.25,
    /** Experience gained per active development day. */
    expPerDevDay: 0.0022,
    /** Skill growth per dev day toward potential, scaled by `mentor`/`prodigy`. */
    skillGrowthPerDay: 0.035,
    /** Under-pay below this fraction of market value bleeds morale fast. */
    underpayThreshold: 0.9,
    moraleUnderpayPerDay: -0.6,
    moraleOvertimePerDay: -0.5,
    moraleIdlePerDay: -0.08,
    moraleCrisisPerDay: 0.1,
    moraleShipBonus: 6,
    moraleFlopPenalty: 10,
    moraleLayoffShock: 18,
    crunchMoralePerDay: 0.42,
    /** Skill points an employee needs to be considered "senior". */
    seniorSkillAvg: 70,
  },

  hiring: {
    /** Target size of the open labour pool. */
    poolTarget: 26,
    /** New graduates entering the pool each month (base, scaled by industry size). */
    monthlyEntrants: 4,
    /** Chance a candidate leaves the pool each month. */
    attritionChance: 0.05,
    /** Signing bonus as a multiple of monthly salary. */
    signingBonusMonths: 0.6,
    /** Severance paid when firing, in months of salary. */
    severanceMonths: 1,
    /** Poaching: cost multiplier over salary, plus willingness model. */
    poachBonusMonths: 4,
    poachBaseChance: 0.25,
    /** Advertising a listing: base fee plus a premium for a prestige campaign. */
    listingBase: 2000,
    listingPrestigePremium: 14000,
    /** Minimum offer that gets a serious look, as a fraction of their expectation. */
    minOfferRatio: 0.85,
    /** Better reputation makes our listings more attractive. */
    repHireBonus: 0.35,
    /** Candidate skill quality scales with the hiring studio's reputation. */
    repSkillBonus: 12,
  },

  development: {
    /** Baseline work units produced per employee-day at morale 60, role speed 1. */
    baseWorkPerDay: 1.0,
    /** Multiplier applied while crunching. */
    crunchWorkMult: 1.32,
    /** Quality points per unit of "input" at the start of a project. */
    qualityPerInput: 7.6,
    /** Exponent applied to summed dimension input (diminishing returns on stacking). */
    inputExponent: 0.72,
    /** Quality is hard-capped by scope+budget; see `budgetFactor`. */
    budgetCapBonus: 26,
    /** Extra hard cap contributed by polish-phase bug fixing. */
    polishBonusMax: 14,
    /** Per-day fraction of the remaining gap closed (so quality eases toward cap). */
    qualityEaseRate: 0.055,
    /** Design-by-committee: innovation penalty per employee above this team size. */
    largeTeamThreshold: 11,
    largeTeamInnovationPenalty: 0.022,
    /** Bug generation per unit of progress, before QA pressure. */
    bugsPerProgress: 120,
    /** Bug fixes per QA-ish work unit during the polish phase. */
    bugFixRate: 2.4,
    /** Polish quality gained per bug fixed. */
    polishPerBugFixed: 0.35,
    /** Direct (non-salary) cost per employee-day: tools, kits, consumable assets. */
    toolingCostPerDev: 34,
    /** Fraction of budget that must be spent before quality can reach full cap. */
    requiredBudgetRatio: 1,
    /** Progress at which the project becomes feature complete. */
    featureComplete: 1,
  },

  reviews: {
    /** Score = weighted quality, then modifiers. */
    qualityWeight: 0.78,
    /** Innovation pays off above this level and risks penalties below polish parity. */
    innovationFloor: 55,
    innovationBonusMax: 6,
    riskPenaltyMax: 9,
    bugPenaltyScale: 0.06,
    bugPenaltyMax: 22,
    hypeMismatchPenaltyMax: 10,
    underpromiseBonus: 4,
    /** Critics can be biased by up to this much by studio reputation. */
    reputationHaloMax: 4,
    /** Deterministic critic noise (+/- this many points). */
    noise: 2.2,
    publicationCount: 4,
  },

  sales: {
    /** Units = platformAudience(million) * baseRate * factors. */
    baseConversion: 0.0085,
    /** Weeks a game keeps selling before it is dropped from the active list. */
    maxWeeks: 40,
    /** Weekly decay when reception is neutral. */
    baseWeeklyDecay: 0.66,
    /** Additional decay (negative = slower tail) per reception point away from 60. */
    receptionTailFactor: 0.006,
    wordOfMouthThreshold: 76,
    wordOfMouthGain: 1.06,
    /** Genre demand consumed = (units ÷ addressable audience) × this. */
    demandDrainScale: 300,
    priceSmall: 19.99,
    priceMedium: 34.99,
    priceLarge: 44.99,
    /** Marketing: recommended spend is scope cost * this ratio. */
    marketingRecommendedRatio: 0.32,
    marketingMinReach: 0.3,
    marketingMaxReach: 1.55,
    /** Crowding: sales multiplier is 1 / (1 + competition / competitionHalfPoint). */
    competitionHalfPoint: 55,
    /** Retail/platform cut taken from gross revenue. */
    platformCutOverride: null as null | number,
  },

  market: {
    /** Monthly pull of genre popularity toward its baseline. */
    popularityReversion: 0.12,
    popularityDrift: 3.4,
    popularityMin: 18,
    popularityMax: 100,
    /** Monthly unsatisfied-demand regeneration per capita of audience. */
    demandRegen: 2.9,
    demandMax: 130,
    demandMin: 20,
    /** Saturation: how strongly concurrent projects in a genre push competition. */
    competitionPerProject: 5,
    competitionPerRecentRelease: 3,
    competitionDecayDays: 90,
    /** A hit raises genre popularity for a while. */
    hitPopularityGain: 7,
    hitThresholdScore: 82,
    flopPopularityLoss: 3,
    flopThresholdScore: 38,
    /** Chance per month of a random market shift (platform news, genre craze). */
    eventChance: 0.28,
  },

  studio: {
    /** Reputation change per review point away from 60, scaled by scope. */
    repPerReviewPoint: 0.22,
    repSalesBonus: 0.02,
    repDecayPerYear: 0.6,
    repMin: 3,
    repMax: 100,
    repStartPlayer: 12,
    /** Overhead charged monthly per employee (rent, utilities, licences). */
    overheadPerEmployee: 300,
    overheadBase: 1200,
    /** Bankruptcy: cash below 0 for this many consecutive months ends a studio. */
    graceMonths: 3,
    /** The player gets longer to dig out before the studio is lost. */
    playerGraceMonths: 6,
    /** Below this, the board starts selling the furniture: staff walk out. */
    quitCashMonths: 2,
    /** Player starting capital. */
    startingCash: 480000,
    /** How many people the player starts with (they arrive with a starter project). */
    playerStartStaff: 4,
    aiStartingCash: [1100000, 16000000] as [number, number],
    aiCount: 20,
    /** Industry keeps roughly this many studios alive. */
    aiCountMax: 24,
    aiCountMin: 14,
    /** Chance per month that a defunct industry is refreshed by a new studio. */
    foundingChance: 0.12,
  },

  ai: {
    /** Fraction of cash AI keeps as reserve before it stops spending. */
    cashReserveMonths: 3.5,
    /** Fraction of available cash AI is willing to sink into a project. */
    projectCashShare: 0.55,
    /** Fraction of remaining cash spent on marketing at release. */
    marketingCashShare: 0.18,
    hireSkillFloor: [40, 78] as [number, number],
    /** Monthly chance an AI studio considers a hire at all. */
    hireChance: 0.62,
    /** Chance an AI studio attempts to poach a player employee per month. */
    poachChance: 0.02,
    /** AI releases at this fraction of polish tolerance, adjusted by personality. */
    releaseBugTolerance: 0.35,
    /** Cash pressure overrides quality ambitions at this runway (months). */
    runwayPanicMonths: 2,
  },

  save: {
    /** Autosave every N months. */
    autosaveEveryMonths: 3,
    slots: 6,
  },
} as const;

export type Balance = typeof BALANCE;
