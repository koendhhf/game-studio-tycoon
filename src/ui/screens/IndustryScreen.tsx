/**
 * Industry: the 20 competing studios, the genre market they all feed on, the hardware
 * they publish on, and what the engine is currently doing. Read-only view over world state.
 */

import { useMemo, useState } from 'react';
import {
  BALANCE,
  GENRE_ORDER,
  GENRES,
  PLATFORMS,
  PLATFORM_ORDER,
  SYSTEMS,
  WORLD_VERSION,
  SAVE_FORMAT_VERSION,
  activeStudios,
  allReleasedGames,
  genreMarket,
  isPlatformAvailable,
  platformAudience,
  platformDef,
  playerStudio,
  profitOf,
  scopeDef,
  trendOf,
} from '../../sim';
import type { GenreId, ReleasedGame, Studio } from '../../sim';
import { Badge, Bar, Button, KeyValue, Modal, Panel, Sparkline, Stat, Table } from '../components';
import { useGame } from '../store';
import { money, num, pct, score as fmtScore, shortDate, units } from '../format';
import { GameTable } from './parts';

export function IndustryScreen(): React.JSX.Element {
  const { state } = useGame();
  const studio = playerStudio(state);
  const [showDefunct, setShowDefunct] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const year = state.calendar.year;

  const all = Object.values(state.studios);
  const studios = useMemo(
    () =>
      all
        .filter((s) => showDefunct || s.status === 'active')
        .sort((a, b) => b.cash - a.cash || b.reputation - a.reputation),
    [all, showDefunct],
  );
  const games = allReleasedGames(state);
  const pickedStudio = picked ? state.studios[picked] : null;

  const playerRank = [...activeStudios(state)].sort((a, b) => b.cash - a.cash).findIndex((s) => s.isPlayer) + 1;
  const active = activeStudios(state);
  const marketShare = shareOfRevenue(games.filter((g) => g.releaseYear >= year - 1));
  const defunct = all.filter((s) => s.status !== 'active').length;

  return (
    <div className="stack">
      <div className="grid grid--stats">
        <Stat label="Active studios" value={num(active.length)} sub={`${defunct} closed down since ${state.config.startYear}`} />
        <Stat label="Your rank by cash" value={playerRank > 0 ? `#${playerRank}` : '—'} sub={`${money(studio.cash)} in the bank`} />
        <Stat label="Games released" value={num(games.length)} sub={`${num(games.filter((g) => g.releaseYear === year).length)} so far in ${year}`} />
        <Stat label="Industry revenue" value={money(games.reduce((a, g) => a + g.grossRevenue, 0))} sub={`paid to studios ${money(games.reduce((a, g) => a + g.revenue, 0))}`} />
        <Stat label="Install base" value={`${num(state.market.industryAudience, 1)}M`} sub={growthNote(state.market.industryAudience, state.market.industryAudienceLastYear)} tone={state.market.industryAudience > state.market.industryAudienceLastYear ? 'good' : 'warn'} />
        <Stat label="Competitors' average rep" value={num(active.filter((s) => !s.isPlayer).reduce((a, s) => a + s.reputation, 0) / Math.max(1, active.length - 1), 1)} sub="the field you are judged against" />
      </div>

      <div className="split">
        <div className="stack">
          <Panel
            title="Studios"
            dense
            actions={
              <Button small tone="ghost" onClick={() => setShowDefunct(!showDefunct)}>
                {showDefunct ? 'Hide closed' : 'Show closed'}
              </Button>
            }
          >
            <Table
              rows={studios}
              getKey={(s) => s.id}
              onRowClick={(s) => setPicked(s.id)}
              selectedKey={picked}
              maxHeight={420}
              columns={[
                {
                  key: 'n',
                  header: 'Studio',
                  render: (s) => (
                    <span>
                      {s.isPlayer ? <b>{s.name}</b> : s.name} {s.status !== 'active' && <Badge tone="bad">closed</Badge>}
                    </span>
                  ),
                  sortValue: (s) => s.name,
                },
                { key: 'y', header: 'Founded', align: 'right', render: (s) => s.foundedYear, sortValue: (s) => s.foundedYear },
                { key: 'c', header: 'Cash', align: 'right', render: (s) => <span className={s.cash < 0 ? 'neg' : ''}>{money(s.cash)}</span>, sortValue: (s) => s.cash },
                { key: 'r', header: 'Rep', align: 'right', render: (s) => <Bar value={s.reputation} max={100} height={5} label={<span className="mono">{num(s.reputation, 0)}</span>} tone={s.reputation >= 60 ? 'good' : s.reputation < 25 ? 'bad' : 'info'} />, sortValue: (s) => s.reputation },
                { key: 's', header: 'Staff', align: 'right', render: (s) => s.employeeIds.length, sortValue: (s) => s.employeeIds.length },
                { key: 'p', header: 'Projects', align: 'right', render: (s) => s.projectIds.length, sortValue: (s) => s.projectIds.length },
                { key: 'g', header: 'Games', align: 'right', render: (s) => s.releaseIds.length, sortValue: (s) => s.releaseIds.length },
                {
                  key: 'q',
                  header: 'Avg score',
                  align: 'right',
                  render: (s) => fmtScore(averageScore(state.releases, s)),
                  sortValue: (s) => averageScore(state.releases, s),
                },
                { key: 'sh', header: 'Share of 2y revenue', align: 'right', render: (s) => <span className="mono">{pct(marketShare.get(s.id) ?? 0, 1)}</span>, sortValue: (s) => marketShare.get(s.id) ?? 0 },
                { key: 'st', header: 'House style', render: (s) => <span className="hint">{s.ai?.style ?? '—'}</span> },
              ]}
            />
          </Panel>

          <Panel title="Genre market" dense>
            <Table
              rows={GENRE_ORDER.map((id) => ({ id, m: genreMarket(state.market, id as GenreId) }))}
              getKey={(r) => r.id}
              columns={[
                { key: 'g', header: 'Genre', render: (r) => <span title={GENRES[r.id].blurb}>{GENRES[r.id].name}</span> },
                { key: 'pop', header: 'Popularity', render: (r) => <Bar value={r.m.popularity} max={100} height={7} label={<span className="mono">{num(r.m.popularity, 0)}</span>} tone={r.m.popularity >= 70 ? 'good' : r.m.popularity <= 35 ? 'bad' : 'info'} />, sortValue: (r) => r.m.popularity },
                { key: 'trend', header: '3mo', align: 'right', render: (r) => <TrendCell value={r.m.popularity - r.m.popularityQuarterAgo} />, sortValue: (r) => r.m.popularity - r.m.popularityQuarterAgo },
                { key: 'd', header: 'Demand', align: 'right', render: (r) => <span className="mono">{num(r.m.demand, 0)}</span>, sortValue: (r) => r.m.demand },
                { key: 'c', header: 'Competition', align: 'right', render: (r) => <span className="mono" style={{ color: r.m.competition > 45 ? 'var(--bad)' : undefined }}>{num(r.m.competition, 0)}</span>, sortValue: (r) => r.m.competition },
                { key: 'f', header: 'Fatigue', align: 'right', render: (r) => <span className="mono">{num(r.m.fatigue, 0)}</span>, sortValue: (r) => r.m.fatigue },
                { key: 'hist', header: 'Year', render: (r) => <Sparkline values={r.m.history.slice(-12)} width={70} height={16} tone={trendOf(r.m) === 'rising' ? 'good' : trendOf(r.m) === 'falling' ? 'bad' : 'info'} /> },
                { key: 'g1', header: 'Games this yr', align: 'right', render: (r) => num(games.filter((g) => g.releaseYear === year && g.genreId === r.id).length) },
                { key: 'avg', header: 'Avg score', align: 'right', render: (r) => fmtScore(games.filter((g) => g.releaseYear === year && g.genreId === r.id).reduce((a, g) => a + g.reviewScore, 0) / Math.max(1, games.filter((g) => g.releaseYear === year && g.genreId === r.id).length)) },
                { key: 'unit', header: 'Units this yr', align: 'right', render: (r) => units(games.filter((g) => g.releaseYear === year && g.genreId === r.id).reduce((a, g) => a + g.unitsSold, 0)) },
              ]}
            />
          </Panel>

          <Panel title="Releases this year" dense>
            <GameTable
              games={games
                .filter((g) => g.releaseYear >= year - 1)
                .sort((a, b) => b.releaseTick - a.releaseTick)
                .slice(0, 25)}
              onPick={(g) => setPicked(g.studioId)}
              maxHeight={320}
            />
          </Panel>
        </div>

        <div className="stack">
          <Panel title="Hardware" dense>
            <Table
              rows={PLATFORM_ORDER.map((id) => ({ id, p: platformDef(id) }))}
              getKey={(r) => r.id}
              columns={[
                { key: 'n', header: 'Platform', render: (r) => (isPlatformAvailable(r.id, year) ? <b>{r.p.name}</b> : <span className="muted">{r.p.name}</span>) },
                { key: 'v', header: 'Vendor', render: (r) => <span className="hint">{r.p.vendor}</span> },
                { key: 'a', header: 'Installed', align: 'right', render: (r) => <span className="mono">{isPlatformAvailable(r.id, year) ? `${num(platformAudience(r.id, year), 1)}M` : '—'}</span>, sortValue: (r) => platformAudience(r.id, year) },
                { key: 'y', header: 'Years', align: 'right', render: (r) => <span className="mono muted">{r.p.introYear}–{r.p.retireYear}</span> },
                { key: 'c', header: 'Cut', align: 'right', render: (r) => <span className="mono">{pct(r.p.licenseCut, 0)}</span> },
                { key: 'k', header: 'Devkit', align: 'right', render: (r) => <span className="mono">{money(r.p.devkitCost)}</span> },
                { key: 'pp', header: 'Price', align: 'right', render: (r) => <span className="mono">{num(r.p.priceMult, 2)}×</span> },
                { key: 'gp', header: 'Graphics', align: 'right', render: (r) => <span className="mono">{num(r.p.graphicsPressure, 2)}</span> },
              ]}
            />
          </Panel>

          <Panel title="What a studio can expect" dense>
            <div style={{ padding: 10 }} className="small">
              <p className="hint" style={{ marginTop: 0 }}>
                A studio's launch pull is its critic-weighted quality against the genre's mood, so the market tables above change what the same game earns each month. Competition of{' '}
                {num(state.market.genres[GENRE_ORDER[0]].competition, 0)} in {GENRES[GENRE_ORDER[0]].name} alone costs {pct(1 / (1 + state.market.genres[GENRE_ORDER[0]].competition / BALANCE.sales.competitionHalfPoint), 0)} of
                its sales.
              </p>
              <KeyValue
                rows={[
                  ['Marketing conversion', `${money(BALANCE.sales.marketingRecommendedRatio * 100000)} per 100k of scope spend is the reference point`],
                  ['Crowding half-point', `${num(BALANCE.sales.competitionHalfPoint, 0)} competition halves a launch`],
                  ['Demand floor / ceiling', `${num(BALANCE.market.demandMin, 0)} / ${num(BALANCE.market.demandMax, 0)}`],
                  ['Demand regen', `${num(BALANCE.market.demandRegen, 1)} per month per million installed`],
                  ['Genre reversion', `${pct(BALANCE.market.popularityReversion, 0)} per month back to baseline`],
                ]}
              />
            </div>
          </Panel>

          <Panel title="Engine" dense>
            <div style={{ padding: 10 }}>
              <KeyValue
                rows={[
                  ['World version', String(WORLD_VERSION)],
                  ['Save format', String(SAVE_FORMAT_VERSION)],
                  ['Seed', String(state.seed)],
                  ['Tick', `${num(state.calendar.tick)} days · ${shortDate(state.calendar)}`],
                  ['Last tick', `${num(state.stats.lastTickMs, 2)} ms`],
                  ['Systems', SYSTEMS.map((s) => `${s.id} (${s.order})`).join(' · ')],
                  ['Events', `${num(state.events.entries.length)} kept / ${num(state.events.dropped)} dropped`],
                  ['AI actions', num(state.stats.aiActionsTaken)],
                  ['Commands', num(state.stats.commandsProcessed)],
                  ['Founded / closed', `${num(state.stats.studiosFounded)} / ${num(state.stats.studiosClosed)}`],
                ]}
              />
              <p className="hint" style={{ margin: '6px 0 0' }}>
                Every studio — yours and all {num(BALANCE.studio.aiCount)} rivals — is advanced by these systems in the same order, from the same state, with no special cases.
              </p>
            </div>
          </Panel>
        </div>
      </div>

      {pickedStudio && <StudioModal studio={pickedStudio} onClose={() => setPicked(null)} />}
    </div>
  );
}

function TrendCell({ value }: { value: number }): React.JSX.Element {
  const tone = value > 0.5 ? 'pos' : value < -0.5 ? 'neg' : 'muted';
  return (
    <span className={tone} style={{ fontFamily: 'var(--mono)' }}>
      {value >= 0 ? '+' : ''}
      {num(value, 1)}
    </span>
  );
}

function averageScore(releases: Record<string, ReleasedGame>, studio: Studio): number {
  const games = studio.releaseIds.map((id) => releases[id]).filter(Boolean);
  if (games.length === 0) return 0;
  return games.reduce((a, g) => a + (g?.reviewScore ?? 0), 0) / games.length;
}

function shareOfRevenue(games: readonly ReleasedGame[]): Map<string, number> {
  const map = new Map<string, number>();
  let total = 0;
  for (const g of games) {
    map.set(g.studioId, (map.get(g.studioId) ?? 0) + Math.max(0, g.grossRevenue));
    total += Math.max(0, g.grossRevenue);
  }
  if (total > 0) for (const [k, v] of map) map.set(k, v / total);
  return map;
}

function growthNote(now: number, before: number): string {
  if (before <= 0) return 'no prior year to compare';
  const pctChange = ((now - before) / before) * 100;
  return `${pctChange >= 0 ? '+' : ''}${pctChange.toFixed(1)}% year on year`;
}

function StudioModal({ studio, onClose }: { studio: Studio; onClose: () => void }): React.JSX.Element {
  const { state } = useGame();
  const games = studio.releaseIds.map((id) => state.releases[id]).filter((g): g is ReleasedGame => !!g);
  const profile = studio.ai;
  const strengths = GENRE_ORDER.map((id) => ({ id, value: studio.genreStrength[id as GenreId] ?? 0, count: games.filter((g) => g.genreId === id).length }))
    .filter((r) => r.value > 0 || r.count > 0)
    .sort((a, b) => b.value - a.value);
  const byYear = new Map<number, number>();
  for (const g of games) byYear.set(g.releaseYear, (byYear.get(g.releaseYear) ?? 0) + Math.max(0, profitOf(g)));
  const yearly = [...byYear.entries()].sort((a, b) => a[0] - b[0]);

  return (
    <Modal
      title={
        <span>
          {studio.name} {studio.isPlayer && <Badge tone="info">you</Badge>} <span className="muted">· founded {studio.foundedYear}</span> {studio.status !== 'active' && <Badge tone="bad">closed</Badge>}
        </span>
      }
      onClose={onClose}
      width={900}
    >
      <div className="stack">
        <div className="grid grid--stats">
          <Stat label="Cash" value={money(studio.cash)} tone={studio.cash < 0 ? 'bad' : 'good'} sub={`lifetime revenue ${money(studio.finances.lifetime.revenue)}`} />
          <Stat label="Reputation" value={num(studio.reputation, 1)} sub={`best review ${games.length ? Math.max(...games.map((g) => g.reviewScore)).toFixed(0) : '—'}`} />
          <Stat label="Staff" value={num(studio.employeeIds.length)} sub={`${studio.hires} hires · ${studio.layoffs} layoffs`} />
          <Stat label="Games" value={num(games.length)} sub={`${units(games.reduce((a, g) => a + g.unitsSold, 0))} units sold`} />
          <Stat label="Profit from games" value={money(games.reduce((a, g) => a + profitOf(g), 0), { sign: true })} tone={games.reduce((a, g) => a + profitOf(g), 0) >= 0 ? 'good' : 'bad'} />
          <Stat label="Projects running" value={num(studio.projectIds.length)} sub={studio.monthsBroke > 0 ? `${studio.monthsBroke} months in the red` : 'solvent'} tone={studio.monthsBroke > 0 ? 'bad' : 'neutral'} />
        </div>

        {profile ? (
          <Panel title="How it behaves" dense>
            <div className="grid grid--2" style={{ padding: 10 }}>
              <div className="stack">
                <Bar label={<span className="small">ambition {pct(profile.ambition, 0)}</span>} value={profile.ambition * 100} max={100} height={9} />
                <Bar label={<span className="small">risk appetite {pct(profile.riskAppetite, 0)}</span>} value={profile.riskAppetite * 100} max={100} height={9} tone="warn" />
                <Bar label={<span className="small">quality focus {pct(profile.qualityFocus, 0)}</span>} value={profile.qualityFocus * 100} max={100} height={9} tone="good" />
                <Bar label={<span className="small">marketing spend {pct(profile.marketingFocus, 0)}</span>} value={profile.marketingFocus * 100} max={100} height={9} tone="info" />
                <Bar label={<span className="small">hiring appetite {pct(profile.hiringAppetite, 0)}</span>} value={profile.hiringAppetite * 100} max={100} height={9} />
                <Bar label={<span className="small">adaptability {pct(profile.adaptability, 0)}</span>} value={profile.adaptability * 100} max={100} height={9} />
                <Bar label={<span className="small">staff loyalty {pct(profile.loyalty, 0)}</span>} value={profile.loyalty * 100} max={100} height={9} tone="bad" />
              </div>
              <div className="stack">
                <KeyValue
                  rows={[
                    ['Style', profile.style],
                    ['Stated goal', profile.tagline],
                    ['Chases', profile.preferredGenres.map((g) => GENRES[g].name).join(', ') || 'whatever sells'],
                    ['Last release', studio.lastReleaseTick >= 0 ? `${fmtScore(studio.lastReleaseReview)} score` : 'none'],
                  ]}
                />
                <div className="hint">These are the numbers the AI brain actually reads each month — the same systems run it that run you.</div>
              </div>
            </div>
          </Panel>
        ) : (
          <Panel title="Player studio">
            <p className="hint" style={{ margin: 0 }}>
              This is your studio: no AI profile, because the decisions are yours.
            </p>
          </Panel>
        )}

        {strengths.length > 0 && (
          <Panel title="Genre standing" dense>
            <div style={{ padding: 10 }} className="grid grid--3">
              {strengths.map((row) => (
                <div className="progressrow" key={row.id}>
                  <span className="progressrow__label">{GENRES[row.id].name}</span>
                  <Bar value={row.value * 100} max={100} height={6} tone={row.value > 0.5 ? 'good' : 'info'} />
                  <span className="progressrow__detail">
                    {pct(row.value, 0)} · {row.count}
                  </span>
                </div>
              ))}
            </div>
          </Panel>
        )}

        <div className="grid grid--2">
          <Panel title="Releases" dense>
            <Table
              rows={[...games].sort((a, b) => b.releaseTick - a.releaseTick).slice(0, 30)}
              getKey={(g) => g.id}
              emptyLabel="This studio has never shipped a game."
              maxHeight={260}
              columns={[
                { key: 't', header: 'Title', render: (g) => g.title },
                { key: 'y', header: 'Date', align: 'right', render: (g) => shortDate({ year: g.releaseYear, month: g.releaseMonth, day: g.releaseDay }) },
                { key: 'g', header: 'Genre', render: (g) => GENRES[g.genreId].name },
                { key: 's', header: 'Scope', render: (g) => scopeDef(g.scope).name },
                { key: 'sc', header: 'Score', align: 'right', render: (g) => fmtScore(g.reviewScore) },
                { key: 'u', header: 'Units', align: 'right', render: (g) => units(g.unitsSold) },
                { key: 'p', header: 'Profit', align: 'right', render: (g) => <span className={profitOf(g) >= 0 ? 'pos' : 'neg'}>{money(profitOf(g))}</span> },
              ]}
            />
          </Panel>
          <Panel title="Profit by year" dense>
            <div style={{ padding: 10 }}>
              {yearly.length > 1 ? <Sparkline values={yearly.map((y) => y[1])} width={380} height={54} tone="info" /> : <p className="empty" style={{ margin: 0 }}>Need two years of sales history.</p>}
              <Table
                rows={yearly.slice().reverse().slice(0, 8)}
                getKey={(row) => String(row[0])}
                emptyLabel="No sales history yet."
                columns={[
                  { key: 'y', header: 'Year', render: (row) => row[0] },
                  { key: 'p', header: 'Profit', align: 'right', render: (row) => <span className={row[1] >= 0 ? 'pos' : 'neg'}>{money(row[1], { sign: true })}</span> },
                  { key: 'c', header: 'Games', align: 'right', render: (row) => games.filter((g) => g.releaseYear === row[0]).length },
                ]}
              />
            </div>
          </Panel>
        </div>

        <div className="row row--between">
          <span className="hint">
            {Object.keys(PLATFORMS).length} platforms tracked · market state updated monthly from every studio's releases
          </span>
          <Button small tone="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}
