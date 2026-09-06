/**
 * Create Game: the decision screen. Every control is wired to the same projection the
 * simulation will use — quality ceilings, review score, sales and costs come from
 * `planProject`, so what you see here is what the engine will do, not a friendly guess.
 */

import { useMemo, useState } from 'react';
import {
  BALANCE,
  GENRES,
  GENRE_ORDER,
  Rng,
  ROLES,
  SCOPE_ORDER,
  PLATFORM_ORDER,
  availablePlatforms,
  createRngState,
  employeeValue,
  gameTitle,
  genreMarket,
  isPlatformAvailable,
  marketValue,
  platformAudience,
  platformDef,
  playerStudio,
  planProject,
  scopeDef,
  skillAverage,
  suggestBudget,
  trendOf,
  validateStartProject,
  effectiveSkill,
} from '../../sim';
import type { Employee, GenreId, PlatformId, ScopeId } from '../../sim';
import { Bar, Badge, Button, Field, KeyValue, Panel, Stat, Table } from '../components';
import { useGame } from '../store';
import { money, num, pct, score as fmtScore, units } from '../format';
import { QUALITY_LABELS, DIMENSION_HELP } from '../labels';

export function CreateGameScreen(): React.JSX.Element {
  const { state, dispatch } = useGame();
  const studio = playerStudio(state);
  const year = state.calendar.year;
  const live = availablePlatforms(year);
  const busy = useMemo(() => {
    const set = new Set<string>();
    for (const id of studio.projectIds) {
      const p = state.projects[id];
      if (p && p.status !== 'released' && p.status !== 'cancelled') for (const e of p.teamIds) set.add(e);
    }
    return set;
  }, [state, studio.projectIds]);
  const available = studio.employeeIds.map((id) => state.employees[id]).filter((e): e is Employee => !!e && !busy.has(e.id));

  const [title, setTitle] = useState(() => suggestTitle('action', 1));
  const [genreId, setGenreId] = useState<GenreId>('action');
  const [platformId, setPlatformId] = useState<PlatformId>(() => (isPlatformAvailable('pc', year) ? 'pc' : (live[0]?.id ?? 'pc')) as PlatformId);
  const [scope, setScope] = useState<ScopeId>('small');
  const [risk, setRisk] = useState(0.35);
  const [crunch, setCrunch] = useState(false);
  const [teamIds, setTeamIds] = useState<string[]>(() => available.slice(0, 4).map((e) => e.id));
  const scopeInfo = scopeDef(scope);
  const neededBudget = suggestBudget(scope, Math.max(1, teamIds.length), Math.round(scopeInfo.workUnits / Math.max(0.4, teamIds.length * 0.85)), platformId);
  const [budget, setBudget] = useState(() => Math.min(studio.cash, neededBudget));
  const [marketing, setMarketing] = useState(() => Math.round(scopeDef('small').marketingBase));

  const draft = {
    studioId: studio.id,
    title,
    genreId,
    platformId,
    scope,
    teamIds,
    budget: Math.round(budget),
    marketing: Math.round(marketing),
    risk,
    crunch,
  };
  const plan = useMemo(() => planProject(state, draft), [state, draft.studioId, draft.title, draft.genreId, draft.platformId, draft.scope, draft.teamIds.join(','), draft.budget, draft.marketing, draft.risk, draft.crunch]);
  const check = validateStartProject(state, {
    title: draft.title,
    genreId: draft.genreId,
    platformId: draft.platformId,
    scope: draft.scope,
    budget: draft.budget,
    teamIds: draft.teamIds,
    risk: draft.risk,
    marketing: draft.marketing,
  });
  const genre = GENRES[genreId];
  const platform = platformDef(platformId);
  const marketGenre = genreMarket(state.market, genreId);
  const canStart = check.ok && plan.blockers.length === 0;

  return (
    <div className="split">
      <div className="stack">
        <div className="grid grid--stats">
          <Stat label="Cash" value={money(studio.cash)} tone={studio.cash < 0 ? 'bad' : 'neutral'} sub={`${num(available.length)} of ${num(studio.employeeIds.length)} staff free`} />
          <Stat label="This project" value={money(plan.cashCommitted)} sub={`budget ${money(budget)} · marketing ${money(marketing)} · devkit ${money(plan.devkitCost)}`} tone={plan.cashCommitted > studio.cash ? 'bad' : 'neutral'} />
          <Stat label="Left after starting" value={money(studio.cash - plan.cashCommitted)} sub={`wages alone are ${money(plan.labourCost)}`} tone={studio.cash - plan.cashCommitted < 0 ? 'bad' : 'good'} />
          <Stat label="Studio burn" value={`${money(BALANCE.studio.overheadBase + studio.employeeIds.length * BALANCE.studio.overheadPerEmployee)}/mo`} sub="overhead, paid whatever you ship" />
        </div>

        <Panel title="1 · The game">
          <div className="stack">
            <div className="row">
              <Field label="Working title">
                <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={42} />
              </Field>
              <div style={{ alignSelf: 'flex-end' }}>
                <Button
                  onClick={() => {
                    setTitle(suggestTitle(genreId, Math.floor(Math.random() * 1e9)));
                  }}
                  title="Titles are player input, so they never touch the simulation's RNG stream"
                >
                  Roll a title
                </Button>
              </div>
            </div>

            <div>
              <div className="field__label" style={{ marginBottom: 4 }}>
                Genre — {genre.blurb}
              </div>
              <div className="cardrow">
                {GENRE_ORDER.map((id) => {
                  const m = genreMarket(state.market, id);
                  return (
                    <div key={id} className={`card ${id === genreId ? 'is-active' : ''}`} onClick={() => setGenreId(id)} title={`${GENRES[id].blurb}\nEssential roles: ${GENRES[id].essentialRoles.join(', ')}`}>
                      <div className="card__name">{GENRES[id].name}</div>
                      <div className="row row--tight" style={{ gap: 4 }}>
                        <span className="mono small">{num(m.popularity, 0)}</span>
                        <span className="small muted">pop</span>
                        <span className={`small ${trendOf(m) === 'rising' ? 'pos' : trendOf(m) === 'falling' ? 'neg' : 'muted'}`}>{trendOf(m) === 'rising' ? '▲' : trendOf(m) === 'falling' ? '▼' : '►'}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div>
              <div className="field__label" style={{ marginBottom: 4 }}>
                Scope — {scopeInfo.blurb}
              </div>
              <div className="cardrow">
                {SCOPE_ORDER.map((id) => {
                  const sc = scopeDef(id);
                  return (
                    <div key={id} className={`card ${id === scope ? 'is-active' : ''}`} onClick={() => setScope(id)} title={`${sc.workUnits} work units · quality ceiling ${sc.qualityCap} · ${sc.minTeam}-${sc.optimalTeam} people`}>
                      <div className="card__name">{sc.name}</div>
                      <div className="small muted">
                        cap {sc.qualityCap} · team {sc.minTeam}–{sc.optimalTeam}
                      </div>
                      <div className="small mono">{money(sc.recommendedBudget)}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div>
              <div className="field__label" style={{ marginBottom: 4 }}>
                Platform — {platform.blurb}
              </div>
              <div className="cardrow">
                {PLATFORM_ORDER.filter((id) => isPlatformAvailable(id, year)).map((id) => {
                  const p = platformDef(id);
                  const audience = platformAudience(id, year);
                  return (
                    <div key={id} className={`card ${id === platformId ? 'is-active' : ''}`} onClick={() => setPlatformId(id as PlatformId)} title={`Retires ${p.retireYear} · licence cut ${pct(p.licenseCut, 0)} · devkit ${money(p.devkitCost)}`}>
                      <div className="card__name">{p.name}</div>
                      <div className="small muted">
                        {p.vendor} · {num(audience, 1)}M installed
                      </div>
                      <div className="small mono">
                        {pct(p.genreAffinity[genreId] ? p.genreAffinity[genreId] - 1 : 0, 0)} this genre · cut {pct(p.licenseCut, 0)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </Panel>

        <Panel title="2 · Money and effort">
          <div className="grid grid--2">
            <Field label={`Budget — ${money(budget)}`} hint={`a properly staffed ${scopeInfo.name.toLowerCase()} project costs about ${money(plan.recommendedBudget)}. Underfunding lowers every quality ceiling.`}>
              <div className="row">
                <input type="range" min={0} max={Math.max(50000, Math.round(plan.recommendedBudget * 1.6))} step={5000} value={budget} onChange={(e) => setBudget(Number(e.target.value))} />
                <Button small onClick={() => setBudget(Math.round(Math.min(plan.recommendedBudget, studio.cash - marketing - plan.devkitCost)))}>
                  Suggested
                </Button>
              </div>
            </Field>
            <Field label={`Marketing — ${money(marketing)}`} hint={`${money(plan.recommendedMarketing)} is what this scope can convert at your reputation. Below half of that, fewer people show up at launch.`}>
              <div className="row">
                <input type="range" min={0} max={Math.max(20000, Math.round(plan.recommendedMarketing * 2))} step={2000} value={marketing} onChange={(e) => setMarketing(Number(e.target.value))} />
                <Button small onClick={() => setMarketing(Math.round(plan.recommendedMarketing))}>
                  Recommended
                </Button>
              </div>
            </Field>
            <Field label={`Ambition — ${risk < 0.25 ? 'safe sequel territory' : risk < 0.55 ? 'some new ideas' : risk < 0.8 ? 'distinctive' : 'untrodden ground'}`} hint="Innovation rises, polish and bug risk rise with it.">
              <input type="range" min={0} max={1} step={0.05} value={risk} onChange={(e) => setRisk(Number(e.target.value))} />
            </Field>
            <Field label="Schedule" hint="Crunch adds ~32% output, more bugs and a morale hit that can cost you the team.">
              <div className="row">
                <Button small tone={crunch ? 'danger' : 'default'} onClick={() => setCrunch(!crunch)}>
                  {crunch ? 'Crunch: on' : 'Crunch: off'}
                </Button>
                <span className="hint">{pct(plan.fundingRatio, 0)} of the budget the scope needs</span>
              </div>
            </Field>
          </div>
        </Panel>

        <Panel
          title={`3 · Team (${teamIds.length})`}
          actions={
            <div className="row row--tight">
              <Button small onClick={() => setTeamIds(available.slice(0, scopeInfo.optimalTeam).map((e) => e.id))} title={`Highest-value free staff, up to the ${scopeInfo.name.toLowerCase()} sweet spot`}>
                Auto-pick
              </Button>
              <Button small onClick={() => setTeamIds(available.map((e) => e.id))}>
                Everyone free
              </Button>
              <Button small tone="ghost" onClick={() => setTeamIds([])}>
                Clear
              </Button>
            </div>
          }
          dense
        >
          {studio.employeeIds.length === 0 ? (
            <p className="empty" style={{ padding: 10 }}>
              You have nobody to assign. Hire first — the Studio screen lists the open labour market.
            </p>
          ) : (
            <Table
              rows={available}
              getKey={(e) => e.id}
              emptyLabel="Everyone is busy on another project."
              maxHeight={230}
              columns={[
                {
                  key: 'pick',
                  header: '',
                  width: 26,
                  render: (e) => <input type="checkbox" checked={teamIds.includes(e.id)} onChange={() => setTeamIds(teamIds.includes(e.id) ? teamIds.filter((id) => id !== e.id) : [...teamIds, e.id])} />,
                },
                { key: 'n', header: 'Name', render: (e) => (teamIds.includes(e.id) ? <b>{e.name}</b> : e.name), sortValue: (e) => e.name },
                { key: 'r', header: 'Role', render: (e) => ROLES[e.role].name },
                { key: 'a', header: 'Avg', align: 'right', render: (e) => fmtScore(skillAverage(e)), sortValue: (e) => skillAverage(e) },
                { key: 'eff', header: 'Role skill', align: 'right', render: (e) => fmtScore(effectiveSkill(e)), sortValue: (e) => effectiveSkill(e) },
                { key: 'm', header: 'Morale', align: 'right', render: (e) => <span className={e.morale < 40 ? 'neg' : ''}>{num(e.morale, 0)}</span>, sortValue: (e) => e.morale },
                { key: 'l', header: 'Loyalty', align: 'right', render: (e) => num(e.loyalty, 0), sortValue: (e) => e.loyalty },
                { key: 's', header: 'Salary', align: 'right', render: (e) => <span className="mono">{money(e.salary)}</span>, sortValue: (e) => e.salary },
                { key: 'v', header: 'Value', align: 'right', render: (e) => <span className="mono">{num(employeeValue(e), 0)}</span>, sortValue: (e) => employeeValue(e) },
                {
                  key: 'cost',
                  header: 'Adds',
                  align: 'right',
                  render: (e) => (
                    <span className="hint mono" title={`Signing on this person costs ${money(marketValue(e) * BALANCE.hiring.signingBonusMonths)} up front`}>
                      {money((e.salary / BALANCE.time.workDaysPerMonth) * 22)}
                    </span>
                  ),
                },
              ]}
            />
          )}
        </Panel>
      </div>

      <div className="stack">
        <Panel title="Projection" dense>
          <div className="stack" style={{ padding: 10 }}>
            <div className="row row--between">
              <div>
                <div className="hint">projected review score</div>
                <div className="mono" style={{ fontSize: 30, lineHeight: 1 }} title="Mean of what each publication would score this, before bugs and press noise">
                  <span className={plan.reviewScore >= 70 ? 'pos' : plan.reviewScore < 45 ? 'neg' : ''}>{num(plan.reviewScore, 1)}</span>
                  <span className="muted" style={{ fontSize: 14 }}>
                    {' '}
                    / 100
                  </span>
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="hint">players would rate</div>
                <div className="mono" style={{ fontSize: 20 }}>
                  {num(plan.receptionScore, 0)}
                </div>
              </div>
            </div>

            <div className="qbars">
              {plan.dims.map((d) => (
                <div className="qbars__row" key={d.dim} title={`${DIMENSION_HELP[d.dim]}\nCeiling for this team, scope, budget and platform: ${d.cap.toFixed(1)}`}>
                  <span className="qbars__label">{QUALITY_LABELS[d.dim].slice(0, 4)}</span>
                  <div style={{ position: 'relative' }}>
                    <Bar value={d.projected} max={100} height={9} tone={d.projected >= 75 ? 'good' : d.projected >= 50 ? 'info' : 'warn'} />
                    <div style={{ position: 'absolute', top: -2, bottom: -2, left: `${Math.min(100, d.cap)}%`, width: 2, background: 'var(--text-mute)' }} title={`ceiling ${d.cap.toFixed(0)}`} />
                  </div>
                  <span className="qbars__value">{Math.round(d.projected)}</span>
                  <span className="qbars__weight">{pct(d.weight, 0)}</span>
                </div>
              ))}
            </div>
            <div className="hint" style={{ marginTop: -2 }}>
              The tick marks are the ceilings this team can reach on {platform.name} at this budget and scope. The grey line beyond your bar is talent and money running out.
            </div>

            <KeyValue
              rows={[
                ['Development', `${money(plan.labourCost + plan.toolingCost)} over ${Number.isFinite(plan.totalDays) ? plan.totalDays : '∞'} days`],
                ['— wages / tooling', `${money(plan.labourCost)} / ${money(plan.toolingCost)}`],
                ['Devkit licence', money(plan.devkitCost)],
                ['Marketing', money(plan.marketingCost)],
                ['Retail price', `$${plan.price.toFixed(2)}`],
                ['Launch week', `${units(plan.openingUnits)} units`],
                ['First-year total', `${units(plan.lifetimeUnits)} units`],
                ['Gross revenue', money(plan.grossRevenue)],
                ['After platform cut', money(plan.netRevenue)],
                ['Break-even', `${num(plan.breakEvenUnits)} units`],
                ['Projected profit', <span key="pp" className={plan.projectedProfit >= 0 ? 'pos' : 'neg'}>{money(plan.projectedProfit, { sign: true })}</span>],
                ['Market', `${genre.name} popularity ${num(marketGenre.popularity, 0)} · demand ${num(marketGenre.demand, 0)} · competition ${num(marketGenre.competition, 0)}`],
              ]}
            />
            {plan.warnings.length > 0 && (
              <ul className="warnlist">
                {plan.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            )}
            {plan.blockers.length > 0 && (
              <ul className="blockers">
                {plan.blockers.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            )}
            <div className="row row--between">
              <div className="row row--tight">
                <Badge tone={plan.cashCommitted > studio.cash ? 'bad' : 'info'}>spends {money(plan.cashCommitted)}</Badge>
                <Badge tone={plan.projectedProfit > 0 ? 'good' : 'warn'}>pays back in {plan.lifetimeUnits > 0 ? Math.max(1, Math.round((plan.breakEvenUnits / plan.lifetimeUnits) * 12)) : '∞'} months at that rate</Badge>
              </div>
              <Button
                tone="primary"
                disabled={!canStart}
                onClick={() => {
                  if (!canStart) return;
                  dispatch({
                    type: 'startProject',
                    payload: { title: title.trim(), genreId, platformId, scope, budget: Math.round(budget), teamIds, risk, marketing: Math.round(marketing) },
                  });
                }}
                title={!canStart ? plan.blockers[0] ?? check.error ?? 'Not ready' : 'Commit the money and start the clock'}
              >
                Start development
              </Button>
            </div>
            {check.detail && <p className="hint" style={{ margin: 0 }}>{check.detail}</p>}
          </div>
        </Panel>

        <Panel title="Why it looks like that" dense>
          <div style={{ padding: 10 }} className="small">
            <p className="hint" style={{ marginTop: 0 }}>
              {genre.name} reviewers weigh {topWeights(genre.criticWeights)}, so those dimensions move the score most. Buyers weigh {topWeights(genre.audienceWeights)} — a game can score badly with
              critics and still sell, and the reverse.
            </p>
            <p className="hint">
              {platform.name} takes {pct(platform.licenseCut, 0)} of gross plus {platform.unitCost > 0 ? `$${platform.unitCost.toFixed(2)} per unit in manufacturing` : 'no manufacturing cost'}, and its
              audience is {num(platformAudience(platformId, year), 1)}M. Graphics pressure on this hardware for this genre is {num(platform.graphicsPressure, 2)}.
            </p>
            <p className="hint" style={{ marginBottom: 0 }}>
              {teamIds.length} people produce {plan.workPerDay.toFixed(2)} work units a day; a {scopeInfo.name.toLowerCase()} project needs {num(scopeInfo.workUnits)} and pays {money(scopeInfo.recommendedBudget)} to
              do it justice.
            </p>
          </div>
        </Panel>
      </div>
    </div>
  );
}

function suggestTitle(genreId: GenreId, seed: number): string {
  const rng = new Rng(createRngState(seed >>> 0));
  return gameTitle(rng, genreId);
}

function topWeights(weights: Record<string, number>): string {
  const entries = Object.entries(weights).filter(([, v]) => v > 0);
  entries.sort((a, b) => b[1] - a[1]);
  return entries
    .slice(0, 2)
    .map(([k, v]) => `${QUALITY_LABELS[k as keyof typeof QUALITY_LABELS] ?? k} (${pct(v, 0)})`)
    .join(' and ');
}
