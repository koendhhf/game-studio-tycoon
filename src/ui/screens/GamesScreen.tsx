/**
 * Games: the permanent history of every release in the world — the player's and the
 * industry's. This is the read side of the history database; each row links to the full
 * record: reviews, reception, per-week sales, costs and who made it.
 */

import { useMemo, useState } from 'react';
import { GENRES, GENRE_ORDER, PLATFORMS, ROLES, allReleasedGames, platformDef, playerStudio, profitOf, scopeDef } from '../../sim';
import type { ReleasedGame } from '../../sim';
import { Badge, Bar, Button, KeyValue, Modal, Panel, QualityBars, Sparkline, Stat, Table } from '../components';
import { useGame } from '../store';
import { money, num, pct, score as fmtScore, shortDate, units } from '../format';
import { GameTable, ReviewList, SalesSpark, QualitySummary } from './parts';

type SortKey = 'recent' | 'score' | 'units' | 'profit' | 'revenue';

export function GamesScreen(): React.JSX.Element {
  const { state } = useGame();
  const studio = playerStudio(state);
  const [mine, setMine] = useState(false);
  const [genre, setGenre] = useState<'all' | (typeof GENRE_ORDER)[number]>('all');
  const [platform, setPlatform] = useState<'all' | string>('all');
  const [sort, setSort] = useState<SortKey>('recent');
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string | null>(null);

  const all = allReleasedGames(state);
  const rows = useMemo(() => {
    const filtered = all.filter(
      (g) =>
        (!mine || g.studioId === studio.id) &&
        (genre === 'all' || g.genreId === genre) &&
        (platform === 'all' || g.platformId === platform) &&
        (query.trim() === '' || g.title.toLowerCase().includes(query.trim().toLowerCase()) || g.studioName.toLowerCase().includes(query.trim().toLowerCase())),
    );
    const sorted = [...filtered];
    if (sort === 'score') sorted.sort((a, b) => b.reviewScore - a.reviewScore);
    else if (sort === 'units') sorted.sort((a, b) => b.unitsSold - a.unitsSold);
    else if (sort === 'profit') sorted.sort((a, b) => profitOf(b) - profitOf(a));
    else if (sort === 'revenue') sorted.sort((a, b) => b.revenue - a.revenue);
    else sorted.sort((a, b) => b.releaseTick - a.releaseTick);
    return sorted;
  }, [all, mine, genre, platform, sort, query, studio.id]);

  const myGames = all.filter((g) => g.studioId === studio.id);
  const totals = summarise(rows);
  const pickedGame = picked ? state.releases[picked] : null;

  return (
    <div className="stack">
      <div className="grid grid--stats">
        <Stat label="Games in history" value={num(all.length)} sub={`${num(myGames.length)} yours`} />
        <Stat label="Matching filter" value={num(rows.length)} sub={`${money(totals.revenue)} revenue · ${units(totals.units)} units`} />
        <Stat label="Average score" value={totals.count ? fmtScore(totals.avgScore) : '—'} sub={totals.count ? `${num(totals.hits)} scores of 80+ · ${num(totals.flops)} under 40` : 'nothing to average yet'} />
        <Stat label="Best seller here" value={totals.best ? totals.best.title : '—'} sub={totals.best ? `${totals.best.studioName} · ${units(totals.best.unitsSold)} units` : ''} />
        <Stat label="Most profitable" value={totals.rich ? totals.rich.title : '—'} sub={totals.rich ? `${money(profitOf(totals.rich))} profit · score ${fmtScore(totals.rich.reviewScore)}` : ''} />
      </div>

      <Panel
        title="Release history"
        dense
        actions={
          <div className="row row--tight">
            <input placeholder="search titles or studios" value={query} onChange={(e) => setQuery(e.target.value)} style={{ background: 'var(--bg-inset)', border: '1px solid var(--line)', borderRadius: 4, padding: '2px 6px', width: 170 }} />
            <select value={mine ? 'mine' : 'all-studios'} onChange={(e) => setMine(e.target.value === 'mine')} style={selectStyle}>
              <option value="all-studios">All studios</option>
              <option value="mine">My releases</option>
            </select>
            <select value={genre} onChange={(e) => setGenre(e.target.value as typeof genre)} style={selectStyle}>
              <option value="all">All genres</option>
              {GENRE_ORDER.map((g) => (
                <option key={g} value={g}>
                  {GENRES[g].name}
                </option>
              ))}
            </select>
            <select value={platform} onChange={(e) => setPlatform(e.target.value)} style={selectStyle}>
              <option value="all">All platforms</option>
              {Object.keys(PLATFORMS).map((p) => (
                <option key={p} value={p}>
                  {PLATFORMS[p].name}
                </option>
              ))}
            </select>
            <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} style={selectStyle}>
              <option value="recent">Most recent</option>
              <option value="score">Best reviewed</option>
              <option value="units">Most units</option>
              <option value="revenue">Most revenue</option>
              <option value="profit">Most profit</option>
            </select>
          </div>
        }
      >
        <GameTable games={rows} onPick={(g) => setPicked(g.id)} maxHeight="calc(100vh - 360px)" />
      </Panel>

      {pickedGame && <GameModal game={pickedGame} onClose={() => setPicked(null)} />}
    </div>
  );
}

const selectStyle: React.CSSProperties = { background: 'var(--bg-inset)', border: '1px solid var(--line)', borderRadius: 4, padding: '2px 6px' };

function summarise(games: readonly ReleasedGame[]): { count: number; revenue: number; units: number; avgScore: number; hits: number; flops: number; best: ReleasedGame | null; rich: ReleasedGame | null } {
  if (games.length === 0) return { count: 0, revenue: 0, units: 0, avgScore: 0, hits: 0, flops: 0, best: null, rich: null };
  let revenue = 0;
  let u = 0;
  let score = 0;
  let hits = 0;
  let flops = 0;
  let best: ReleasedGame | null = null;
  let rich: ReleasedGame | null = null;
  for (const g of games) {
    revenue += g.revenue;
    u += g.unitsSold;
    score += g.reviewScore;
    if (g.reviewScore >= 80) hits++;
    if (g.reviewScore < 40) flops++;
    if (!best || g.unitsSold > best.unitsSold) best = g;
    if (!rich || profitOf(g) > profitOf(rich)) rich = g;
  }
  return { count: games.length, revenue, units: u, avgScore: score / games.length, hits, flops, best, rich };
}

function GameModal({ game, onClose }: { game: ReleasedGame; onClose: () => void }): React.JSX.Element {
  const { state } = useGame();
  const isMine = game.studioId === playerStudio(state).id;
  const weekly = game.sales.map((s) => s.units);
  const first = game.sales[0]?.units ?? 0;
  const last = game.sales[game.sales.length - 1]?.units ?? 0;
  const profit = profitOf(game);

  return (
    <Modal
      title={
        <span>
          {game.title} <span className="muted">· {game.studioName}</span> {isMine && <Badge tone="info">your game</Badge>}
        </span>
      }
      onClose={onClose}
      width={920}
    >
      <div className="stack">
        <div className="grid grid--stats">
          <Stat label="Press" value={fmtScore(game.reviewScore)} sub={`${game.reviews.length} publications`} tone={game.reviewScore >= 75 ? 'good' : game.reviewScore < 45 ? 'bad' : 'warn'} />
          <Stat label="Players" value={num(game.reception.score, 0)} sub={`${pct(game.reception.recommendRate, 0)} would recommend`} tone={game.reception.score >= 70 ? 'good' : 'warn'} />
          <Stat label="Units" value={units(game.unitsSold)} sub={`${num(game.peakWeeklyUnits)} peak week`} />
          <Stat label="Revenue" value={money(game.revenue)} sub={`${money(game.grossRevenue)} gross · costs ${money(game.developmentCost + game.marketingSpend)}`} />
          <Stat label="Profit" value={money(profit, { sign: true })} tone={profit >= 0 ? 'good' : 'bad'} sub={`${game.roi.toFixed(2)}× return`} />
          <Stat label="On sale" value={`${game.weeksOnSale} weeks`} sub={game.status === 'selling' ? 'still selling' : `retired · legacy ${num(game.legacy, 1)}`} />
        </div>

        <div className="grid grid--2">
          <Panel title="Quality as shipped" dense>
            <div style={{ padding: 10 }}>
              <QualityBars quality={game.quality} weights={GENRES[game.genreId].criticWeights} />
              <div className="hint" style={{ marginTop: 6 }}>
                {game.bugsAtRelease > 0 ? `${num(game.bugsAtRelease)} known issues at launch · ` : 'Shipped clean · '}
                {pct(game.completeness, 0)} of the design complete · {game.developmentDays} days of work by {game.teamHeadcount} people
              </div>
            </div>
          </Panel>

          <Panel title="Sales curve" dense>
            <div style={{ padding: 10 }}>
              <Sparkline values={weekly} width={420} height={60} tone={last >= first ? 'good' : 'info'} />
              <KeyValue
                rows={[
                  ['Opening week', `${num(first)} units`],
                  ['Latest week', `${num(last)} units`],
                  ['Hold ratio', first > 0 ? pct(last / first, 0) : '—'],
                  ['Price at launch', `$${game.price.toFixed(2)}`],
                  ['Genre / platform', `${GENRES[game.genreId].name} on ${platformDef(game.platformId).name}`],
                  ['Scope', scopeDef(game.scope).name],
                  ['Released', shortDate({ year: game.releaseYear, month: game.releaseMonth, day: game.releaseDay })],
                ]}
              />
            </div>
          </Panel>
        </div>

        <Panel title="Reviews" dense>
          <div style={{ padding: 10 }}>
            <ReviewList reviews={game.reviews} />
            <div className="list" style={{ marginTop: 8 }}>
              <div className="list__item">
                <b>Player reception:</b> {game.reception.headline}
                {game.reception.notes.map((n, i) => (
                  <div className="muted" key={i}>
                    · {n}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Panel>

        <div className="grid grid--2">
          <Panel title="Money" dense>
            <div style={{ padding: 10 }}>
              <KeyValue
                rows={[
                  ['Development', money(game.developmentCost)],
                  ['Marketing', money(game.marketingSpend)],
                  ['Gross revenue', money(game.grossRevenue)],
                  ['Paid to studio', money(game.revenue)],
                  ['Profit', <span key="p" className={profit >= 0 ? 'pos' : 'neg'}>{money(profit, { sign: true })}</span>],
                  ['Reputation change', `${game.reputationDelta >= 0 ? '+' : ''}${num(game.reputationDelta, 1)}`],
                ]}
              />
              <div className="hint" style={{ marginTop: 6 }}>
                Platform cut and manufacturing are taken out before revenue reaches the studio, which is why gross and paid-in differ.
              </div>
            </div>
          </Panel>

          <Panel title="Who made it" dense>
            <Table
              rows={game.credits}
              getKey={(c) => c.employeeId}
              emptyLabel="No credits recorded."
              maxHeight={200}
              columns={[
                { key: 'n', header: 'Name', render: (c) => c.name },
                { key: 'r', header: 'Role', render: (c) => ROLES[c.role].name },
                { key: 's', header: 'Skill at ship', align: 'right', render: (c) => <Bar value={c.skill} max={100} height={5} label={<span className="mono">{num(c.skill, 0)}</span>} /> },
              ]}
            />
          </Panel>
        </div>

        <div className="row row--between">
          <QualitySummary game={game} />
          <Button small tone="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}
