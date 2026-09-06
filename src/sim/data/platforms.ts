/**
 * Platforms are fictional machines with a lifecycle: an install base that grows,
 * peaks and fades. Audience size is authored as keyframes so the curve is data
 * (easy to extend in later phases) and the sim just interpolates it.
 */

export type PlatformKind = 'computer' | 'console' | 'handheld' | 'digital';

export interface PlatformDef {
  id: string;
  name: string;
  vendor: string;
  kind: PlatformKind;
  blurb: string;
  /** First year the machine is sellable, and the year it stops shipping. */
  introYear: number;
  retireYear: number;
  /** [year, install base in millions] — linear interpolation between points. */
  audienceKeyframes: readonly (readonly [number, number])[];
  /** Platform-holder royalty taken off gross revenue per unit. */
  licenseCut: number;
  /** Physical cartridge/disc cost per unit sold (0 for digital). */
  unitCost: number;
  /** One-time SDK/development kit fee charged when a project starts. */
  devkitCost: number;
  /** Price tolerance of this platform's buyers. */
  priceMult: number;
  /** How much this platform's audience cares about visuals (scales graphics weight). */
  graphicsPressure: number;
  /** Genres that over-index on this machine. */
  genreAffinity: Record<string, number>;
}

export const PLATFORMS: Record<string, PlatformDef> = {
  pc: {
    id: 'pc',
    name: 'PC',
    vendor: 'Open standard',
    kind: 'computer',
    blurb: 'Keyboard, mouse and no licensing gatekeeper. Deep strategy and sim territory.',
    introYear: 1985,
    retireYear: 2100,
    audienceKeyframes: [
      [1985, 3],
      [1990, 9],
      [1995, 22],
      [2000, 42],
      [2005, 62],
      [2010, 78],
    ],
    licenseCut: 0.0,
    unitCost: 2.2,
    devkitCost: 0,
    priceMult: 0.9,
    graphicsPressure: 1.0,
    genreAffinity: { strategy: 1.35, simulation: 1.4, rpg: 1.1, shooter: 1.1, puzzle: 1.1 },
  },
  superb: {
    id: 'superb',
    name: 'Super Bit',
    vendor: 'Ninvento',
    kind: 'console',
    blurb: 'The dominant 16-bit cartridge console. Family-friendly, action-friendly, unforgiving on storage.',
    introYear: 1989,
    retireYear: 1998,
    audienceKeyframes: [
      [1989, 3],
      [1991, 14],
      [1993, 30],
      [1995, 38],
      [1997, 24],
      [1998, 9],
    ],
    licenseCut: 0.26,
    unitCost: 7.5,
    devkitCost: 42000,
    priceMult: 1.25,
    graphicsPressure: 0.8,
    genreAffinity: { action: 1.25, platformer: 1.3, rpg: 1.2, puzzle: 1.1, sports: 1.1 },
  },
  turbomax: {
    id: 'turbomax',
    name: 'TurboMax 16',
    vendor: 'Segata',
    kind: 'console',
    blurb: 'The edgy 16-bit rival. Bigger arcade ports, older gamer image.',
    introYear: 1989,
    retireYear: 1997,
    audienceKeyframes: [
      [1989, 2],
      [1991, 9],
      [1993, 19],
      [1995, 23],
      [1996, 15],
      [1997, 5],
    ],
    licenseCut: 0.24,
    unitCost: 7.0,
    devkitCost: 38000,
    priceMult: 1.2,
    graphicsPressure: 0.85,
    genreAffinity: { sports: 1.3, racing: 1.25, action: 1.15, shooter: 1.1 },
  },
  microboy: {
    id: 'microboy',
    name: 'Micro Boy',
    vendor: 'Ninvento',
    kind: 'handheld',
    blurb: 'Pocket monochrome machine. Simple rules and short sessions win here.',
    introYear: 1989,
    retireYear: 2002,
    audienceKeyframes: [
      [1989, 4],
      [1992, 22],
      [1996, 40],
      [1998, 52],
      [2001, 38],
      [2002, 15],
    ],
    licenseCut: 0.3,
    unitCost: 4.5,
    devkitCost: 26000,
    priceMult: 0.75,
    graphicsPressure: 0.35,
    genreAffinity: { puzzle: 1.6, action: 1.15, strategy: 0.9, simulation: 0.85 },
  },
  diskdrive: {
    id: 'diskdrive',
    name: 'DiskDrive',
    vendor: 'Segata',
    kind: 'console',
    blurb: '32-bit CD console. Full-motion video hype, big audio budgets, cinematic ambitions.',
    introYear: 1994,
    retireYear: 2003,
    audienceKeyframes: [
      [1994, 3],
      [1996, 18],
      [1998, 36],
      [2000, 44],
      [2002, 26],
      [2003, 10],
    ],
    licenseCut: 0.25,
    unitCost: 4.0,
    devkitCost: 95000,
    priceMult: 1.3,
    graphicsPressure: 1.25,
    genreAffinity: { adventure: 1.35, horror: 1.3, rpg: 1.25, racing: 1.15, action: 1.1 },
  },
  ultra64: {
    id: 'ultra64',
    name: 'Ultra64',
    vendor: 'Ninvento',
    kind: 'console',
    blurb: '64-bit cartridge machine. Superb 3D platforming, cramped audio, tiny budgets per megabyte.',
    introYear: 1996,
    retireYear: 2004,
    audienceKeyframes: [
      [1996, 4],
      [1998, 21],
      [2000, 31],
      [2002, 25],
      [2004, 8],
    ],
    licenseCut: 0.29,
    unitCost: 9.5,
    devkitCost: 130000,
    priceMult: 1.35,
    graphicsPressure: 1.15,
    genreAffinity: { action: 1.35, racing: 1.25, puzzle: 1.05, sports: 1.15 },
  },
  vega: {
    id: 'vega',
    name: 'Vega',
    vendor: 'Miotech',
    kind: 'console',
    blurb: 'DVD-capable mainstream box with a hard drive and, eventually, an online service.',
    introYear: 2001,
    retireYear: 2100,
    audienceKeyframes: [
      [2001, 2],
      [2003, 24],
      [2005, 48],
      [2008, 72],
      [2012, 95],
    ],
    licenseCut: 0.28,
    unitCost: 5.0,
    devkitCost: 260000,
    priceMult: 1.4,
    graphicsPressure: 1.5,
    genreAffinity: { shooter: 1.4, action: 1.3, sports: 1.3, racing: 1.2, horror: 1.1 },
  },
  pocket: {
    id: 'pocket',
    name: 'PocketBook',
    vendor: 'Segata',
    kind: 'handheld',
    blurb: 'Colour handheld with wireless play. Short sessions, impulse purchases.',
    introYear: 2004,
    retireYear: 2100,
    audienceKeyframes: [
      [2004, 6],
      [2006, 34],
      [2009, 72],
      [2012, 96],
    ],
    licenseCut: 0.3,
    unitCost: 3.2,
    devkitCost: 135000,
    priceMult: 0.8,
    graphicsPressure: 0.7,
    genreAffinity: { puzzle: 1.5, strategy: 1.25, action: 1.1, simulation: 1.15 },
  },
  netparlour: {
    id: 'netparlour',
    name: 'NetParlour',
    vendor: 'Digital storefront',
    kind: 'digital',
    blurb: 'Download-only storefront. No manufacturing cost, no shelf, brutal discoverability.',
    introYear: 2004,
    retireYear: 2100,
    audienceKeyframes: [
      [2004, 3],
      [2006, 14],
      [2009, 38],
      [2012, 66],
    ],
    licenseCut: 0.3,
    unitCost: 0,
    devkitCost: 6000,
    priceMult: 0.55,
    graphicsPressure: 0.9,
    genreAffinity: { puzzle: 1.5, simulation: 1.3, strategy: 1.25, horror: 1.15 },
  },
};

export const PLATFORM_ORDER: readonly string[] = Object.keys(PLATFORMS);

export function platformDef(id: string): PlatformDef {
  return PLATFORMS[id] ?? PLATFORMS.pc;
}

export function isPlatformAvailable(id: string, year: number): boolean {
  const p = platformDef(id);
  return year >= p.introYear && year <= p.retireYear;
}

export function availablePlatforms(year: number): PlatformDef[] {
  return PLATFORM_ORDER.filter((id) => isPlatformAvailable(id, year)).map((id) => PLATFORMS[id]);
}

/** Install base in millions for a given (fractional) year. */
/**
 * Total reachable audience across everything on sale in a given year fraction.
 * One definition, used by the market's initial state and by its monthly refresh, so the
 * number the player sees on day one is the number the sales system will use later.
 */
export function industryAudienceFor(year: number): number {
  const calendarYear = Math.floor(year);
  let total = 0;
  for (const id of PLATFORM_ORDER) {
    if (!isPlatformAvailable(id, calendarYear)) continue;
    total += platformAudience(id, year);
  }
  return Math.round(total * 10) / 10;
}

export function platformAudience(id: string, year: number): number {
  const p = platformDef(id);
  if (year < p.introYear || year > p.retireYear) return 0;
  const frames = p.audienceKeyframes;
  if (year <= frames[0][0]) return frames[0][1];
  const last = frames[frames.length - 1];
  if (year >= last[0]) return last[1];
  for (let i = 0; i < frames.length - 1; i++) {
    const [y0, a0] = frames[i];
    const [y1, a1] = frames[i + 1];
    if (year >= y0 && year <= y1) {
      const t = y1 === y0 ? 0 : (year - y0) / (y1 - y0);
      return a0 + (a1 - a0) * t;
    }
  }
  return last[1];
}

/** A short human-readable lifecycle note for the UI. */
export function platformLifecycleNote(id: string, year: number): string {
  const p = platformDef(id);
  const audience = platformAudience(id, year);
  const frames = p.audienceKeyframes;
  const peak = frames.reduce((best, [, a]) => (a > best[1] ? best : [0, a]), [0, 0]) as [number, number];
  const [peakYear] = peak;
  if (year < p.introYear) return `Launches ${p.introYear}`;
  if (year > p.retireYear) return `Discontinued`;
  if (year < peakYear - 1) return 'Growing install base';
  if (year > peakYear + 2) return 'Declining install base';
  return 'At peak install base';
}
