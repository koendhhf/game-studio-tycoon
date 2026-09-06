/**
 * Studio screen: the people, the money and the name.
 *
 * Employees tab lists staff and the open labour market, with hiring, pay and layoffs.
 * Finances tab lists the ledger. Reputation tab shows what the industry thinks of you and
 * why. All of the numbers come from the simulation; this file only decides where to put them.
 */

import { useMemo, useState } from 'react';
import {
  GENRES,
  GENRE_ORDER,
  ROLES,
  ROLE_ORDER,
  BALANCE,
  candidatesInPool,
  employeeValue,
  effectiveSkill,
  hireUpfrontCost,
  listingCost,
  marketValue,
  moraleBand,
  payRatio,
  playerStudio,
  poachOffer,
  poachSusceptibility,
  releasesOfStudio,
  roleCounts,
  skillAverage,
  skillBand,
} from '../../sim';
import type { Employee, EmployeeId, RoleId } from '../../sim';
import { Bar, Badge, Button, Field, KeyValue, Modal, Panel, QualityBars, Sparkline, Stat, Table, Tabs } from '../components';
import { useGame } from '../store';
import { money, moneyExact, num, pct, score as fmtScore, shortDate } from '../format';
import { ROLE_LABELS, isGoodTrait, traitBlurb, traitName } from '../labels';

type Tab = 'staff' | 'market' | 'finances' | 'reputation';

export function StudioScreen(): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('staff');
  const [detail, setDetail] = useState<EmployeeId | null>(null);
  const { state } = useGame();
  const studio = playerStudio(state);
  const staff = studio.employeeIds.map((id) => state.employees[id]).filter((e): e is Employee => !!e);
  const candidates = candidatesInPool(state);
  const selected = detail ? state.employees[detail] : null;

  return (
    <div className="stack">
      <Tabs
        tabs={[
          { id: 'staff' as Tab, label: `Staff (${staff.length})` },
          { id: 'market' as Tab, label: `Labour market (${candidates.length})` },
          { id: 'finances' as Tab, label: 'Finances' },
          { id: 'reputation' as Tab, label: 'Reputation' },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'staff' && <StaffTab staff={staff} onPick={setDetail} />}
      {tab === 'market' && <MarketTab candidates={candidates} />}
      {tab === 'finances' && <FinanceTab />}
      {tab === 'reputation' && <ReputationTab />}

      {selected && <EmployeeModal employee={selected} onClose={() => setDetail(null)} />}
    </div>
  );
}

function StaffTab({ staff, onPick }: { staff: Employee[]; onPick: (id: string) => void }): React.JSX.Element {
  const { state, dispatch } = useGame();
  const counts = roleCounts(state, playerStudio(state).id);
  const studio = playerStudio(state);
  const gamesByAuthor = useMemo(() => {
    const released = releasesOfStudio(state, studio.id);
    const map = new Map<string, number>();
    for (const g of released) for (const c of g.credits) map.set(c.employeeId, (map.get(c.employeeId) ?? 0) + 1);
    return map;
  }, [state, studio.id]);

  const moraleAvg = staff.length > 0 ? staff.reduce((a, e) => a + e.morale, 0) / staff.length : 0;
  const underpaid = staff.filter((e) => payRatio(e) < 0.9);
  const poachable = staff.filter((e) => e.morale < 45 && payRatio(e) < 1);

  return (
    <div className="stack">
      <div className="grid grid--stats">
        <Stat label="Headcount" value={num(staff.length)} sub={`${num(staff.reduce((a, e) => a + e.workUnitsShipped, 0) / 1000, 1)}k work units shipped`} />
        <Stat label="Payroll" value={`${money(staff.reduce((a, e) => a + e.salary, 0))}/mo`} sub={`avg ${money(staff.length ? staff.reduce((a, e) => a + e.salary, 0) / staff.length : 0)}`} />
        <Stat label="Average morale" value={num(moraleAvg, 0)} sub={moraleBand(moraleAvg)} tone={moraleAvg >= 68 ? 'good' : moraleAvg < 40 ? 'bad' : 'warn'} />
        <Stat label="Average skill" value={num(staff.length ? staff.reduce((a, e) => a + skillAverage(e), 0) / staff.length : 0, 1)} sub={skillBand(staff.length ? staff.reduce((a, e) => a + skillAverage(e), 0) / staff.length : 0)} />
        <Stat label="Underpaid" value={num(underpaid.length)} sub={underpaid.length > 0 ? 'morale is bleeding' : 'everyone is at market rate'} tone={underpaid.length > 0 ? 'warn' : 'good'} />
        <Stat label="Flight risk" value={num(poachable.length)} sub={poachable.length > 0 ? 'competitors can afford to try' : 'nobody is quietly looking'} tone={poachable.length > 2 ? 'bad' : 'good'} />
      </div>

      <Panel title="Your people" dense actions={<span className="hint">click a row for skills, traits and actions</span>}>
        <Table
          rows={staff}
          getKey={(e) => e.id}
          onRowClick={(e) => onPick(e.id)}
          selectedKey={null}
          emptyLabel="You have nobody. Hire from the labour market tab."
          columns={[
            { key: 'name', header: 'Name', render: (e) => <b>{e.name}</b>, sortValue: (e) => e.name },
            { key: 'role', header: 'Role', render: (e) => ROLES[e.role].name, sortValue: (e) => e.role },
            { key: 'primary', header: 'Primary skill', align: 'right', render: (e) => <span className="mono">{num(e.skills[ROLES[e.role].primary], 0)}</span>, sortValue: (e) => e.skills[ROLES[e.role].primary] },
            { key: 'avg', header: 'Avg', align: 'right', render: (e) => fmtScore(skillAverage(e)), sortValue: (e) => skillAverage(e) },
            { key: 'eff', header: 'Role-weighted', align: 'right', render: (e) => fmtScore(effectiveSkill(e)), sortValue: (e) => effectiveSkill(e) },
            { key: 'salary', header: 'Salary', align: 'right', render: (e) => <span className="mono">{money(e.salary)}</span>, sortValue: (e) => e.salary },
            {
              key: 'pay',
              header: 'Pay vs market',
              render: (e) => {
                const ratio = payRatio(e);
                return (
                  <div style={{ minWidth: 90 }} title={`market value ${moneyExact(marketValue(e))}`}>
                    <Bar value={ratio * 100} max={140} height={6} tone={ratio >= 1 ? 'good' : ratio >= 0.9 ? 'warn' : 'bad'} />
                    <span className="muted small mono">{pct(ratio - 1, 0)}</span>
                  </div>
                );
              },
              sortValue: (e) => payRatio(e),
            },
            {
              key: 'morale',
              header: 'Morale',
              render: (e) => <Bar value={e.morale} max={100} height={6} label={<span className="mono">{Math.round(e.morale)}</span>} tone={e.morale >= 68 ? 'good' : e.morale >= 45 ? 'info' : 'bad'} />,
              sortValue: (e) => e.morale,
            },
            { key: 'loyal', header: 'Loyalty', align: 'right', render: (e) => num(e.loyalty, 0), sortValue: (e) => e.loyalty },
            { key: 'xp', header: 'Exp', align: 'right', render: (e) => num(e.experience, 1), sortValue: (e) => e.experience },
            { key: 'games', header: 'Games', align: 'right', render: (e) => gamesByAuthor.get(e.id) ?? 0, sortValue: (e) => gamesByAuthor.get(e.id) ?? 0 },
            {
              key: 'traits',
              header: 'Traits',
              render: (e) => <TraitList ids={e.traits} />,
            },
            {
              key: 'actions',
              header: '',
              align: 'right',
              render: (e) => (
                <div className="row row--tight" style={{ justifyContent: 'flex-end' }}>
                  <Button small onClick={() => raise(e)} title={`Match market value (${moneyExact(marketValue(e))})`}>
                    Match pay
                  </Button>
                  <Button small tone="danger" onClick={() => dispatch({ type: 'fire', employeeId: e.id })} title={`Severance ${moneyExact(e.salary * BALANCE.hiring.severanceMonths)}`}>
                    Fire
                  </Button>
                </div>
              ),
            },
          ]}
          maxHeight={440}
        />
      </Panel>

      <Panel title="Coverage" dense>
        <div className="grid grid--3" style={{ padding: 10 }}>
          {ROLE_ORDER.map((role: RoleId) => (
            <div key={role} className="row row--between small" title={ROLES[role].blurb}>
              <span>{ROLES[role].name}</span>
              <span className="mono">
                {counts[role]} <span className="muted">· {money(ROLES[role].salaryMult * BALANCE.employee.salaryBase)} base</span>
              </span>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );

  function raise(employee: Employee): void {
    dispatch({ type: 'setSalary', employeeId: employee.id, salary: Math.round(marketValue(employee)) });
  }
}

function TraitList({ ids }: { ids: readonly string[] }): React.JSX.Element {
  if (ids.length === 0) return <span className="muted">—</span>;
  return (
    <span title={ids.map((t) => `${traitName(t)}: ${traitBlurb(t)}`).join('\n')}>
      {ids.map((t) => (
        <Badge key={t} tone={isGoodTrait(t) ? 'good' : 'bad'}>
          {traitName(t)}
        </Badge>
      ))}
    </span>
  );
}

function MarketTab({ candidates }: { candidates: Employee[] }): React.JSX.Element {
  const { state, dispatch } = useGame();
  const studio = playerStudio(state);
  const [role, setRole] = useState<RoleId | 'any'>('any');
  const [minSkill, setMinSkill] = useState(0);
  const [sort, setSort] = useState<'value' | 'skill' | 'salary'>('value');
  const affordable = candidates.filter((c) => studio.cash >= hireUpfrontCost(c));
  const filtered = candidates
    .filter((c) => (role === 'any' || c.role === role) && skillAverage(c) >= minSkill)
    .sort((a, b) => (sort === 'skill' ? skillAverage(b) - skillAverage(a) : sort === 'salary' ? a.salary - b.salary : employeeValue(b) - employeeValue(a)));

  return (
    <div className="stack">
      <div className="grid grid--stats">
        <Stat label="Applicants" value={num(candidates.length)} sub={`${num(affordable.length)} you can afford`} />
        <Stat label="Cash" value={money(studio.cash)} sub={`hiring costs a ${pct(BALANCE.hiring.signingBonusMonths, 0)} signing bonus`} tone={studio.cash < 0 ? 'bad' : 'neutral'} />
        <Stat label="Rep effect" value={pct(BALANCE.hiring.repHireBonus, 0)} sub="bonus on applicant quality from your reputation" />
        <Stat
          label="Your listing"
          value={state.listings.filter((l) => l.studioId === studio.id).length > 0 ? 'active' : 'none'}
          sub="post one to pull better applicants for a role"
          tone={state.listings.some((l) => l.studioId === studio.id) ? 'good' : 'warn'}
        />
      </div>

      <Panel
        title="Open labour market"
        dense
        actions={
          <div className="row row--tight">
            <select value={role} onChange={(e) => setRole(e.target.value as RoleId | 'any')} className="mono" style={{ background: 'var(--bg-inset)', border: '1px solid var(--line)', borderRadius: 4, padding: '2px 6px' }}>
              <option value="any">All roles</option>
              {ROLE_ORDER.map((r) => (
                <option key={r} value={r}>
                  {ROLES[r].name}
                </option>
              ))}
            </select>
            <label className="row row--tight small muted">
              min skill
              <input type="range" min={0} max={80} step={5} value={minSkill} onChange={(e) => setMinSkill(Number(e.target.value))} style={{ width: 90 }} />
              <span className="mono">{minSkill}</span>
            </label>
            <select value={sort} onChange={(e) => setSort(e.target.value as 'value' | 'skill' | 'salary')} style={{ background: 'var(--bg-inset)', border: '1px solid var(--line)', borderRadius: 4, padding: '2px 6px' }}>
              <option value="value">Best value</option>
              <option value="skill">Highest skill</option>
              <option value="salary">Cheapest</option>
            </select>
            <Button
              small
              onClick={() => dispatch({ type: 'postJobListing', roles: role === 'any' ? [] : [role], prestige: 0.5 })}
              title={`Costs ${moneyExact(listingCost(0.5))} and widens the applicant pool next month`}
            >
              Post listing
            </Button>
          </div>
        }
      >
        <Table
          rows={filtered}
          getKey={(e) => e.id}
          emptyLabel="Nobody in the pool matches this filter."
          maxHeight={460}
          columns={[
            { key: 'name', header: 'Name', render: (e) => <b>{e.name}</b>, sortValue: (e) => e.name },
            { key: 'role', header: 'Role', render: (e) => ROLES[e.role].name },
            { key: 'avg', header: 'Avg skill', align: 'right', render: (e) => fmtScore(skillAverage(e)), sortValue: (e) => skillAverage(e) },
            {
              key: 'dims',
              header: 'Strengths',
              render: (e) => <span className="mono small">{topDims(e)}</span>,
            },
            { key: 'xp', header: 'Exp', align: 'right', render: (e) => num(e.experience, 1), sortValue: (e) => e.experience },
            { key: 'potential', header: 'Potential', align: 'right', render: (e) => <Bar value={e.potential * 100} max={140} height={5} />, sortValue: (e) => e.potential },
            {
              key: 'traits',
              header: 'Traits',
              render: (e) => <TraitList ids={e.traits} />,
            },
            { key: 'asking', header: 'Asking', align: 'right', render: (e) => <span className="mono">{money(e.salary)}/mo</span>, sortValue: (e) => e.salary },
            { key: 'value', header: 'Market value', align: 'right', render: (e) => <span className="mono">{money(marketValue(e))}/mo</span>, sortValue: (e) => marketValue(e) },
            {
              key: 'hire',
              header: '',
              align: 'right',
              render: (e) => {
                const canAfford = studio.cash >= hireUpfrontCost(e);
                return (
                  <div className="row row--tight" style={{ justifyContent: 'flex-end' }}>
                    <Button small onClick={() => dispatch({ type: 'hire', candidateId: e.id, offerSalary: Math.round(Math.max(e.salary * 0.85, marketValue(e) * 0.95)) })} disabled={!canAfford}>
                      Hire {money(e.salary)}
                    </Button>
                    <Button small tone="primary" onClick={() => dispatch({ type: 'hire', candidateId: e.id, offerSalary: marketValue(e) })} disabled={!canAfford} title="Offer their market value — the most likely to be accepted">
                      Match
                    </Button>
                  </div>
                );
              },
            },
          ]}
        />
      </Panel>

      {candidates.length > 0 && (
        <Panel title="Role mix in the pool" dense>
          <div className="grid grid--3" style={{ padding: 10 }}>
            {ROLE_ORDER.map((r) => {
              const pool = candidates.filter((c) => c.role === r);
              const avg = pool.length ? pool.reduce((a, c) => a + skillAverage(c), 0) / pool.length : 0;
              return (
                <div key={r} className="row row--between small">
                  <span>{ROLES[r].name}</span>
                  <span className="mono muted">
                    {pool.length} people · avg {avg.toFixed(0)} · asking {money(pool.length ? pool.reduce((a, c) => a + c.salary, 0) / pool.length : 0)}
                  </span>
                </div>
              );
            })}
          </div>
        </Panel>
      )}
    </div>
  );
}

function topDims(e: Employee): string {
  const dims = Object.entries(e.skills) as [string, number][];
  dims.sort((a, b) => b[1] - a[1]);
  return dims
    .slice(0, 2)
    .map(([d, v]) => `${d.slice(0, 3)} ${Math.round(v)}`)
    .join(' · ');
}

function FinanceTab(): React.JSX.Element {
  const { state } = useGame();
  const studio = playerStudio(state);
  const months = studio.finances.months;
  const lifetime = studio.finances.lifetime;
  const cashSeries = months.map((m) => m.closingCash);
  const revenueSeries = months.map((m) => m.revenue - m.salaries - m.overhead - m.development - m.marketing - m.other);
  const best = months.reduce((a, m) => Math.max(a, m.net), 0);
  const worst = months.reduce((a, m) => Math.min(a, m.net), 0);
  const games = releasesOfStudio(state, studio.id);

  return (
    <div className="stack">
      <div className="grid grid--stats">
        <Stat label="Cash" value={money(studio.cash)} tone={studio.cash < 0 ? 'bad' : 'good'} sub={`peak ${money(lifetime.peakCash)} · low ${money(lifetime.lowestCash)}`} />
        <Stat label="Lifetime revenue" value={money(lifetime.revenue)} sub={`${num(lifetime.unitsSold)} units sold`} />
        <Stat label="Salaries paid" value={money(lifetime.salaries)} sub={`${months.length} months of payroll`} />
        <Stat label="Overhead" value={money(lifetime.overhead)} sub={`${money(BALANCE.studio.overheadBase)} base + ${money(BALANCE.studio.overheadPerEmployee)} per head`} />
        <Stat label="Development" value={money(lifetime.development)} sub={`marketing ${money(lifetime.marketing)}`} />
        <Stat label="Best / worst month" value={`${money(best)} / ${money(worst)}`} tone={worst < 0 ? 'warn' : 'good'} />
      </div>

      <div className="grid grid--2">
        <Panel title="Cash over time" dense>
          <div style={{ padding: 10 }}>
            <Sparkline values={cashSeries} width={520} height={70} tone={cashSeries[cashSeries.length - 1] >= 0 ? 'good' : 'bad'} />
            <div className="hint">{months.length === 0 ? 'The first ledger row appears after your first full month.' : `${shortDate({ year: months[0].year, month: months[0].month, day: 1 })} → ${shortDate({ year: months[months.length - 1].year, month: months[months.length - 1].month, day: 1 })}`}</div>
          </div>
        </Panel>
        <Panel title="Net result per month" dense>
          <div style={{ padding: 10 }}>
            <Sparkline values={revenueSeries} width={520} height={70} tone={revenueSeries.length > 0 && revenueSeries[revenueSeries.length - 1] >= 0 ? 'good' : 'bad'} />
            <div className="hint">Revenue minus wages, overhead, development, marketing and interest.</div>
          </div>
        </Panel>
      </div>

      <Panel title="Monthly ledger" dense>
        <Table
          rows={[...months].reverse().slice(0, 48)}
          getKey={(m) => `${m.year}-${m.month}`}
          emptyLabel="No closed months yet."
          maxHeight={360}
          columns={[
            { key: 'd', header: 'Month', render: (m) => shortDate({ year: m.year, month: m.month, day: 1 }) },
            { key: 'open', header: 'Opening', align: 'right', render: (m) => <span className="mono">{money(m.openingCash)}</span> },
            { key: 'rev', header: 'Revenue', align: 'right', render: (m) => <span className="mono pos">{money(m.revenue)}</span> },
            { key: 'sal', header: 'Salaries', align: 'right', render: (m) => <span className="mono neg">{money(-m.salaries)}</span> },
            { key: 'oh', header: 'Overhead', align: 'right', render: (m) => <span className="mono neg">{money(-m.overhead)}</span> },
            { key: 'dev', header: 'Development', align: 'right', render: (m) => <span className="mono neg">{money(-m.development)}</span> },
            { key: 'mkt', header: 'Marketing', align: 'right', render: (m) => <span className="mono neg">{money(-m.marketing)}</span> },
            { key: 'oth', header: 'Other', align: 'right', render: (m) => <span className={`mono ${m.other < 0 ? 'pos' : 'neg'}`}>{money(-m.other)}</span> },
            { key: 'net', header: 'Net', align: 'right', render: (m) => <span className={`mono ${m.net >= 0 ? 'pos' : 'neg'}`}>{money(m.net, { sign: true })}</span> },
            { key: 'close', header: 'Closing', align: 'right', render: (m) => <span className="mono">{money(m.closingCash)}</span> },
          ]}
        />
      </Panel>

      <Panel title="Per-game economics" dense>
        <Table
          rows={games.slice().reverse()}
          getKey={(g) => g.id}
          emptyLabel="You have not released anything yet."
          maxHeight={260}
          columns={[
            { key: 't', header: 'Game', render: (g) => g.title },
            { key: 'd', header: 'Released', align: 'right', render: (g) => shortDate({ year: g.releaseYear, month: g.releaseMonth, day: g.releaseDay }) },
            { key: 'dev', header: 'Dev cost', align: 'right', render: (g) => <span className="mono">{money(g.developmentCost)}</span> },
            { key: 'mkt', header: 'Marketing', align: 'right', render: (g) => <span className="mono">{money(g.marketingSpend)}</span> },
            { key: 'gross', header: 'Gross revenue', align: 'right', render: (g) => <span className="mono">{money(g.grossRevenue)}</span> },
            { key: 'net', header: 'Revenue paid in', align: 'right', render: (g) => <span className="mono">{money(g.revenue)}</span> },
            { key: 'roi', header: 'ROI', align: 'right', render: (g) => <span className={`mono ${g.roi >= 1 ? 'pos' : 'neg'}`}>{g.roi.toFixed(2)}×</span> },
            { key: 'p', header: 'Profit', align: 'right', render: (g) => <span className={`mono ${g.revenue - g.developmentCost - g.marketingSpend >= 0 ? 'pos' : 'neg'}`}>{money(g.revenue - g.developmentCost - g.marketingSpend, { sign: true })}</span> },
          ]}
        />
      </Panel>
    </div>
  );
}

function ReputationTab(): React.JSX.Element {
  const { state } = useGame();
  const studio = playerStudio(state);
  const games = releasesOfStudio(state, studio.id);
  const byGenre = GENRE_ORDER.map((id) => ({ id, strength: studio.genreStrength[id] ?? 0, games: games.filter((g) => g.genreId === id) }))
    .filter((r) => r.games.length > 0 || r.strength > 0)
    .sort((a, b) => b.games.length - a.games.length);
  const last = [...games].reverse().slice(0, 10);
  const rivals = Object.values(state.studios)
    .filter((s) => s.status === 'active' && !s.isPlayer)
    .sort((a, b) => b.reputation - a.reputation)
    .slice(0, 5);

  return (
    <div className="stack">
      <div className="grid grid--stats">
        <Stat label="Reputation" value={num(studio.reputation, 1)} sub={`${studio.reputation >= 60 ? 'strong' : studio.reputation >= 25 ? 'recognised' : 'unknown'}`} tone={studio.reputation >= 60 ? 'good' : studio.reputation < 15 ? 'bad' : 'warn'} />
        <Stat label="Rank" value={`#${1 + Object.values(state.studios).filter((s) => s.status === 'active' && !s.isPlayer && s.reputation > studio.reputation).length}`} sub={`of ${Object.values(state.studios).filter((s) => s.status === 'active').length} active studios`} />
        <Stat label="Hiring pull" value={pct(BALANCE.hiring.repHireBonus * (studio.reputation / 100), 0)} sub="extra applicant quality from your name" />
        <Stat label="Awareness" value={pct(Math.min(1, studio.reputation / 100) * 0.35, 0)} sub="share of launch buyers who already know you" />
        <Stat label="Reviews (last 5)" value={last.length ? fmtScore(last.slice(0, 5).reduce((a, g) => a + g.reviewScore, 0) / Math.min(5, last.length)) : '—'} sub={games.length ? `${games.length} releases` : 'no release history'} />
        <Stat label="Streak" value={studio.consecutiveLosses > 0 ? `${studio.consecutiveLosses} weak` : 'steady'} sub="a run of weak releases costs reputation faster" tone={studio.consecutiveLosses > 2 ? 'bad' : 'neutral'} />
      </div>

      <div className="split">
        <div className="stack">
          <Panel title="Recent releases and what they did to your name" dense>
            <Table
              rows={last}
              getKey={(g) => g.id}
              emptyLabel="Release a game to start building a name."
              columns={[
                { key: 't', header: 'Game', render: (g) => g.title },
                { key: 'd', header: 'Date', align: 'right', render: (g) => shortDate({ year: g.releaseYear, month: g.releaseMonth, day: g.releaseDay }) },
                { key: 's', header: 'Score', align: 'right', render: (g) => fmtScore(g.reviewScore) },
                { key: 'u', header: 'Units', align: 'right', render: (g) => num(g.unitsSold) },
                { key: 'r', header: 'Rep change', align: 'right', render: (g) => <span className={`mono ${g.reputationDelta >= 0 ? 'pos' : 'neg'}`}>{g.reputationDelta >= 0 ? '+' : ''}{num(g.reputationDelta, 1)}</span> },
              ]}
            />
          </Panel>

          <Panel title="Standing by genre" dense>
            <div className="stack" style={{ padding: 10 }}>
              {byGenre.length === 0 && <p className="empty" style={{ margin: 0 }}>You have not shipped in any genre yet.</p>}
              {byGenre.map((row) => (
                <div key={row.id} className="progressrow" title={`${row.games.length} game${row.games.length === 1 ? '' : 's'} · best ${row.games.length ? Math.max(...row.games.map((g) => g.reviewScore)).toFixed(0) : '—'}`}>
                  <span className="progressrow__label">{GENRES[row.id].name}</span>
                  <Bar value={row.strength * 100} max={100} height={7} tone={row.strength > 0.5 ? 'good' : 'info'} />
                  <span className="progressrow__detail">{pct(row.strength, 0)}</span>
                </div>
              ))}
            </div>
          </Panel>
        </div>

        <div className="stack">
          <Panel title="How reputation moves">
            <KeyValue
              rows={[
                ['Per review point over 60', `+${num(BALANCE.studio.repPerReviewPoint, 2)}`],
                ['Per review point under 60', `-${num(BALANCE.studio.repPerReviewPoint, 2)}`],
                ['Per 100k units sold', `+${num(BALANCE.studio.repSalesBonus, 2)}`],
                ['Yearly decay without releases', `-${num(BALANCE.studio.repDecayPerYear, 1)}`],
                ['Floor / ceiling', `${num(BALANCE.studio.repMin, 0)} / ${num(BALANCE.studio.repMax, 0)}`],
                ['Scope multiplier', 'a flop on an ambitious game hurts more'],
              ]}
            />
          </Panel>
          <Panel title="The names above you" dense>
            <Table
              rows={rivals}
              getKey={(s) => s.id}
              emptyLabel="You are the most respected studio in the industry."
              columns={[
                { key: 'n', header: 'Studio', render: (s) => s.name },
                { key: 'r', header: 'Rep', align: 'right', render: (s) => num(s.reputation, 1) },
                { key: 'g', header: 'Games', align: 'right', render: (s) => s.releaseIds.length },
                { key: 'y', header: 'Founded', align: 'right', render: (s) => s.foundedYear },
              ]}
            />
          </Panel>
        </div>
      </div>
    </div>
  );
}

function EmployeeModal({ employee, onClose }: { employee: Employee; onClose: () => void }): React.JSX.Element {
  const { state, dispatch } = useGame();
  const studio = playerStudio(state);
  const [salary, setSalary] = useState(Math.round(employee.salary));
  const ratio = payRatio({ ...employee, salary });
  const value = marketValue(employee);
  const canAfford = studio.cash >= hireUpfrontCost(employee, salary);

  return (
    <Modal title={`${employee.name} · ${ROLE_LABELS[employee.role]}`} onClose={onClose} width={560}>
      <div className="stack">
        <div className="grid grid--stats">
          <Stat label="Skill" value={fmtScore(skillAverage(employee))} sub={skillBand(skillAverage(employee))} />
          <Stat label="Role-weighted" value={fmtScore(effectiveSkill(employee))} sub={`primary ${ROLES[employee.role].primary}`} />
          <Stat label="Morale" value={num(employee.morale, 0)} sub={moraleBand(employee.morale)} tone={employee.morale >= 68 ? 'good' : employee.morale < 45 ? 'bad' : 'warn'} />
          <Stat label="Loyalty" value={num(employee.loyalty, 0)} sub={employee.loyalty > 70 ? 'hard to poach' : 'approachable'} />
          <Stat label="Experience" value={num(employee.experience, 1)} sub={`${employee.gamesShipped} games shipped`} />
          <Stat label="Best review" value={employee.bestReviewScore > 0 ? num(employee.bestReviewScore, 0) : '—'} sub="career high" />
        </div>

        <Panel title="Quality dimensions" dense>
          <div style={{ padding: 10 }}>
            <QualityBars quality={employee.skills} />
          </div>
        </Panel>

        <KeyValue
          rows={[
            ['Traits', employee.traits.length ? employee.traits.map((t) => `${traitName(t)} — ${traitBlurb(t)}`).join('; ') : 'none'],
            ['Preferred genre', employee.preferredGenre ? GENRES[employee.preferredGenre].name : 'no preference'],
            ['Market value', `${moneyExact(value)}/mo`],
            ['Current pay', `${moneyExact(employee.salary)}/mo (${pct(ratio - 1, 0)} vs market)`],
            ['Signing bonus', `${moneyExact(Math.round(salary * BALANCE.hiring.signingBonusMonths))}`],
            ['Poach risk', `${num(poachSusceptibility(employee, poachOffer(employee)) * 100, 0)}% at a standard counter-offer`],
          ]}
        />

        <Field label={`Offer salary — ${money(salary)}/mo`} hint={`${pct(ratio - 1, 0)} versus market value. Below -10% and morale starts to fall; a raise above market makes them harder to steal.`}>
          <input type="range" min={Math.round(value * 0.6)} max={Math.round(value * 1.6)} step={50} value={salary} onChange={(e) => setSalary(Number(e.target.value))} />
        </Field>

        <div className="row">
          <Button tone="primary" disabled={!canAfford} onClick={() => dispatch({ type: 'setSalary', employeeId: employee.id, salary })}>
            Set pay to {money(salary)}
          </Button>
          <Button disabled={!canAfford} onClick={() => dispatch({ type: 'setSalary', employeeId: employee.id, salary: Math.round(value) })}>
            Match market
          </Button>
          <Button tone="danger" onClick={() => dispatch({ type: 'fire', employeeId: employee.id })}>
            Fire (severance {money(employee.salary * BALANCE.hiring.severanceMonths)})
          </Button>
        </div>
        {!canAfford && <p className="hint neg">A pay change costs one month of the new salary up front; you have {money(studio.cash)}.</p>}
      </div>
    </Modal>
  );
}

function poachSusceptibilityOf(employee: Employee): number {
  return BALANCE.hiring.poachBaseChance * (1 - employee.loyalty / 140) * (poachOffer(employee) > employee.salary ? 1.5 : 1);
}
