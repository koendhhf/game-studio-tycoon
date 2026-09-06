/**
 * UI-side presentation helpers. Nothing here knows about simulation internals beyond
 * reading plain state data — the UI never computes game rules.
 */

import { MONTH_NAMES } from '../sim';

export function money(value: number, opts: { sign?: boolean; compact?: boolean } = {}): string {
  const sign = value < 0 ? '-' : opts.sign ? '+' : '';
  const abs = Math.abs(value);
  if (opts.compact !== false) {
    if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(2)}B`;
    if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 1 : 2)}M`;
    if (abs >= 10_000) return `${sign}$${(abs / 1_000).toFixed(abs >= 100_000 ? 0 : 1)}k`;
  }
  return `${sign}$${abs.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

export function moneyExact(value: number): string {
  return `${value < 0 ? '-' : ''}$${Math.abs(Math.round(value)).toLocaleString('en-US')}`;
}

export function units(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(abs >= 10_000_000 ? 1 : 2)}M`;
  if (abs >= 10_000) return `${(value / 1_000).toFixed(0)}k`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(Math.round(value));
}

export function num(value: number, digits = 0): string {
  return value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function pct(value: number, digits = 0): string {
  return `${(value * 100).toFixed(digits)}%`;
}

export function score(value: number): string {
  return value.toFixed(1);
}

export function dayMonth(month: number): string {
  return MONTH_NAMES[month] ?? String(month + 1);
}

export function shortDate(date: { year: number; month: number; day: number }): string {
  return `${MONTH_NAMES[date.month]?.slice(0, 3) ?? ''} ${date.day}, ${date.year}`;
}

export function daysToWeeks(days: number): string {
  if (!Number.isFinite(days)) return '—';
  if (days < 45) return `${days}d`;
  if (days < 400) return `${(days / 7).toFixed(0)}w`;
  return `${(days / 30.44).toFixed(1)}mo`;
}

export function scoreTone(value: number): 'good' | 'ok' | 'bad' {
  if (value >= 75) return 'good';
  if (value >= 52) return 'ok';
  return 'bad';
}

export function band(value: number, thresholds: readonly [number, 'good' | 'ok' | 'bad'][]): 'good' | 'ok' | 'bad' {
  for (const [min, tone] of thresholds) if (value >= min) return tone;
  return 'bad';
}

export function titleCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
