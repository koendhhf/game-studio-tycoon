/**
 * Calendar and clock. The whole engine is "one tick = one day", and a lot of behaviour
 * (payroll, market drift, AI thinking, weekly sales) hangs off the month/week cadence, so
 * these boundaries are tested directly.
 */

import { describe, expect, it } from 'vitest';
import { Simulation } from './test-imports';
import { MONTH_NAMES, WEEKDAY_NAMES, daysInMonth, formatDate, isLeapYear, quarterOf } from './test-imports';
import { soloSim } from './helpers';

function sim(): Simulation {
  return soloSim(5);
}

describe('time progression', () => {
  it('treats one tick as exactly one day', () => {
    const s = sim();
    const start = { ...s.state.calendar };
    for (let i = 1; i <= 29; i++) {
      s.step();
      expect(s.state.calendar.tick).toBe(start.tick + i);
      expect(s.state.calendar.day).toBe(start.day + i);
    }
  });

  it('keeps tick and calendar date in agreement across a year', () => {
    const s = sim();
    let expectedDay = s.state.calendar.day;
    let expectedMonth = s.state.calendar.month;
    let expectedYear = s.state.calendar.year;
    for (let i = 0; i < 365; i++) {
      s.step();
      expectedDay += 1;
      const dim = daysInMonth(expectedYear, expectedMonth);
      if (expectedDay > dim) {
        expectedDay = 1;
        expectedMonth += 1;
        if (expectedMonth > 11) {
          expectedMonth = 0;
          expectedYear += 1;
        }
      }
      expect(s.state.calendar.day).toBe(expectedDay);
      expect(s.state.calendar.month).toBe(expectedMonth);
      expect(s.state.calendar.year).toBe(expectedYear);
    }
  });

  it('uses real month lengths, including February in a leap year', () => {
    expect(daysInMonth(2000, 1)).toBe(29);
    expect(daysInMonth(1990, 1)).toBe(28);
    expect(daysInMonth(1900, 1)).toBe(28); // century rule
    expect(isLeapYear(1996)).toBe(true);
    let total = 0;
    for (let m = 0; m < 12; m++) total += daysInMonth(1990, m);
    expect(total).toBe(365);
    expect(MONTH_NAMES.length).toBe(12);
    expect(WEEKDAY_NAMES.length).toBe(7);
  });

  it('rolls weekday forward and counts whole weeks', () => {
    const s = sim();
    const week0 = s.state.calendar.week;
    for (let i = 0; i < 14; i++) s.step();
    expect(s.state.calendar.week).toBe(week0 + 2);
    expect(s.state.calendar.weekday).toBe(0);
  });

  it('flags month starts, weekends and year starts', () => {
    const s = sim();
    let monthStarts = 0;
    let sundays = 0;
    for (let i = 0; i < 360; i++) {
      s.step();
      const cal = s.state.calendar;
      if (cal.day === 1) monthStarts += 1;
      if (cal.weekday === 6) sundays += 1;
    }
    // 360 days covers 12 month boundaries (real months) and about 51 weekends.
    expect(monthStarts).toBeGreaterThanOrEqual(11);
    expect(monthStarts).toBeLessThanOrEqual(13);
    expect(sundays).toBeGreaterThanOrEqual(48);
    expect(sundays).toBeLessThanOrEqual(53);
  });

  it('counts months and years in the stats as it runs', () => {
    const s = sim();
    s.advanceMonths(14);
    expect(s.state.stats.monthsRun).toBe(14);
    expect(s.state.stats.yearsRun).toBe(1);
    expect(s.state.calendar.year).toBe(s.state.config.startYear + 1);
  });

  it('advanceMonths always moves forward, even when already on the 1st', () => {
    const s = sim();
    expect(s.state.calendar.day).toBe(1);
    s.advanceMonths(1);
    expect(s.state.calendar.tick).toBeGreaterThan(0);
    expect(s.state.calendar.day).toBe(1);
    const after = s.state.calendar.monthIndex;
    s.advanceMonths(1);
    expect(s.state.calendar.monthIndex).toBe(after + 1);
  });

  it('advance(days) is bounded and step-consistent', () => {
    const a = sim();
    a.advance(40);
    const b = sim();
    for (let i = 0; i < 40; i++) b.step();
    expect(a.state.calendar.tick).toBe(b.state.calendar.tick);
    expect(a.state.calendar).toEqual(b.state.calendar);
  });

  it('formats dates for the UI', () => {
    const s = sim();
    expect(formatDate(s.state.calendar)).toContain(String(s.state.calendar.year));
    expect(quarterOf(s.state.calendar)).toBeGreaterThanOrEqual(1);
    expect(quarterOf(s.state.calendar)).toBeLessThanOrEqual(4);
  });
});
