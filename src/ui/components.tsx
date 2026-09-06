/**
 * Small, dense presentation primitives. They render data; they never compute it.
 */

import type { ReactNode } from 'react';
import { QUALITY_DIMENSIONS, type QualityDimensionId } from '../sim/core/types';
import { QUALITY_LABELS } from './labels';

export function Panel({
  title,
  actions,
  children,
  className = '',
  dense = false,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  dense?: boolean;
}): React.JSX.Element {
  return (
    <section className={`panel ${dense ? 'panel--dense' : ''} ${className}`}>
      {(title || actions) && (
        <header className="panel__head">
          <h2>{title}</h2>
          {actions && <div className="panel__actions">{actions}</div>}
        </header>
      )}
      <div className="panel__body">{children}</div>
    </section>
  );
}

export function Stat({
  label,
  value,
  sub,
  tone = 'neutral',
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: 'neutral' | 'good' | 'bad' | 'warn';
}): React.JSX.Element {
  return (
    <div className={`stat stat--${tone}`}>
      <span className="stat__label">{label}</span>
      <span className="stat__value">{value}</span>
      {sub && <span className="stat__sub">{sub}</span>}
    </div>
  );
}

export interface Column<T> {
  key: string;
  header: ReactNode;
  align?: 'left' | 'right' | 'center';
  width?: number | string;
  render: (row: T, index: number) => ReactNode;
  sortValue?: (row: T) => number | string;
}

export function Table<T>({
  rows,
  columns,
  getKey,
  onRowClick,
  selectedKey,
  emptyLabel = 'Nothing here yet.',
  maxHeight,
}: {
  rows: readonly T[];
  columns: readonly Column<T>[];
  getKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  selectedKey?: string | null;
  emptyLabel?: string;
  maxHeight?: number | string;
}): React.JSX.Element {
  if (rows.length === 0) return <p className="empty">{emptyLabel}</p>;
  return (
    <div className="tablewrap" style={maxHeight ? { maxHeight, overflowY: 'auto' } : undefined}>
      <table className="table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} style={{ textAlign: c.align ?? 'left', width: c.width }}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const key = getKey(row);
            return (
              <tr
                key={key}
                className={`${onRowClick ? 'clickable' : ''} ${selectedKey === key ? 'selected' : ''}`}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              >
                {columns.map((c) => (
                  <td key={c.key} style={{ textAlign: c.align ?? 'left' }}>
                    {c.render(row, i)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function sortByColumn<T>(rows: readonly T[], column: Column<T> | undefined, direction: 1 | -1): T[] {
  if (!column?.sortValue) return [...rows];
  const value = column.sortValue;
  return [...rows].sort((a, b) => {
    const av = value(a);
    const bv = value(b);
    if (av === bv) return 0;
    return (av > bv ? 1 : -1) * direction;
  });
}

export function Bar({
  value,
  max = 100,
  tone = 'auto',
  label,
  height = 8,
}: {
  value: number;
  max?: number;
  tone?: 'auto' | 'good' | 'bad' | 'warn' | 'info';
  label?: ReactNode;
  height?: number;
}): React.JSX.Element {
  const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const auto: 'good' | 'ok' | 'bad' = ratio >= 0.7 ? 'good' : ratio >= 0.45 ? 'ok' : 'bad';
  const resolved = tone === 'auto' ? auto : tone === 'info' ? 'ok' : tone === 'warn' ? 'warn' : tone;
  return (
    <div className={`bar bar--${resolved}`} style={{ height }}>
      <div className="bar__fill" style={{ width: `${ratio * 100}%` }} />
      {label !== undefined && <span className="bar__label">{label}</span>}
    </div>
  );
}

export function QualityBars({
  quality,
  weights,
  compact = false,
}: {
  quality: Record<QualityDimensionId, number>;
  weights?: Record<QualityDimensionId, number>;
  compact?: boolean;
}): React.JSX.Element {
  return (
    <div className={`qbars ${compact ? 'qbars--compact' : ''}`}>
      {QUALITY_DIMENSIONS.map((dim) => {
        const value = quality[dim] ?? 0;
        const weight = weights ? weights[dim] : undefined;
        return (
          <div key={dim} className="qbars__row" title={`${QUALITY_LABELS[dim]}: ${value.toFixed(1)}${weight !== undefined ? ` · genre weight ${(weight * 100).toFixed(0)}%` : ''}`}>
            <span className="qbars__label">{QUALITY_LABELS[dim].slice(0, 4)}</span>
            <Bar value={value} height={compact ? 5 : 7} />
            <span className="qbars__value">{Math.round(value)}</span>
            {weight !== undefined && <span className="qbars__weight">{(weight * 100).toFixed(0)}%</span>}
          </div>
        );
      })}
    </div>
  );
}

export function Sparkline({
  values,
  width = 120,
  height = 26,
  tone = 'info',
}: {
  values: readonly number[];
  width?: number;
  height?: number;
  tone?: 'info' | 'good' | 'bad';
}): React.JSX.Element {
  if (values.length < 2) return <span className="muted">—</span>;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = width / (values.length - 1);
  const points = values
    .map((v, i) => `${(i * step).toFixed(1)},${(height - ((v - min) / span) * (height - 3) - 1.5).toFixed(1)}`)
    .join(' ');
  return (
    <svg className={`spark spark--${tone}`} width={width} height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <polyline points={points} fill="none" strokeWidth="1.4" />
    </svg>
  );
}

export function Bars({
  series,
  width = 160,
  height = 34,
  format = (v: number) => String(Math.round(v)),
}: {
  series: readonly { label: string; value: number; tone?: 'good' | 'bad' | 'neutral' }[];
  width?: number;
  height?: number;
  format?: (v: number) => string;
}): React.JSX.Element {
  const max = Math.max(1, ...series.map((s) => Math.abs(s.value)));
  return (
    <div className="minibars" style={{ width }}>
      {series.map((s) => (
        <div key={s.label} className="minibars__col" title={`${s.label}: ${format(s.value)}`}>
          <span className={`minibars__fill minibars__fill--${s.tone ?? 'neutral'}`} style={{ height: `${Math.max(2, (Math.abs(s.value) / max) * (height - 10))}px` }} />
          <span className="minibars__label">{s.label}</span>
        </div>
      ))}
    </div>
  );
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'good' | 'bad' | 'warn' | 'info' }): React.JSX.Element {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}

export function Button({
  children,
  onClick,
  tone = 'default',
  disabled,
  title,
  small,
}: {
  children: ReactNode;
  onClick?: () => void;
  tone?: 'default' | 'primary' | 'danger' | 'ghost';
  disabled?: boolean;
  title?: string;
  small?: boolean;
}): React.JSX.Element {
  return (
    <button type="button" className={`btn btn--${tone} ${small ? 'btn--small' : ''}`} onClick={onClick} disabled={disabled} title={title}>
      {children}
    </button>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }): React.JSX.Element {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      <span className="field__control">{children}</span>
      {hint && <span className="field__hint">{hint}</span>}
    </label>
  );
}

export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: readonly { id: T; label: ReactNode }[];
  active: T;
  onChange: (id: T) => void;
}): React.JSX.Element {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((tab) => (
        <button key={tab.id} type="button" role="tab" aria-selected={tab.id === active} className={`tabs__tab ${tab.id === active ? 'is-active' : ''}`} onClick={() => onChange(tab.id)}>
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export function KeyValue({ rows }: { rows: readonly [ReactNode, ReactNode][] }): React.JSX.Element {
  return (
    <dl className="kv">
      {rows.map(([k, v], i) => (
        <div className="kv__row" key={i}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Money({ value, tone = true }: { value: number; tone?: boolean }): React.JSX.Element {
  const text = `${value < 0 ? '-' : ''}$${Math.abs(Math.round(value)).toLocaleString('en-US')}`;
  return <span className={tone ? (value < 0 ? 'neg' : 'pos') : undefined}>{text}</span>;
}

export function Modal({ title, onClose, children, width = 620 }: { title: ReactNode; onClose: () => void; children: ReactNode; width?: number }): React.JSX.Element {
  return (
    <div className="modal" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="modal__panel" style={{ width }} onClick={(e) => e.stopPropagation()}>
        <header className="modal__head">
          <h2>{title}</h2>
          <button type="button" className="btn btn--ghost btn--small" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="modal__body">{children}</div>
      </div>
    </div>
  );
}

export function ProgressRow({ label, value, detail }: { label: ReactNode; value: number; detail?: ReactNode }): React.JSX.Element {
  return (
    <div className="progressrow">
      <span className="progressrow__label">{label}</span>
      <Bar value={value * 100} max={100} height={6} />
      <span className="progressrow__detail">{detail}</span>
    </div>
  );
}
