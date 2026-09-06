/**
 * Projects: one live project at a time, with the quality readout, the money, the team and
 * every decision the player can make about it (staffing, crunch, marketing, budget, ship).
 */

import { useState } from 'react';
import {
  BALANCE,
  GENRES,
  ROLES,
  activeProjectIds,
  analyzeTeam,
  averageQuality,
  bugTarget,
  completeness,
  effectiveSkill,
  employeeOf,
  employeeWorkRate,
  genreInterest,
  estimateRemainingDays,
  missingRolesFor,
  payRatio,
  planProject,
  playerStudio,
  polishRatio,
  recommendedMarketingFor,
  scopeDef,
  skillAverage,
  validateRelease,
} from '../../sim';
import type { Employee, GameEvent, Project, QualityDimensionId, WorldState } from '../../sim';
import { QUALITY_DIMENSIONS } from '../../sim';
import { Badge, Bar, Button, Field, KeyValue, Panel, QualityBars, Stat, Table } from '../components';
import { useGame } from '../store';
import { money, num, pct, score as fmtScore, shortDate } from '../format';
import { QUALITY_LABELS, DIMENSION_HELP } from '../labels';

export function ProjectsScreen(): React.JSX.Element {
  const { state } = useGame();
  const studio = playerStudio(state);
  const projects = activeProjectIds(studio)
    .map((id) => state.projects[id])
    .filter((p): p is Project => !!p);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = projects.find((p) => p.id === selectedId) ?? projects[0] ?? null;

  if (projects.length === 0) {
    return (
      <Panel title="No projects in development">
        <p className="hint">This studio has nothing in the pipeline. Every day a developer sits unassigned you still pay their salary and they slowly lose morale.</p>
        <p className="hint">Use <b>Create Game</b> (or press 4) to scope a project; the screen will project the quality, the review score and the money before you commit.</p>
      </Panel>
    );
  }

  return (
    <div className="split">
      <div className="stack">
        <Panel title="In development" dense>
          <Table
            rows={projects}
            getKey={(p) => p.id}
            onRowClick={(p) => setSelectedId(p.id)}
            selectedKey={selected?.id ?? null}
            columns={[
              { key: 't', header: 'Project', render: (p) => <b>{p.title}</b> },
              { key: 'g', header: 'Genre · scope', render: (p) => `${GENRES[p.genreId].name} · ${scopeDef(p.scope).name}` },
              { key: 'p', header: 'Progress', render: (p) => <Bar value={Math.min(1, p.progress) * 100} max={100} height={8} label={`${Math.round(p.progress * 100)}%`} tone={p.progress >= 1 ? 'good' : 'info'} /> },
              { key: 'q', header: 'Quality', align: 'right', render: (p) => fmtScore(averageQuality(p.quality)), sortValue: (p) => averageQuality(p.quality) },
              { key: 'b', header: 'Bugs', align: 'right', render: (p) => <span className={p.bugs > bugTarget(p) ? 'neg' : ''}>{Math.round(p.bugs)}</span>, sortValue: (p) => p.bugs },
              { key: 's', header: 'Status', align: 'right', render: (p) => <Badge tone={p.status === 'ready' ? 'good' : p.status === 'stalled' ? 'bad' : 'neutral'}>{p.status}</Badge> },
            ]}
          />
        </Panel>
        {selected && <ProjectDetail project={selected} />}
      </div>
      <div className="stack">{selected && <ProjectSide project={selected} />}</div>
    </div>
  );
}

function ProjectDetail({ project }: { project: Project }): React.JSX.Element {
  const { state, dispatch } = useGame();
  const studio = playerStudio(state);
  const team = project.teamIds.map((id) => employeeOf(state, id)).filter((e): e is Employee => !!e);
  const analysis = analyzeTeam(team, { crunch: project.crunch, scope: project.scope });
  const daysLeft = estimateRemainingDays(project, analysis);
  const recommended = recommendedMarketingFor(project.scope, project.platformId, studio.reputation);
  const missing = missingRolesFor(state, project);
  const releaseCheck = validateRelease(state, project.id);
  const burnPerDay = team.reduce((a, e) => a + e.salary / BALANCE.time.workDaysPerMonth + BALANCE.development.toolingCostPerDev, 0);
  const budgetLeft = project.budget - project.spent;

  return (
    <>
      <Panel
        title={`${project.title} — quality`}
        actions={<span className="hint">current vs the ceiling this project can reach</span>}
        dense
      >
        <div className="stack" style={{ padding: 10 }}>
          <div className="qbars">
            {QUALITY_DIMENSIONS.map((dim: QualityDimensionId) => {
              const value = project.quality[dim] ?? 0;
              return (
                <div className="qbars__row" key={dim} title={DIMENSION_HELP[dim]}>
                  <span className="qbars__label">{QUALITY_LABELS[dim].slice(0, 4)}</span>
                  <Bar value={value} max={100} height={9} tone={value >= 75 ? 'good' : value >= 50 ? 'info' : 'warn'} />
                  <span className="qbars__value">{Math.round(value)}</span>
                  <span className="qbars__weight">{pct(GENRES[project.genreId].criticWeights[dim] ?? 0, 0)}</span>
                </div>
              );
            })}
          </div>
          <div className="row row--between small">
            <span className="muted">
              {completeness(project) < 1 ? `${pct(completeness(project), 0)} of the design is built` : 'Design complete'} · polish {pct(polishRatio(project), 0)} · bugs {Math.round(project.bugs)}/{Math.round(project.bugsPeak)} found
            </span>
            <span className="mono">{fmtScore(averageQuality(project.quality))} avg quality</span>
          </div>
          {missing.length > 0 && (
            <p className="hint neg" style={{ margin: 0 }}>
              Nobody on the team covers {missing.join(', ')} — those dimensions will stall. The AI hires for exactly this reason.
            </p>
          )}
        </div>
      </Panel>

      <Panel
        title="Release decision"
        actions={
          <div className="row row--tight">
            <Button small onClick={() => dispatch({ type: 'setCrunch', projectId: project.id, value: !project.crunch })} title="Faster now, worse later">
              {project.crunch ? 'Stop crunch' : 'Crunch'}
            </Button>
            <Button small onClick={() => dispatch({ type: 'topUpBudget', projectId: project.id, amount: Math.max(25000, Math.round(project.budget * 0.25)) })}>
              Top up {money(Math.max(25000, Math.round(project.budget * 0.25)))}
            </Button>
            <Button small tone="primary" disabled={!releaseCheck.ok} onClick={() => dispatch({ type: 'releaseGame', projectId: project.id })}>
              Release
            </Button>
            <Button small tone="danger" onClick={() => dispatch({ type: 'cancelProject', projectId: project.id })}>
              Cancel
            </Button>
          </div>
        }
      >
        <div className="stack">
          <div className="grid grid--stats">
            <Stat label="Progress" value={pct(Math.min(1, project.progress), 0)} sub={daysLeft === Infinity ? 'no team' : `~${daysLeft} days left`} tone={project.progress >= 1 ? 'good' : 'neutral'} />
            <Stat label="Bug backlog" value={num(project.bugs)} sub={`shippable at ${bugTarget(project).toFixed(0)}`} tone={project.bugs <= bugTarget(project) ? 'good' : 'warn'} />
            <Stat label="Budget left" value={money(budgetLeft)} sub={`${pct(budgetLeft / Math.max(1, project.budget), 0)} of ${money(project.budget)}`} tone={budgetLeft <= 0 ? 'bad' : 'neutral'} />
            <Stat label="Burn" value={`${money(burnPerDay)}/day`} sub={project.crunch ? 'crunching: +32% output, +25% bugs' : 'wages attributed to the project'} />
            <Stat label="Marketing set" value={money(project.marketing)} sub={`recommended ${money(recommended)}`} tone={project.marketing >= recommended * 0.8 ? 'good' : 'warn'} />
          </div>
          <Field label={`Marketing committed at release — ${money(project.marketing)}`} hint={`${pct(project.marketing / Math.max(1, recommended), 0)} of what this scope can convert (cap ${money(Math.floor(studio.cash))}).`}>
            <input type="range" min={0} max={Math.max(1000, Math.round(recommended * 2))} step={1000} value={Math.min(project.marketing, Math.max(1000, Math.round(recommended * 2)))} onChange={(e) => dispatch({ type: 'setMarketing', projectId: project.id, amount: Number(e.target.value) })} />
          </Field>
          {releaseCheck.detail && <p className="hint" style={{ margin: 0 }}>{releaseCheck.detail}</p>}
          {!releaseCheck.ok && <p className="hint neg" style={{ margin: 0 }}>{releaseCheck.error}</p>}
        </div>
      </Panel>

      <Panel title="Team" dense>
        <Table
          rows={team}
          getKey={(e) => e.id}
          emptyLabel="Nobody is assigned. Tick people in the roster on the right."
          columns={[
            { key: 'n', header: 'Name', render: (e) => e.name },
            { key: 'r', header: 'Role', render: (e) => ROLES[e.role].name },
            { key: 'p', header: `Primary`, align: 'right', render: (e) => <span className="mono">{num(e.skills[ROLES[e.role].primary], 0)}</span> },
            { key: 'a', header: 'Avg', align: 'right', render: (e) => fmtScore(skillAverage(e)) },
            { key: 'm', header: 'Morale', render: (e) => <Bar value={e.morale} max={100} height={5} tone={e.morale >= 65 ? 'good' : e.morale < 40 ? 'bad' : 'warn'} />, sortValue: (e) => e.morale },
            { key: 'eff', header: 'Role skill', align: 'right', render: (e) => <span className="mono">{num(effectiveSkill(e), 0)}</span> },
            { key: 'fit', header: 'Genre fit', align: 'right', render: (e) => <Badge tone={genreInterest(e, project.genreId) >= 1.05 ? 'good' : 'neutral'}>{pct(genreInterest(e, project.genreId) - 1, 0)}</Badge>, sortValue: (e) => genreInterest(e, project.genreId) },
            { key: 'pay', header: 'Pay vs market', align: 'right', render: (e) => <span className={payRatio(e) < 0.9 ? 'neg' : 'muted'}>{pct(payRatio(e) - 1, 0)}</span>, sortValue: (e) => payRatio(e) },
            { key: 'w', header: 'Work/day', align: 'right', render: (e) => <span className="mono">{employeeWorkRate(e, project.crunch).toFixed(2)}</span> },
          ]}
        />
      </Panel>
    </>
  );

}

function ProjectSide({ project }: { project: Project }): React.JSX.Element {
  const { state, dispatch } = useGame();
  const studio = playerStudio(state);
  const staff = studio.employeeIds.map((id) => state.employees[id]).filter((e): e is Employee => !!e);
  const assigned = new Set(project.teamIds);
  const busyElsewhere = new Map<string, string>();
  for (const otherId of studio.projectIds) {
    const other = state.projects[otherId];
    if (!other || other.id === project.id) continue;
    for (const empId of other.teamIds) busyElsewhere.set(empId, other.title);
  }

  const toggle = (employeeId: string): void => {
    const next = new Set(assigned);
    if (next.has(employeeId)) next.delete(employeeId);
    else next.add(employeeId);
    dispatch({ type: 'setTeam', projectId: project.id, teamIds: [...next] });
  };

  const plan = planProject(state, {
    studioId: studio.id,
    title: project.title,
    genreId: project.genreId,
    platformId: project.platformId,
    scope: project.scope,
    teamIds: project.teamIds,
    budget: Math.max(project.budget, project.spent),
    marketing: project.marketing,
    risk: project.risk,
    crunch: project.crunch,
  });

  return (
    <>
      <Panel title="Where this is heading" dense>
        <div className="stack" style={{ padding: 10 }}>
          <KeyValue
            rows={[
              ['Projected review', <b key="r" className={plan.reviewScore >= 70 ? 'pos' : plan.reviewScore < 45 ? 'neg' : ''}>{num(plan.reviewScore, 1)}</b>],
              ['Projected player score', num(plan.receptionScore, 0)],
              ['Projected units', num(plan.lifetimeUnits)],
              ['Projected revenue', money(plan.grossRevenue)],
              ['Projected profit', <span key="p" className={plan.projectedProfit >= 0 ? 'pos' : 'neg'}>{money(plan.projectedProfit, { sign: true })}</span>],
              ['Days remaining', Number.isFinite(plan.totalDays) ? `${plan.totalDays} (incl. ${plan.daysToPolish} polishing)` : '—'],
              ['Funding', `${pct(plan.fundingRatio, 0)} of a proper ${scopeDef(project.scope).name.toLowerCase()} budget`],
            ]}
          />
          <p className="hint" style={{ margin: 0 }}>
            Projection from the live models, assuming the current team stays on it and you ship at feature-complete plus a normal polish pass.
          </p>
          {plan.warnings.length > 0 && (
            <ul className="warnlist">
              {plan.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
        </div>
      </Panel>

      <Panel title="Roster" dense>
        <div className="teamgrid" style={{ padding: 8 }}>
          {staff.map((e) => {
            const on = assigned.has(e.id);
            const other = busyElsewhere.get(e.id);
            return (
              <div
                key={e.id}
                className={`teamgrid__item ${on ? 'is-on' : ''}`}
                onClick={() => toggle(e.id)}
                title={`${ROLES[e.role].name} · avg ${skillAverage(e).toFixed(0)} · morale ${Math.round(e.morale)}${other ? `\nCurrently on "${other}"` : ''}`}
              >
                <input type="checkbox" checked={on} readOnly style={{ pointerEvents: 'none' }} />
                <span>
                  {e.name}
                  {other && !on && <span className="muted"> · {other.slice(0, 12)}</span>}
                </span>
                <span className="teamgrid__skill">{Math.round(skillAverage(e))}</span>
              </div>
            );
          })}
        </div>
      </Panel>

      <Panel title="Quality dimensions" dense>
        <div style={{ padding: 10 }}>
          <QualityBars quality={project.quality} weights={GENRES[project.genreId].criticWeights} />
        </div>
      </Panel>

      <Panel title="Project log" dense>
        <div style={{ padding: 8 }}>
          {recentProjectEvents(state, project).map((e) => (
            <div key={e.id} className="small" style={{ marginBottom: 4 }}>
              <span className="muted mono">{shortDate({ year: e.year, month: e.month, day: e.day })}</span> {e.title}
            </div>
          ))}
          {recentProjectEvents(state, project).length === 0 && <p className="empty" style={{ margin: 0 }}>No events for this project yet.</p>}
        </div>
      </Panel>
    </>
  );
}

function recentProjectEvents(state: WorldState, project: Project): GameEvent[] {
  return state.events.entries.filter((e) => e.title.includes(project.title)).slice(-8).reverse();
}
