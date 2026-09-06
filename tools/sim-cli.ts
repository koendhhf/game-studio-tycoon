/**
 * Headless simulation runner — no browser, no DOM.
 *
 *   npm run sim -- --seed 7 --years 6 --report
 *
 * Used to sanity-check long runs (perf, market dynamics, AI survival rate) and to
 * prove save/load round-trips outside of the UI.
 */

import { Simulation } from '../src/sim/simulation';
import { generateWorld } from '../src/sim/setup';
import { serializeWorld, deserializeWorld } from '../src/save/schema';
import { aiStudios, activeStudios } from '../src/sim/state/world';

interface Args {
  seed: number;
  years: number;
  report: boolean;
  saveCheck: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { seed: 1, years: 5, report: true, saveCheck: true };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--seed') args.seed = Number(argv[++i]);
    else if (token === '--years') args.years = Number(argv[++i]);
    else if (token === '--no-report') args.report = false;
    else if (token === '--no-save-check') args.saveCheck = false;
  }
  return args;
}

function money(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(Math.round(value));
}

const args = parseArgs(process.argv.slice(2));
const started = Date.now();
const state = generateWorld({ seed: args.seed, studioName: 'CLI Test Studios' });
const sim = new Simulation(state);
console.log(`World generated in ${Date.now() - started}ms: ${Object.keys(state.studios).length} studios, ${Object.keys(state.employees).length} people, ${Object.keys(state.releases).length} archived releases`);

// Give the player a project so the run exercises the player path too.
const firstProject = Object.values(state.projects)[0];
void firstProject;
const studio = state.studios[state.playerStudioId];
const teamIds = [...studio.employeeIds];
sim.dispatch({
  type: 'startProject',
  payload: {
    title: 'Cavern Protocol',
    genreId: 'action',
    platformId: 'superb',
    scope: 'small',
    budget: 60000,
    teamIds,
    risk: 0.4,
    marketing: 12000,
  },
});

const totalDays = Math.round(args.years * 365.25);
const tickStart = Date.now();
for (let day = 0; day < totalDays; day++) {
  sim.tick();
  if (day % 400 === 0 && day > 0) {
    // periodically start a new player project so the pipeline keeps moving
    const live = studio.projectIds.filter((id) => state.projects[id]?.status !== 'released' && state.projects[id]?.status !== 'cancelled');
    if (live.length === 0 && studio.cash > 120000) {
      sim.dispatch({
        type: 'startProject',
        payload: {
          title: `Project ${day}`,
          genreId: (['action', 'rpg', 'strategy', 'puzzle', 'horror'] as const)[day % 5],
          platformId: state.calendar.year > 1995 ? 'diskdrive' : 'superb',
          scope: studio.cash > 600000 ? 'medium' : 'small',
          budget: Math.min(studio.cash * 0.4, 300000),
          teamIds: [...studio.employeeIds],
          risk: 0.4,
          marketing: Math.min(studio.cash * 0.1, 40000),
        },
      });
    }
    for (const projectId of [...studio.projectIds]) {
      const project = state.projects[projectId];
      if (project && project.progress >= 1 && studio.cash > 0) {
        sim.dispatch({ type: 'releaseGame', projectId });
      }
    }
  }
}
const elapsed = Date.now() - tickStart;

const player = state.studios[state.playerStudioId];
const playerGames = player.releaseIds.map((id) => state.releases[id]).filter(Boolean);
const ai = aiStudios(state);
const defunct = Object.values(state.studios).filter((s) => s.status !== 'active');
const allGames = Object.values(state.releases);

if (args.report) {
  console.log('');
  console.log(`=== ${state.calendar.year}-${String(state.calendar.month + 1).padStart(2, '0')} (tick ${state.calendar.tick}) ===`);
  console.log(`ticks: ${state.stats.ticksRun} in ${elapsed}ms  (${(elapsed / Math.max(1, state.stats.ticksRun)).toFixed(3)}ms/tick)`);
  console.log(`commands processed: ${state.stats.commandsProcessed}   ai actions: ${state.stats.aiActionsTaken}`);
  console.log(`events: ${state.events.entries.length} (${state.events.dropped} dropped)`);
  console.log('');
  console.log(`player: ${player.name}  cash ${money(player.cash)}  rep ${player.reputation.toFixed(1)}  staff ${player.employeeIds.length}  games ${player.releaseIds.length}`);
  console.log(`  lifetime revenue ${money(player.finances.lifetime.revenue)}  salaries ${money(player.finances.lifetime.salaries)}  dev ${money(player.finances.lifetime.development)}  marketing ${money(player.finances.lifetime.marketing)}`);
  if (playerGames.length > 0) {
    console.log(`  best: ${playerGames.reduce((a, b) => (b.reviewScore > a.reviewScore ? b : a)).title}  avg score ${(playerGames.reduce((a, b) => a + b.reviewScore, 0) / playerGames.length).toFixed(1)}  units ${money(playerGames.reduce((a, b) => a + b.unitsSold, 0))}`);
  }
  console.log('');
  console.log(`studios: ${activeStudios(state).length} active (${ai.length} AI), ${defunct.length} closed, ${state.stats.studiosFounded} founded`);
  console.log(`games: ${allGames.length} total released, ${allGames.filter((g) => g.status === 'selling').length} still selling`);
  const top = allGames.filter((g) => g.releaseTick > totalDays - 400).sort((a, b) => b.reviewScore - a.reviewScore).slice(0, 5);
  if (top.length) {
    console.log('recent releases:');
    for (const g of top) console.log(`  ${g.reviewScore.toFixed(1)}  ${g.title} (${g.studioName}) ${g.genreId}/${g.platformId} ${money(g.unitsSold)}u`);
  }
  console.log('market:');
  for (const [id, m] of Object.entries(state.market.genres)) {
    console.log(`  ${id.padEnd(11)} pop ${m.popularity.toFixed(1).padStart(5)}  demand ${m.demand.toFixed(1).padStart(6)}  competition ${m.competition.toFixed(1).padStart(5)}  projects ${activeProjectsByGenre(state, id)}`);
  }
  const aiCash = ai.map((s) => ({ name: s.name, cash: s.cash, rep: s.reputation, staff: s.employeeIds.length, projects: s.projectIds.length, games: s.releaseIds.length }));
  aiCash.sort((a, b) => b.cash - a.cash);
  const scored = allGames.filter((g) => g.releaseTick > 0).map((g) => g.reviewScore).sort((a, b) => a - b);
  if (scored.length) {
    const q = (f: number) => scored[Math.min(scored.length - 1, Math.floor(scored.length * f))];
    console.log(`review scores: n=${scored.length} min ${q(0).toFixed(0)} p25 ${q(0.25).toFixed(0)} median ${q(0.5).toFixed(0)} p75 ${q(0.75).toFixed(0)} p95 ${q(0.95).toFixed(0)} max ${q(1).toFixed(0)}`);
    const live = allGames.filter((g) => g.releaseTick > totalDays - 730);
    const profits = live.map((g) => g.revenue - g.developmentCost - g.marketingSpend).sort((a, b) => a - b);
    if (profits.length) {
      const pq = (f: number) => profits[Math.min(profits.length - 1, Math.floor(profits.length * f))];
      console.log(`profit (last 2y, n=${profits.length}): min ${money(pq(0))} p25 ${money(pq(0.25))} median ${money(pq(0.5))} p75 ${money(pq(0.75))} max ${money(pq(1))}`);
    }
    const units = live.map((g) => g.unitsSold).sort((a, b) => a - b);
    if (units.length) console.log(`units (last 2y): median ${Math.round(units[Math.floor(units.length / 2)])} p90 ${Math.round(units[Math.floor(units.length * 0.9)])} max ${Math.round(units[units.length - 1])}`);
  }
  console.log('AI studios by cash:');
  for (const row of aiCash.slice(0, 8)) console.log(`  ${row.name.padEnd(28)} ${money(row.cash).padStart(8)}  rep ${row.rep.toFixed(0).padStart(3)}  staff ${String(row.staff).padStart(2)}  proj ${row.projects}  games ${row.games}`);
  const broke = aiCash.filter((r) => r.cash < 0);
  console.log(`AI in the red: ${broke.length}/${ai.length}`);
  void state;
}

function activeProjectsByGenre(world: typeof state, genreId: string): number {
  return Object.values(world.projects).filter((p) => p.genreId === genreId && p.status !== 'released' && p.status !== 'cancelled').length;
}

if (args.saveCheck) {
  const text = serializeWorld(state, 'cli');
  const restored = deserializeWorld(text);
  if (!restored.ok || !restored.state) {
    console.error('\nSAVE/LOAD FAILED:', restored.error, restored.warnings);
    process.exitCode = 1;
  } else {
    const again = serializeWorld(restored.state, 'cli');
    const same = JSON.stringify(JSON.parse(text).state) === JSON.stringify(JSON.parse(again).state);
    console.log(`\nsave/load: ${text.length.toLocaleString()} bytes, round-trip identical: ${same}, warnings: ${restored.warnings.length}`);
    // Continue from the save and confirm the future is identical.
    const simA = new Simulation(structuredClone(state));
    const simB = Simulation.restore(restored.state);
    const before = Date.now();
    for (let i = 0; i < 200; i++) simA.tick();
    for (let i = 0; i < 200; i++) simB.tick();
    // Compare only the world payload: the envelope carries a wall-clock timestamp.
    const a = JSON.stringify(JSON.parse(serializeWorld(simA.state, 'x')).state);
    const b = JSON.stringify(JSON.parse(serializeWorld(simB.state, 'x')).state);
    console.log(`determinism after 200 days: ${a === b ? 'IDENTICAL' : 'DIVERGED'} (${Date.now() - before}ms)`);
    if (a !== b) process.exitCode = 1;
  }
}
