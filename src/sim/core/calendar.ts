/**
 * In-game calendar. One simulation tick == one in-game day.
 *
 * The calendar is stored as plain data (not a class) so it serializes with the
 * rest of the world state. All date math is pure functions of that data.
 */

export interface CalendarState {
  /** Days elapsed since the epoch date. Equal to the simulation tick. */
  tick: number;
  year: number;
  /** 0-based month index (0 = January). */
  month: number;
  /** 1-based day of month. */
  day: number;
  /** 0-based weekday, 0 = Monday. */
  weekday: number;
  /** Absolute months since year 0, handy for interval maths. */
  monthIndex: number;
  /** Absolute weeks since founding. */
  week: number;
}

export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

export const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;

export interface GameDate {
  year: number;
  month: number;
  day: number;
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  const table = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month === 1 && isLeapYear(year)) return 29;
  return table[month];
}

export function daysInYear(year: number): number {
  return isLeapYear(year) ? 366 : 365;
}

export function createCalendar(start: GameDate): CalendarState {
  return {
    tick: 0,
    year: start.year,
    month: start.month,
    day: start.day,
    weekday: 0,
    monthIndex: start.year * 12 + start.month,
    week: 0,
  };
}

/** Advance the calendar by one day. Mutates in place (fast, and keeps state identity). */
export function advanceCalendar(cal: CalendarState): void {
  cal.tick += 1;
  cal.weekday = (cal.weekday + 1) % 7;
  const dim = daysInMonth(cal.year, cal.month);
  if (cal.day >= dim) {
    cal.day = 1;
    if (cal.month >= 11) {
      cal.month = 0;
      cal.year += 1;
    } else {
      cal.month += 1;
    }
    cal.monthIndex += 1;
  } else {
    cal.day += 1;
  }
  if (cal.weekday === 0) cal.week += 1;
}

/** Calendar state at an arbitrary tick, derived from an anchor. O(|delta|) but bounded by callers. */
export function calendarAtTick(cal: CalendarState, tick: number): CalendarState {
  const out: CalendarState = { ...cal };
  let delta = tick - cal.tick;
  while (delta > 0) {
    advanceCalendar(out);
    delta--;
  }
  return out;
}

export function isMonday(cal: CalendarState): boolean {
  return cal.weekday === 0;
}

/** True on the first day of a new month — the cadence for salaries, market updates and AI thinking. */
export function isMonthStart(cal: CalendarState): boolean {
  return cal.day === 1;
}

/** True on Sunday: the weekly cadence for sales and project accounting. */
export function isWeekEnd(cal: CalendarState): boolean {
  return cal.weekday === 6;
}

export function isYearStart(cal: CalendarState): boolean {
  return cal.month === 0 && cal.day === 1;
}

export function monthsBetween(a: CalendarState | GameDate, b: CalendarState | GameDate): number {
  const am = a.year * 12 + a.month;
  const bm = b.year * 12 + b.month;
  return bm - am;
}

export function formatMonth(cal: CalendarState | GameDate): string {
  return `${MONTH_NAMES[cal.month]} ${cal.year}`;
}

export function formatDate(date: GameDate): string {
  return `${MONTH_NAMES[date.month].slice(0, 3)} ${date.day}, ${date.year}`;
}

export function formatShortDate(date: GameDate): string {
  const m = String(date.month + 1).padStart(2, '0');
  const d = String(date.day).padStart(2, '0');
  return `${date.year}-${m}-${d}`;
}

/**
 * Fractional calendar year — the one definition of "where in the year are we" that the
 * audience curves, the market and the planner all share. Day 1 of January is exactly the year.
 */
export function yearFraction(cal: CalendarState): number {
  return cal.year + (cal.month + (cal.day - 1) / 30) / 12;
}

export function quarterOf(date: GameDate): number {
  return Math.floor(date.month / 3) + 1;
}

export function formatQuarter(cal: CalendarState | GameDate): string {
  return `Q${quarterOf(cal)} ${cal.year}`;
}
