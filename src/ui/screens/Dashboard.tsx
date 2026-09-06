/**
 * Dashboard: the one-screen answer to "how is my studio doing and what is the industry
 * doing right now". Every figure is read from state; nothing is computed here.
 */

import {
  GENRE_ORDER,
  GENRES,
  activeProjectIds,
  activeStudios,
  allReleasedGames,
  analyzeTeam,
  averageQuality,
  employeeOf,
  estimateRemainingDays,
  genreMarket,
  missingRolesFor,
  monthlyBurn,
  monthlyOverhead,
  monthlySalaryBill,
  playerStudio,
  recentEvents,
  releasesOfStudio,
  runwayMonths,
  scopeDef,
  studioHeadcount,
  trendOf,
} from '../../sim';
import type { Employee, GenreId, Project, Studio, WorldState } from '../../sim';
import { Badge, Bar, Button, Panel, QualityBars, Sparkline, Stat, Table } from '../components';
import { useGame } from '../store';
import { money, num, score as fmtScore, shortDate, units } from '../format';
import { profitOf } from '../../sim';
import { EventFeed, QualitySummary, Trend } from './parts';

export function DashboardScreen(): React.JSX.Element {
  const { state, dispatch } = useGame();
  const studio = playerStudio(state);
  const burn = monthlyBurn(state, studio.id);
  const lastMonth = studio.finances.months[studio.finances.months.length - 1];
  const myGames = releasesOfStudio(state, studio.id);
  const best = [...myGames].sort((a, b) => b.reviewScore - a.reviewScore)[0];
  const projects = activeProjectIds(studio)
    .map((id) => state.projects[id])
    .filter((p): p is Project => !!p);
  const feed = recentEvents(state.events, 14);
  const all = allReleasedGames(state);
  const thisYear = all.filter((g) => g.releaseYear === state.calendar.year);
  const topSales = [...thisYear].sort((a, b) => b.unitsSold - a.unitsSold).slice(0, 6);
  const leaderboard = [...activeStudios(state)].sort((a, b) => b.cash - a.cash || b.reputation - a.reputation);
  const talking = state.market.talkingAboutReleaseId ? state.releases[state.market.talkingAboutReleaseId] : null;
  const lifetimeUnits = myGames.reduce((acc, g) => acc + g.unitsSold, 0);
  const idleStaff = studio.employeeIds.length - projects.reduce((acc, p) => acc + p.teamIds.length, 0);

  return (
    <div className="stack">
      <div className="grid grid--stats">
        <Stat
          label="Cash"
          value={money(studio.cash)}
          sub={runwayMonths(studio.cash, burn) === Infinity ? 'no burn' : `${runwayMonths(studio.cash, burn).toFixed(1)} months of runway`}
          tone={studio.cash < 0 ? 'bad' : studio.cash < burn * 2 ? 'warn' : 'good'}
        />
        <Stat
          label="Last month"
          value={lastMonth ? money(lastMonth.net, { sign: true }) : '—'}
          sub={lastMonth ? `revenue ${money(lastMonth.revenue)} · costs ${money(lastMonth.salaries + lastMonth.overhead + lastMonth.development + lastMonth.marketing + lastMonth.other)}` : 'first month'}
          tone={!lastMonth ? 'neutral' : lastMonth.net >= 0 ? 'good' : 'bad'}
        />
        <Stat
          label="Monthly burn"
          value={money(burn)}
          sub={`wages ${money(monthlySalaryBill(state, studio.id))} · overhead ${money(monthlyOverhead(state, studio.id))}`}
          tone={studio.cash < burn * 3 ? 'warn' : 'neutral'}
        />
        <Stat
          label="Reputation"
          value={num(studio.reputation, 1)}
          sub={studio.reputation >= 60 ? 'the industry returns your calls' : studio.reputation >= 25 ? 'known to a few people' : 'nobody has heard of you'}
          tone={studio.reputation >= 60 ? 'good' : studio.reputation < 15 ? 'bad' : 'neutral'}
        />
        <Stat
          label="Staff"
          value={num(studioHeadcount(studio))}
          sub={idleStaff > 0 ? `${idleStaff} not assigned to a project` : projects.length > 0 ? `${projects.length} project${projects.length > 1 ? 's' : ''} running` : 'everyone is idle'}
          tone={studioHeadcount(studio) === 0 ? 'bad' : 'neutral'}
        />
        <Stat label="Games shipped" value={num(myGames.length)} sub={best ? `best score ${fmtScore(best.reviewScore)}` : 'nothing released yet'} />
        <Stat label="Units sold" value={units(lifetimeUnits)} sub={`${money(myGames.reduce((acc, g) => acc + g.revenue, 0))} lifetime revenue`} />
        <Stat label="Industry" value={`${leaderboard.length} studios`} sub={`${all.length} games in history · ${thisYear.length} released this year`} />
      </div>

      <div className="split">
        <div className="stack">
          <Panel
            title="Your projects"
            actions={<span className="hint">{projects.length === 0 ? 'idle studio' : `${projects.length} running · ${projects.reduce((a, p) => a + p.teamIds.length, 0)} assigned`}</span>}
            dense
          >
            <Table
              rows={projects}
              getKey={(p) => p.id}
              emptyLabel="No game in development. Start one from Create Game — a studio earns nothing while its people sit idle."
              columns={[
                {
                  key: 'title',
                  header: 'Project',
                  render: (p) => (
                    <div>
                      <div style={{ fontWeight: 600 }}>{p.title}</div>
                      <div className="muted small">
                        {GENRES[p.genreId].name} · {scopeDef(p.scope).name} · {p.teamIds.length} staff{p.crunch ? ' · crunch' : ''} · {p.status}
                      </div>
                    </div>
                  ),
                },
                {
                  key: 'progress',
                  header: 'Progress',
                  render: (p) => (
                    <div style={{ minWidth: 140 }}>
                      <Bar value={Math.min(1, p.progress) * 100} max={100} height={9} label={`${Math.round(p.progress * 100)}%`} tone={p.progress >= 1 ? 'good' : 'info'} />
                      <div className="muted small" style={{ marginTop: 2 }}>
                        {p.bugs > 0 ? `${Math.round(p.bugs)} open issues` : 'clean build'}
                        {missingRolesFor(state, p).length > 0 && <span className="neg"> · no {missingRolesFor(state, p).join(', ')}</span>}
                      </div>
                    </div>
                  ),
                },
                { key: 'quality', header: 'Quality', align: 'right', render: (p) => fmtScore(averageQuality(p.quality)) },
                {
                  key: 'eta',
                  header: 'ETA',
                  align: 'right',
                  render: (p) => {
                    const days = daysLeft(state, p);
                    return <span className="mono">{Number.isFinite(days) ? `${days}d` : '—'}</span>;
                  },
                },
                {
                  key: 'money',
                  header: 'Spent',
                  align: 'right',
                  render: (p) => (
                    <div>
                      <div className="mono">{money(p.spent)}</div>
                      <div className="muted small mono">of {money(p.budget)}</div>
                    </div>
                  ),
                },
                {
                  key: 'ship',
                  header: '',
                  align: 'right',
                  render: (p) => (
                    <Button small tone="primary" disabled={p.progress < 0.2} onClick={() => dispatch({ type: 'releaseGame', projectId: p.id })} title={p.progress < 0.2 ? 'Too incomplete to ship' : 'Release now'}>
                      Ship
                    </Button>
                  ),
                },
              ]}
            />
          </Panel>

          <Panel title="Market pulse" dense>
            <Table
              rows={GENRE_ORDER.map((id) => ({ id, m: genreMarket(state.market, id) }))}
              getKey={(r) => r.id}
              columns={[
                { key: 'g', header: 'Genre', render: (r) => GENRES[r.id].name },
                {
                  key: 'pop',
                  header: 'Popularity',
                  width: 130,
                  render: (r) => <Bar value={r.m.popularity} max={100} height={8} label={`${Math.round(r.m.popularity)}`} tone={r.m.popularity >= 70 ? 'good' : r.m.popularity <= 35 ? 'bad' : 'info'} />,
                },
                { key: 'trend', header: 'Trend', align: 'right', render: (r) => <Trend direction={trendOf(r.m)} delta={r.m.popularity - r.m.popularityQuarterAgo} /> },
                { key: 'demand', header: 'Demand', align: 'right', render: (r) => <span className="mono">{num(r.m.demand, 0)}</span> },
                { key: 'comp', header: 'Competition', align: 'right', render: (r) => <span className="mono" style={{ color: r.m.competition > 40 ? 'var(--bad)' : undefined }}>{num(r.m.competition, 0)}</span> },
                { key: 'live', header: 'In dev', align: 'right', render: (r) => <span className="mono">{projectsInGenre(state, r.id)}</span> },
                { key: 'hist', header: '12 months', render: (r) => <Sparkline values={r.m.history.slice(-12)} width={70} height={16} tone={trendOf(r.m) === 'rising' ? 'good' : trendOf(r.m) === 'falling' ? 'bad' : 'info'} /> },
              ]}
            />
          </Panel>

          <Panel title="Best sellers this year" dense>
            <Table
              rows={topSales}
              getKey={(g) => g.id}
              emptyLabel="No releases yet this year."
              columns={[
                { key: 't', header: 'Title', render: (g) => (g.isPlayerGame ? <b>{g.title}</b> : g.title) },
                { key: 's', header: 'Studio', render: (g) => g.studioName },
                { key: 'g', header: 'Genre', render: (g) => GENRES[g.genreId].name },
                { key: 'sc', header: 'Score', align: 'right', render: (g) => fmtScore(g.reviewScore) },
                { key: 'u', header: 'Units', align: 'right', render: (g) => units(g.unitsSold) },
                { key: 'r', header: 'Revenue', align: 'right', render: (g) => money(g.revenue) },
              ]}
            />
          </Panel>
        </div>

        <div className="stack">
          {talking && (
            <Panel title="What the industry is talking about">
              <div className="row row--between">
                <div>
                  <div style={{ fontSize: 15, fontWeight: 650 }}>{talking.title}</div>
                  <div className="muted small">
                    {talking.studioName} · {GENRES[talking.genreId].name} · {num(talking.unitsSold)} units
                  </div>
                  <QualitySummary game={talking} />
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="mono" style={{ fontSize: 20 }}>
                    {fmtScore(talking.reviewScore)}
                  </div>
                  <div className="muted small">consensus</div>
                </div>
              </div>
            </Panel>
          )}

          <Panel title="Industry leaderboard" dense>
            <Table
              rows={leaderboard.slice(0, 10)}
              getKey={(s) => s.id}
              columns={[
                { key: 'n', header: 'Studio', render: (s) => (s.isPlayer ? <b>{s.name} *</b> : s.name) },
                { key: 'c', header: 'Cash', align: 'right', render: (s) => <span className={s.cash < 0 ? 'neg' : ''}>{money(s.cash)}</span> },
                { key: 'r', header: 'Rep', align: 'right', render: (s) => num(s.reputation, 0) },
                { key: 'p', header: 'Games', align: 'right', render: (s) => s.releaseIds.length },
                { key: 'q', header: 'Avg', align: 'right', render: (s) => fmtScore(averageStudioScore(state, s)) },
              ]}
            />
          </Panel>

          {myGames.length > 0 && (
            <Panel title="Your latest release">
              {(() => {
                const g = myGames[myGames.length - 1];
                return (
                  <div className="stack">
                    <div>
                      <div style={{ fontWeight: 650, fontSize: 14 }}>{g.title}</div>
                      <div className="muted small">
                        {shortDate({ year: g.releaseYear, month: g.releaseMonth, day: g.releaseDay })} · {GENRES[g.genreId].name} · {g.sales.length} weeks on sale
                      </div>
                    </div>
                    <div className="row row--between">
                      <Badge tone={g.reviewScore >= 70 ? 'good' : g.reviewScore < 45 ? 'bad' : 'warn'}>press {fmtScore(g.reviewScore)}</Badge>
                      <Badge tone={g.reception.score >= 70 ? 'good' : 'neutral'}>players {num(g.reception.score, 0)}</Badge>
                      <span className="mono">{units(g.unitsSold)} units</span>
                      <span className={`mono ${profitOf(g) >= 0 ? 'pos' : 'neg'}`}>{money(profitOf(g))}</span>
                    </div>
                    <QualityBars quality={g.quality} />
                    <Sparkline values={g.sales.map((s) => s.units)} width={260} height={34} />
                    <p className="hint" style={{ margin: 0 }}>
                      {g.reception.headline}
                    </p>
                  </div>
                );
              })()}
            </Panel>
          )}

          <Panel title="Industry feed" dense>
            <EventFeed events={feed} />
          </Panel>
        </div>
      </div>
    </div>
  );
}

/** Team of a live project, rolled up the same way the development system does it. */
function daysLeft(state: WorldState, project: Project): number {
  const team = project.teamIds.map((id) => employeeOf(state, id)).filter((e): e is Employee => !!e);
  const analysis = analyzeTeam(team, { crunch: project.crunch, scope: project.scope });
  return estimateRemainingDays(project, analysis);
}

function projectsInGenre(state: WorldState, genreId: GenreId): number {
  let n = 0;
  for (const id of Object.keys(state.projects).sort()) {
    const p = state.projects[id];
    if (p && p.genreId === genreId && p.status !== 'released' && p.status !== 'cancelled') n++;
  }
  return n;
}

function averageStudioScore(state: WorldState, studio: Studio): number {
  const games = studio.releaseIds.map((id) => state.releases[id]).filter(Boolean);
  if (games.length === 0) return 0;
  return games.reduce((acc, g) => acc + (g?.reviewScore ?? 0), 0) / games.length;
}
