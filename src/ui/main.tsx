/**
 * App shell: navigation, the always-visible studio status, the game clock controls and
 * the save/load + game-over dialogs. No simulation rules live in here — this file only
 * reads `WorldState` and queues commands through the store.
 */

import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import type { WorldState } from '../sim';
import { GameProvider, SPEEDS, useGame } from './store';
import {
  BALANCE,
  WORLD_VERSION,
  SAVE_FORMAT_VERSION,
  activeStudios,
  allReleasedGames,
  monthlyBurn,
  playerStudio,
  runwayMonths,
} from '../sim';
import { money, num, score as fmtScore, shortDate } from './format';
import { Badge, Bar, Button, Field, Modal, Panel, Stat, Table } from './components';
import { DashboardScreen } from './screens/Dashboard';
import { StudioScreen } from './screens/StudioScreen';
import { ProjectsScreen } from './screens/ProjectsScreen';
import { CreateGameScreen } from './screens/CreateGameScreen';
import { GamesScreen } from './screens/GamesScreen';
import { IndustryScreen } from './screens/IndustryScreen';

export type ScreenId = 'dashboard' | 'studio' | 'projects' | 'create' | 'games' | 'industry';

const SCREENS: { id: ScreenId; label: string; render: () => React.JSX.Element }[] = [
  { id: 'dashboard', label: 'Dashboard', render: () => <DashboardScreen /> },
  { id: 'studio', label: 'Studio', render: () => <StudioScreen /> },
  { id: 'projects', label: 'Projects', render: () => <ProjectsScreen /> },
  { id: 'create', label: 'Create Game', render: () => <CreateGameScreen /> },
  { id: 'games', label: 'Games', render: () => <GamesScreen /> },
  { id: 'industry', label: 'Industry', render: () => <IndustryScreen /> },
];

export function App(): React.JSX.Element {
  return (
    <GameProvider>
      <Shell />
    </GameProvider>
  );
}

function Shell(): React.JSX.Element {
  const game = useGame();
  const [screen, setScreen] = useState<ScreenId>('dashboard');
  const [started, setStarted] = useState(false);
  const [saveOpen, setSaveOpen] = useState<null | 'save' | 'load'>(null);
  const studio = playerStudio(game.state);
  const active = studio.status === 'active';

  // Keyboard: space toggles the clock, digits jump screens — the game is played on a desktop.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (e.code === 'Space') {
        e.preventDefault();
        game.setSpeed(game.speed === 0 ? 1 : 0);
      } else if (e.key >= '1' && e.key <= '6') {
        setScreen(SCREENS[Number(e.key) - 1].id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [game]);

  if (!started) return <StartOverlay onStart={() => setStarted(true)} />;
  if (!active) return <GameOverOverlay onRestart={() => setStarted(false)} />;

  const burn = monthlyBurn(game.state, studio.id);
  const staff = studio.employeeIds.length;
  const projects = studio.projectIds.length;
  const current = SCREENS.find((s) => s.id === screen) ?? SCREENS[0];

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="logo">
          Studio <b>Mogul</b>
        </div>
        <nav className="nav">
          {SCREENS.map((s) => (
            <button key={s.id} type="button" className={`nav__item ${s.id === screen ? 'is-active' : ''}`} onClick={() => setScreen(s.id)}>
              <span>{s.label}</span>
              {s.id === 'projects' && projects > 0 && <span className="pill">{projects}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar__foot">
          <Button tone="ghost" small onClick={() => setSaveOpen('save')}>
            Save
          </Button>
          <Button tone="ghost" small onClick={() => setSaveOpen('load')}>
            Load
          </Button>
          <span className="hint">
            seed {game.state.seed} · v{WORLD_VERSION}
          </span>
        </div>
      </aside>

      <main>
        <header className="topbar">
          <span className="topbar__studio">{studio.name}</span>
          <span className="topbar__date">{shortDate(game.state.calendar)}</span>
          <div className="topbar__metrics">
            <Metric label="Cash" value={money(studio.cash)} tone={studio.cash < 0 ? 'bad' : studio.cash < burn * 2 ? 'warn' : 'good'} />
            <Metric label="Runway" value={runwayMonths(studio.cash, burn) === Infinity ? '∞' : `${runwayMonths(studio.cash, burn).toFixed(1)} mo`} tone={runwayMonths(studio.cash, burn) < 3 ? 'bad' : 'neutral'} />
            <Metric label="Burn" value={`${money(burn)}/mo`} tone={burn > studio.cash && studio.cash < 0 ? 'bad' : 'neutral'} />
            <Metric label="Rep" value={num(studio.reputation, 1)} tone={studio.reputation >= 60 ? 'good' : studio.reputation < 15 ? 'bad' : 'neutral'} />
            <Metric label="Staff" value={String(staff)} tone={staff === 0 ? 'bad' : 'neutral'} />
            <Metric label="Games" value={String(studio.releaseIds.length)} tone="neutral" />
          </div>
          <div className="topbar__right">
            <Button small tone="primary" onClick={() => setScreen('create')} disabled={!active}>
              New game
            </Button>
            <div className="speed">
              {SPEEDS.map((s, i) => (
                <button key={s.label} type="button" className={game.speed === i ? 'is-active' : ''} onClick={() => game.setSpeed(i)} title={i === 0 ? 'Pause (space)' : `${s.label} speed`}>
                  {s.label}
                </button>
              ))}
            </div>
            <Button small onClick={() => game.step(21)} title="Run 3 weeks">
              +3w
            </Button>
            <Button small onClick={() => game.sim.advanceMonths(1)} title="Advance one month">
              +1mo
            </Button>
            <Button small onClick={() => game.sim.advanceYears(1)} title="Advance one year">
              +1yr
            </Button>
          </div>
        </header>

        <div className="screen">{current.render()}</div>

        <footer className="statusbar">
          <span>
            day {num(game.state.calendar.tick)} · {game.state.stats.ticksRun} ticks
          </span>
          <span>{game.state.stats.lastTickMs.toFixed(2)}ms/tick</span>
          <span>
            {activeStudios(game.state).length} studios · {allReleasedGames(game.state).length} games in history
          </span>
          {game.lastMessage && (
            <span className={game.lastMessage.ok ? 'msg-ok' : 'msg-bad'}>{game.lastMessage.text}</span>
          )}
          <span className="statusbar__ticker">{latestHeadline(game.state)}</span>
        </footer>
      </main>

      {saveOpen && <SaveDialog mode={saveOpen} onClose={() => setSaveOpen(null)} />}
    </div>
  );
}

function latestHeadline(state: WorldState): string {
  const entries = state.events.entries;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].aboutPlayer || entries[i].category === 'release') return entries[i].title;
  }
  return '—';
}

function Metric({ label, value, tone }: { label: string; value: string; tone: 'good' | 'bad' | 'warn' | 'neutral' }): React.JSX.Element {
  return (
    <span className="metric">
      <span className="metric__label">{label}</span>
      <span className={`metric__value ${tone === 'neutral' ? '' : tone === 'warn' ? 'neg' : tone === 'bad' ? 'neg' : 'pos'}`} style={tone === 'warn' ? { color: 'var(--warn)' } : undefined}>
        {value}
      </span>
    </span>
  );
}

function StartOverlay({ onStart }: { onStart: () => void }): React.JSX.Element {
  const game = useGame();
  const [name, setName] = useState(playerStudio(game.state).name);
  const [seed, setSeed] = useState(String(game.state.seed));
  const saves = game.saves;

  return (
    <div className="overlay">
      <div className="overlay__card">
        <div>
          <h1>
            Studio <b>Mogul</b>
          </h1>
          <p className="hint">
            {BALANCE.studio.aiCount} competing studios, {Object.keys(BALANCE.sales).length ? 'a live market' : ''} and one shot at a {new Date().getFullYear() > 2000 ? 'classic-era' : 'studio'} software
            business. Save format v{SAVE_FORMAT_VERSION}.
          </p>
        </div>

        <div className="overlay__grid">
          <Field label="Studio name">
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={32} />
          </Field>
          <Field label="Seed" hint="Same seed + same decisions = same world.">
            <input value={seed} onChange={(e) => setSeed(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" />
          </Field>
        </div>

        <div className="row">
          <Button
            tone="primary"
            onClick={() => {
              const parsed = Number(seed) || 1;
              game.restart(parsed, name.trim() || 'New Studio');
              onStart();
            }}
          >
            Found a new studio
          </Button>
          <Button onClick={() => { onStart(); }} title="Continue with the world already loaded">
            Keep this world
          </Button>
        </div>

        {saves.length > 0 && (
          <Panel title="Saved games" dense>
            <div className="saveroom" style={{ padding: 8 }}>
              {saves.map((meta) => (
                <div className="saveitem" key={meta.slot}>
                  <div>
                    <div className="savelabel">
                      {meta.studioName} <span className="muted">· {meta.label}</span>
                    </div>
                    <div className="saveinfo">
                      {shortDate({ year: meta.year, month: meta.month - 1, day: 1 })} · {money(meta.cash)} · rep {num(meta.reputation, 0)} · {meta.gamesReleased} games ·{' '}
                      {meta.isAutosave ? 'autosave' : meta.slot}
                    </div>
                  </div>
                  <Button
                    small
                    onClick={() => {
                      game.loadFrom(meta.slot);
                      onStart();
                    }}
                  >
                    Load
                  </Button>
                  <Button small tone="ghost" onClick={() => game.deleteSave(meta.slot)}>
                    Delete
                  </Button>
                </div>
              ))}
            </div>
          </Panel>
        )}
        <p className="hint">Space toggles the clock · 1–6 switch screens · the game autosaves every {BALANCE.save.autosaveEveryMonths} months.</p>
      </div>
    </div>
  );
}

function GameOverOverlay({ onRestart }: { onRestart: () => void }): React.JSX.Element {
  const game = useGame();
  const state = game.state;
  const studio = playerStudio(state);
  const released = Object.values(state.releases).filter((g) => g.studioId === studio.id);
  const best = [...released].sort((a, b) => b.reviewScore - a.reviewScore)[0];
  const lifetime = studio.finances.lifetime;
  const totalProfit = released.reduce((acc, g) => acc + (g.revenue - g.developmentCost - g.marketingSpend), 0);

  return (
    <div className="overlay">
      <div className="overlay__card">
        <div>
          <Badge tone="bad">Bankrupt</Badge>
          <h1 style={{ marginTop: 8 }}>
            {studio.name} is <b>closed</b>
          </h1>
          <p className="hint">
            {shortDate(state.calendar)} — the studio ran out of money for {BALANCE.studio.playerGraceMonths} months running. Its {released.length} released games stay in the industry history, and its
            former staff are on the open market.
          </p>
        </div>
        <div className="grid grid--stats">
          <Stat label="Games released" value={num(released.length)} />
          <Stat label="Best score" value={best ? fmtScore(best.reviewScore) : '—'} tone={best && best.reviewScore >= 75 ? 'good' : 'neutral'} />
          <Stat label="Lifetime revenue" value={money(lifetime.revenue)} />
          <Stat label="Net from games" value={money(totalProfit)} tone={totalProfit >= 0 ? 'good' : 'bad'} />
          <Stat label="Peak cash" value={money(lifetime.peakCash)} />
          <Stat label="Final cash" value={money(studio.cash)} tone="bad" />
        </div>
        <Panel title="Final release catalogue" dense>
          <Table
            rows={released.slice().sort((a, b) => b.releaseTick - a.releaseTick).slice(0, 12)}
            getKey={(g) => g.id}
            columns={[
              { key: 't', header: 'Title', render: (g) => g.title },
              { key: 'y', header: 'Year', align: 'right', render: (g) => g.releaseYear },
              { key: 's', header: 'Score', align: 'right', render: (g) => fmtScore(g.reviewScore) },
              { key: 'u', header: 'Units', align: 'right', render: (g) => num(g.unitsSold) },
              { key: 'p', header: 'Profit', align: 'right', render: (g) => money(g.revenue - g.developmentCost - g.marketingSpend) },
            ]}
            emptyLabel="No games ever shipped."
            maxHeight={220}
          />
        </Panel>
        <div className="row">
          <Button tone="primary" onClick={onRestart}>
            Start over
          </Button>
          <Button onClick={onRestart}>Load a save</Button>
        </div>
      </div>
    </div>
  );

}

function SaveDialog({ mode, onClose }: { mode: 'save' | 'load'; onClose: () => void }): React.JSX.Element {
  const game = useGame();
  const [text, setText] = useState('');
  const [note, setNote] = useState('');

  return (
    <Modal title={mode === 'save' ? 'Save game' : 'Load game'} onClose={onClose} width={680}>
      <div className="stack">
        <div className="row row--between">
          <span className="hint">
            Autosave: {game.saves.some((s) => s.isAutosave) ? 'written every ' + BALANCE.save.autosaveEveryMonths + ' months' : 'not written yet'}
          </span>
          <div className="row row--tight">
            <Bar value={game.state.events.entries.length} max={game.state.events.capacity} tone="info" height={4} />
          </div>
        </div>

        <div className="tablewrap">
          <table className="table">
            <thead>
              <tr>
                <th>Slot</th>
                <th>Studio</th>
                <th style={{ textAlign: 'right' }}>Date</th>
                <th style={{ textAlign: 'right' }}>Cash</th>
                <th style={{ textAlign: 'right' }}>Games</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {['autosave', 'slot1', 'slot2', 'slot3', 'slot4', 'slot5', 'slot6'].map((slot) => {
                const meta = game.saves.find((s) => s.slot === slot);
                return (
                  <tr key={slot}>
                    <td className="mono">{slot}</td>
                    <td>{meta?.studioName ?? <span className="muted">empty</span>}</td>
                    <td style={{ textAlign: 'right' }} className="mono">
                      {meta ? shortDate({ year: meta.year, month: meta.month - 1, day: 1 }) : '—'}
                    </td>
                    <td style={{ textAlign: 'right' }} className="mono">
                      {meta ? money(meta.cash) : '—'}
                    </td>
                    <td style={{ textAlign: 'right' }} className="mono">
                      {meta ? meta.gamesReleased : '—'}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div className="row row--tight" style={{ justifyContent: 'flex-end' }}>
                        {mode === 'save' && (
                          <Button
                            small
                            onClick={() => {
                              game.saveTo(slot);
                              setNote(`Saved to ${slot}`);
                            }}
                          >
                            Save
                          </Button>
                        )}
                        {mode === 'load' && meta && (
                          <Button
                            small
                            onClick={() => {
                              game.loadFrom(slot);
                              onClose();
                            }}
                          >
                            Load
                          </Button>
                        )}
                        {meta && (
                          <Button small tone="ghost" onClick={() => game.deleteSave(slot)}>
                            ×
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <Panel title="Save text" dense>
          <div className="stack" style={{ padding: 8 }}>
            <p className="hint">A save is plain JSON with a checksum — copy it out to keep a run, or paste one in to load it. Same seed + same commands always replays identically.</p>
            <textarea
              value={text || game.exportText()}
              onChange={(e) => setText(e.target.value)}
              style={{ width: '100%', height: 90, background: 'var(--bg-inset)', color: 'var(--text)', border: '1px solid var(--line)', borderRadius: 4, fontFamily: 'var(--mono)', fontSize: 10 }}
            />
            <div className="row">
              <Button
                small
                onClick={() => {
                  const blob = new Blob([game.exportText()], { type: 'application/json' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `studio-mogul-${game.state.seed}.json`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                Download
              </Button>
              <Button
                small
                tone="primary"
                disabled={!text}
                onClick={() => {
                  const result = game.importText(text);
                  setNote(result.message);
                  if (result.ok) onClose();
                }}
              >
                Import & load
              </Button>
              {note && <span className="msg-ok small">{note}</span>}
            </div>
          </div>
        </Panel>
      </div>
    </Modal>
  );
}

// Mount point. The provider owns the Simulation instance; nothing else in the app
// constructs or mutates it directly.
const container = typeof document === 'undefined' ? null : document.getElementById('root');
if (container) createRoot(container).render(<App />);
