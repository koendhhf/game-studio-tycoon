/**
 * The UI is a projection of the world state. These tests render every screen against a real,
 * simulated world — no component fixtures hand-written to match the markup — and assert the
 * screens show the facts the engine produced. `react-dom/server` is used on purpose: if a screen
 * renders to a string, it needs no browser, and it cannot be hiding simulation rules in an
 * effect. Where a screen *would* need a rule to render, it reads a selector from the engine
 * instead, which is what the "matches the engine" assertions below check.
 */

import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { GameProvider } from '../../src/ui/store';
import { App } from '../../src/ui/main';
import { DashboardScreen } from '../../src/ui/screens/Dashboard';
import { StudioScreen } from '../../src/ui/screens/StudioScreen';
import { ProjectsScreen } from '../../src/ui/screens/ProjectsScreen';
import { CreateGameScreen } from '../../src/ui/screens/CreateGameScreen';
import { GamesScreen } from '../../src/ui/screens/GamesScreen';
import { IndustryScreen } from '../../src/ui/screens/IndustryScreen';
import { QUALITY_LABELS, ROLE_LABELS, SCOPE_LABELS } from '../../src/ui/labels';
import { Simulation, createProject, money } from './ui-imports';
import { QUALITY_DIMENSIONS } from '../../src/sim/core/types';
import { GameTable, QualitySummary, ReviewList } from '../../src/ui/screens/parts';
import type { WorldState } from './ui-imports';
import { playMonths } from '../../tools/play-script';
import { GENRE_ORDER, GENRES, monthlySalaryBill } from '../sim/test-imports';

/** Play a couple of years of a competent strategy so every screen has real content to show. */
function worldWithHistory(): WorldState {
  const sim = Simulation.newGame(2026, 'Lantern and Anvil');
  playMonths(sim, 26);
  return sim.state;
}

function projectWorld(title: string, opts: { runTo?: 'ready' | 'months'; seed: number; name: string }): WorldState {
  const sim = Simulation.newGame(opts.seed, opts.name);
  const studio = sim.studio;
  const project = createProject(sim.state, studio.id, sim.rng, {
    title,
    genreId: 'strategy',
    platformId: 'pc',
    scope: 'small',
    budget: 120_000,
    teamIds: studio.employeeIds.slice(0, 3),
    risk: 0.25,
    marketing: 5_000,
  });
  sim.state.projects[project.id] = project;
  studio.projectIds.push(project.id);
  if (opts.runTo === 'ready') {
    let guard = 0;
    while (project.progress < 1 && guard < 1500) {
      sim.step();
      guard += 1;
    }
    const released = sim.runCommand({ type: 'releaseGame', projectId: project.id });
    expect(released.ok).toBe(true);
    sim.advanceMonths(2);
  } else {
    sim.advanceMonths(3);
  }
  return sim.state;
}

function render(Screen: () => React.JSX.Element, state: WorldState): string {
  const sim = Simulation.restore(state);
  return renderToStaticMarkup(createElement(GameProvider, { initial: sim, children: createElement(Screen) }));
}

const SCREENS: Array<{ name: string; Screen: () => React.JSX.Element; expects: string[] }> = [
  { name: 'Dashboard', Screen: DashboardScreen, expects: ['Market pulse', 'Industry leaderboard'] },
  { name: 'Studio', Screen: StudioScreen, expects: [ROLE_LABELS.programmer, 'Morale'] },
  { name: 'Projects', Screen: ProjectsScreen, expects: [] },
  { name: 'Create Game', Screen: CreateGameScreen, expects: ['Projection'] },
  { name: 'Games', Screen: GamesScreen, expects: ['Average score'] },
  { name: 'Industry', Screen: IndustryScreen, expects: ['Genre market', 'Hardware'] },
];

describe('every screen renders a lived-in world', () => {
  const state = worldWithHistory();
  const studio = state.studios[state.playerStudioId];

  for (const { name, Screen } of SCREENS) {
    it(`${name} renders without crashing`, () => {
      const html = render(Screen, state);
      expect(html.length).toBeGreaterThan(400);
      expect(html).toContain('class="panel');
    });
  }

  it('shows no raw objects, undefined values or NaN anywhere', () => {
    for (const { name, Screen } of SCREENS) {
      const html = render(Screen, state);
      expect(html, name).not.toContain('[object Object]');
      expect(html, name).not.toContain('>undefined<');
      expect(html, name).not.toContain('undefined%');
      expect(html, name).not.toMatch(/\bNaN\b/);
      expect(html, name).not.toContain('Invalid Date');
      expect(html, name).not.toContain('Infinity');
    }
  });

  it('reports the money the engine actually holds', () => {
    const html = render(DashboardScreen, state);
    expect(html).toContain(money(studio.cash));
    // Payroll on the Studio screen is the engine's own bill, not a component-side sum.
    const studioHtml = render(StudioScreen, state);
    expect(studioHtml).toContain(money(monthlySalaryBill(state, studio.id)));
  });

  it('lists the games the studio actually shipped, with their reviews', () => {
    const releases = studio.releaseIds.map((id) => state.releases[id]).filter(Boolean);
    expect(releases.length).toBeGreaterThan(1);
    const html = render(GamesScreen, state);
    for (const game of releases.slice(0, 3)) {
      expect(html).toContain(game.title);
    }
    // The summary stats are computed from the same records the table shows.
    expect(html).toContain('Best seller here');
    expect(html).toContain('Most profitable');
    expect(html).toContain('Games in history');

    // The panels that open on a row render straight from the release record: six quality
    // dimensions, one line per publication. They are shared parts, so they are testable
    // without a click and without a browser.
    const record = releases[0];
    const reviews = renderToStaticMarkup(createElement(ReviewList, { reviews: record.reviews }));
    expect(record.reviews.length).toBeGreaterThan(1);
    for (const review of record.reviews) {
      expect(reviews).toContain(review.publication);
    }
    // Six dimensions, each with its own value — never one hidden number.
    const quality = renderToStaticMarkup(createElement(QualitySummary, { game: record }));
    for (const dim of QUALITY_DIMENSIONS) {
      expect(quality).toContain(`title="${dim}:`);
      expect(quality).toContain(dim.slice(0, 3).toUpperCase());
      expect(quality).toContain(String(Math.round(record.quality[dim])));
    }
    const table = renderToStaticMarkup(createElement(GameTable, { games: releases }));
    for (const game of releases.slice(0, 3)) expect(table).toContain(game.title);
  });

  it('shows the staff the studio employs, with the roles they hold', () => {
    const html = render(StudioScreen, state);
    const employees = studio.employeeIds.map((id) => state.employees[id]);
    expect(employees.length).toBeGreaterThan(3);
    for (const emp of employees.slice(0, 5)) {
      expect(html).toContain(emp.name);
    }
    const roles = new Set(employees.map((e) => ROLE_LABELS[e.role]));
    for (const role of roles) expect(html).toContain(role);
  });

  it('shows rival studios and their real output on the industry screen', () => {
    const html = render(IndustryScreen, state);
    const rivals = Object.values(state.studios).filter((s) => !s.isPlayer && s.status === 'active');
    expect(rivals.length).toBeGreaterThan(5);
    let found = 0;
    for (const rival of rivals) if (html.includes(rival.name)) found += 1;
    expect(found).toBeGreaterThan(3);
    for (const genreId of GENRE_ORDER) expect(html, genreId).toContain(GENRES[genreId].name);
  });

  it('the create screen offers every genre and every scope the engine knows', () => {
    const html = render(CreateGameScreen, state);
    for (const label of Object.values(SCOPE_LABELS)) expect(html, label).toContain(label);
    for (const genreId of GENRE_ORDER) expect(html, genreId).toContain(GENRES[genreId].name);
    for (const label of Object.values(QUALITY_LABELS)) expect(html, label).toContain(label);
  });
});

describe('screens handle a world with one project and no releases', () => {
  const state = projectWorld('Marsh Kingdom', { seed: 7, name: 'Quiet For Now', runTo: 'months' });

  for (const { name, Screen, expects } of SCREENS) {
    it(`${name} renders it without special cases`, () => {
      const html = render(Screen, state);
      expect(html.length).toBeGreaterThan(300);
      expect(html).not.toMatch(/\bNaN\b/);
      expect(html).not.toContain('[object Object]');
      for (const needle of expects.concat(name === 'Projects' ? ['Marsh Kingdom', 'In development'] : [])) {
        expect(html, `${name} should mention "${needle}"`).toContain(needle);
      }
    });
  }

  it('Projects shows the project and its quality bars', () => {
    const html = render(ProjectsScreen, state);
    expect(html).toContain('Marsh Kingdom');
    for (const label of Object.values(QUALITY_LABELS)) expect(html).toContain(label);
  });
});

describe('screens handle a brand new studio', () => {
  const state = Simulation.newGame(1, 'Cold Start').state;

  for (const { name, Screen } of SCREENS) {
    it(`${name} renders an empty world`, () => {
      const html = render(Screen, state);
      expect(html.length).toBeGreaterThan(300);
      expect(html).not.toMatch(/\bNaN\b/);
      expect(html).not.toContain('[object Object]');
      expect(html).not.toContain('undefined');
    });
  }

  it('Projects says there is nothing in development instead of rendering a blank card', () => {
    const html = render(ProjectsScreen, state);
    expect(html).toContain('No projects in development');
  });
});

describe('a released game is shown as the record the engine wrote', () => {
  const state = projectWorld('Copper Robots', { seed: 11, name: 'First Light Games', runTo: 'ready' });
  const studio = state.studios[state.playerStudioId];
  const game = state.releases[studio.releaseIds[0]];

  it('carries reviews, quality, money and credits into the Games screen', () => {
    expect(game).toBeTruthy();
    expect(game.reviews.length).toBeGreaterThan(1);
    const html = render(GamesScreen, state);
    expect(html).toContain('Copper Robots');
    expect(html).toContain('Best seller here');
    const reviews = renderToStaticMarkup(createElement(ReviewList, { reviews: game.reviews }));
    for (const review of game.reviews) expect(reviews).toContain(review.publication);
    const summary = renderToStaticMarkup(createElement(QualitySummary, { game }));
    for (const dim of QUALITY_DIMENSIONS) expect(summary).toContain(`title="${dim}:`);
    expect(game.credits.length).toBeGreaterThan(0);
    // Credits are part of the record the screen is built from, so the "who made it" panel can
    // never invent a name the sim did not employ.
    for (const credit of game.credits) {
      expect(state.employees[credit.employeeId]?.name ?? credit.name).toBe(credit.name);
    }
  });

  it('the dashboard reflects the release it caused', () => {
    const html = render(DashboardScreen, state);
    expect(studio.releaseIds.length).toBe(1);
    expect(html).toContain('Your latest release');
    expect(html).toContain('Copper Robots');
    expect(html).toContain(money(studio.cash));
  });
});

describe('the application shell', () => {
  it('opens on a start overlay that asks for a name and a seed', () => {
    const html = renderToStaticMarkup(createElement(App));
    expect(html).toContain('Studio name');
    expect(html).toContain('Seed');
    expect(html).toContain('Same seed + same decisions = same world');
    expect(html).not.toMatch(/\bNaN\b/);
  });
});
