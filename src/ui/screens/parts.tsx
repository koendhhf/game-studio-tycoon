/** Pieces shared by several screens. Presentation only — every number comes from the sim. */

import type { GameEvent, ReleasedGame, ReviewRecord, TrendDirection } from '../../sim';
import { GENRES, QUALITY_DIMENSIONS, platformDef, profitOf } from '../../sim';
import { Badge, Sparkline, Table } from '../components';
import { money, num, shortDate, units } from '../format';

export function Trend({ direction, delta }: { direction: TrendDirection; delta?: number }): React.JSX.Element {
  const arrow = direction === 'rising' ? '▲' : direction === 'falling' ? '▼' : '►';
  const tone = direction === 'rising' ? 'pos' : direction === 'falling' ? 'neg' : 'muted';
  return (
    <span className={tone} title={delta === undefined ? direction : `${direction} by ${delta.toFixed(1)} points this quarter`}>
      {arrow} {delta === undefined ? '' : num(delta, 1)}
    </span>
  );
}

export function EventFeed({ events, showDate = true }: { events: readonly GameEvent[]; showDate?: boolean }): React.JSX.Element {
  if (events.length === 0) return <p className="empty">Nothing has happened yet.</p>;
  return (
    <div className="feed">
      {events.map((e) => (
        <div key={e.id} className={`feed__item feed__item--${e.tone} ${e.aboutPlayer ? 'is-player' : ''}`}>
          {showDate && <span className="feed__date">{shortDate({ year: e.year, month: e.month, day: e.day })}</span>}
          <span>
            <span className="feed__title">{e.title}</span>
            {e.detail && <div className="feed__detail">{e.detail}</div>}
          </span>
        </div>
      ))}
    </div>
  );
}

export function ReviewList({ reviews }: { reviews: readonly ReviewRecord[] }): React.JSX.Element {
  if (reviews.length === 0) return <p className="empty">No press coverage recorded.</p>;
  return (
    <div>
      {reviews.map((r) => (
        <div className="review" key={r.publicationId}>
          <div className="review__head">
            <span className="review__pub">{r.publication}</span>
            <span className={`review__score ${r.score >= 70 ? 'pos' : r.score < 45 ? 'neg' : ''}`}>{num(r.score)}</span>
            <span className="muted small">{r.headline}</span>
          </div>
          <p className="review__body" style={{ margin: '2px 0 0' }}>
            {r.body}
          </p>
        </div>
      ))}
    </div>
  );
}

export function GameTable({ games, onPick, maxHeight }: { games: readonly ReleasedGame[]; onPick?: (g: ReleasedGame) => void; maxHeight?: number | string }): React.JSX.Element {
  return (
    <Table
      rows={games}
      getKey={(g) => g.id}
      onRowClick={onPick}
      maxHeight={maxHeight}
      emptyLabel="No releases match this filter."
      columns={[
        { key: 'title', header: 'Title', render: (g) => <span title={g.reviews[0]?.headline}>{g.title}</span>, sortValue: (g) => g.title },
        { key: 'studio', header: 'Studio', render: (g) => (g.isPlayerGame ? <Badge tone="info">you</Badge> : g.studioName), sortValue: (g) => g.studioName },
        { key: 'date', header: 'Released', align: 'right', render: (g) => shortDate({ year: g.releaseYear, month: g.releaseMonth, day: g.releaseDay }), sortValue: (g) => g.releaseTick },
        { key: 'gp', header: 'Genre / platform', render: (g) => `${GENRES[g.genreId].name} · ${platformDef(g.platformId).name}` },
        { key: 'score', header: 'Score', align: 'right', render: (g) => <span className={g.reviewScore >= 75 ? 'pos' : g.reviewScore < 45 ? 'neg' : ''}>{num(g.reviewScore, 1)}</span>, sortValue: (g) => g.reviewScore },
        { key: 'fans', header: 'Players', align: 'right', render: (g) => num(g.reception.score, 0), sortValue: (g) => g.reception.score },
        { key: 'units', header: 'Units', align: 'right', render: (g) => units(g.unitsSold), sortValue: (g) => g.unitsSold },
        { key: 'rev', header: 'Revenue', align: 'right', render: (g) => money(g.revenue), sortValue: (g) => g.revenue },
        {
          key: 'profit',
          header: 'Profit',
          align: 'right',
          render: (g) => <span className={profitOf(g) >= 0 ? 'pos' : 'neg'}>{money(profitOf(g))}</span>,
          sortValue: (g) => profitOf(g),
        },
      ]}
    />
  );
}

export function QualitySummary({ game }: { game: ReleasedGame }): React.JSX.Element {
  const dims = QUALITY_DIMENSIONS;
  const values = dims.map((d) => game.quality[d] ?? 0);
  const min = Math.min(...values);
  const max = Math.max(...values);
  return (
    <div className="row row--tight small">
      {dims.map((d, i) => (
        <span key={d} className="mono" style={{ color: values[i] === max ? 'var(--good)' : values[i] === min ? 'var(--bad)' : 'var(--text-dim)' }} title={`${d}: ${values[i].toFixed(1)}`}>
          {d.slice(0, 3).toUpperCase()} {Math.round(values[i])}
        </span>
      ))}
    </div>
  );
}

export function SalesSpark({ game }: { game: ReleasedGame }): React.JSX.Element {
  const values = game.sales.map((s) => s.units);
  if (values.length < 2) return <span className="muted">no sales history yet</span>;
  return <Sparkline values={values} width={150} height={28} tone={values[values.length - 1] > values[0] ? 'good' : 'info'} />;
}
