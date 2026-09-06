# Studio Mogul

A deep, single-player video-game-industry management sim. You run a studio from a garage in 1990:
you hire, you staff projects, you decide what to make and when to ship it, and the market decides
what that was worth. Around you, a couple of dozen AI studios do the same thing for real — they
compete for the same labour pool, crowd the same genres and go bankrupt on the same balance sheet
you do.

**Status: Phase 1 — the simulation foundation.** The engine, the world it maintains, the AI that
lives in it, the save system and a desktop-first UI that shows all of it are implemented and
tested. Content breadth (more platforms, more staff systems, publishing deals) comes in later
phases on top of this, not as a rewrite of it.

## Quick start

```bash
npm install
npm run dev        # vite dev server, http://localhost:5173 (hot reload on)
npm run dev:preview  # same server, dev-client websocket removed — for tunnels/iframe previews
npm run preview    # serve the production build, 0.0.0.0:5173
npm test           # 217 tests, no browser required (~25 s)
npm run typecheck  # tsc --noEmit, strict
npm run build      # typecheck + production bundle (mounted at /)
npm run build:pages  # the bundle GitHub Pages serves (mounted at /game-studio-tycoon/)
npm run sim -- --seed 3 --years 5      # headless 5-year industry run + report
npm run sim:play -- 8                  # scripted "competent player" over 8 years, 5 seeds
```

`npm run sim` is the fastest way to see the whole machine working: it runs the industry, prints
market and review distributions, checks that a save round-trips byte-identically, and verifies that
a restored world keeps matching the uninterrupted one.

### Production deployment (GitHub Pages)

The live game lives at **<https://koendhhf.github.io/game-studio-tycoon/>**, published by
`.github/workflows/pages.yml`. That workflow is the only thing that deploys, and it runs on pushes
to `main` (plus `workflow_dispatch`): install → `npm run typecheck` → `npm test` → `npm run
build:pages` → upload `dist/` → `actions/deploy-pages`. A failing type-check or test therefore
cannot reach the live URL.

Two hosting details are worth knowing:

- **Base path.** A Pages *project* site is served from `/<repo>/`, so the deployed bundle has to
  use matching asset URLs. That is what `PAGES_BASE` is for: `npm run build:pages` builds with
  `PAGES_BASE=/game-studio-tycoon/`, while plain `npm run build` (and both dev servers) build and
  serve at `/`. Set `PAGES_BASE=/` if the game ever moves to a custom domain or a user site root.
- **Deep links.** The game has no client-side router — screens are selected in state, not by URL —
  so nothing needs history rewriting. The workflow still copies `index.html` to `404.html`, which
  is the Pages way to serve the app for a mistyped path instead of GitHub's 404 page.

One-time repository setting, which no workflow can do for itself: **Settings → Pages → Build and
deployment → Source: GitHub Actions**. Until that is set the deploy job reports `Pages is not
enabled` (the build job still passes). Note that Pages on a *private* repository needs a paid plan
and a signed-in GitHub session, so for a game you want to open on a phone the repository has to be
public.

To see exactly what gets deployed, without deploying anything:

```bash
npm run preview:pages   # build + serve the production bundle at http://localhost:5173/game-studio-tycoon/
```

### Serving the UI behind a proxy or an iframe preview

`vite.config.ts` binds the dev and preview servers to `0.0.0.0:5173`, accepts any host
(`allowedHosts: true`, because hosted preview URLs are generated per session) and keeps CORS
permissive — the app only ever requests relative URLs, so there is nothing origin-bound to protect.

When the server sits behind a proxy that does not reliably upgrade websockets, use
`npm run dev:preview`. It serves the exact same dev module graph but strips the injected HMR client
from `index.html`: an HMR socket that cannot connect makes Vite's client fall back to
`wss://localhost:5173` (the viewer's own machine) and then reload-poll the page, which looks like a
preview that never loads. `npm run preview` (the production bundle) is the fully static alternative
and contains no dev client either. Plain `npm run dev` is unchanged and still hot-reloads.

## Layout

```
src/sim/
  core/        calendar (real month lengths, leap years), deterministic RNG, ids, events, math
  data/        pure data + tuning: genres, platforms, roles, traits, scopes, names, publications,
               balance.ts (every number worth arguing about)
  entities/    plain-data shapes: studio, employee, project, released game, market
  models/      the formulas, pure functions only: development, employee, review, sales, planning
  systems/     one concern each, run in a fixed order per day: development, economy, solvency,
               employees, hiring, market, sales, release, ai
  state/       WorldState (the whole game in one JSON-serialisable object) + selectors
  commands.ts  the only write path: 13 commands, each validated before it mutates
  simulation.ts Simulation: create / restore / step / runCommand / advanceMonths / subscribe
  operations.ts the shared primitives systems and commands build on (charge, credit, emit, …)
src/save/      versioned save envelope, checksum, repair + migration, SaveManager and slots
src/ui/        React screens. Reads state through selectors, sends commands. No rules.
tools/         headless runners: sim-cli.ts (industry report), measure-play.ts (balance check),
               play-script.ts (the scripted player strategy both share)
tests/sim/     engine tests; tests/ui/ screens rendered with react-dom/server
```

The layering rule, enforced by review and by the tests: **data → models → systems → commands →
Simulation → UI.** A model may not touch `WorldState` beyond what it is handed; a system mutates
state but never the DOM; a component never computes a game rule. If the Create Game screen needs a
projection, it asks `planProject`; if the Studio screen needs payroll, it asks `monthlySalaryBill`.

## How the game is simulated

- **Time.** One tick = one day. The calendar uses real month lengths and leap years (including the
  century rule), so "a month" is 28–31 days and quarter boundaries are real. Month-boundary work
  (payroll, market drift, AI decisions, sales weeks) runs on `cadence.monthStart`; systems read the
  cadence instead of re-deriving it.
- **Employees** have role, six skill ratings, salary, experience, morale, loyalty and traits.
  Roles decide *what* they can improve and how fast; skills decide *how far* a quality dimension
  can go; morale and crunch decide throughput; producers shield the team and speed up bug-fixing.
  Under-paid people get unhappy, unhappy people quit or get poached.
- **Projects** accumulate six separate quality dimensions — gameplay, graphics, story, audio,
  innovation, polish — never one hidden number. Output is capped by scope, funding, platform
  pressure, role coverage and the team's skill in that dimension, so a small team on an ambitious
  plan fails in a specific, readable way. Bugs accumulate with progress and risk and burn down in
  the polish phase; QA is the role that actually burns them down.
- **Release is a decision, not a timer.** The player ships when they choose; the AI ships when its
  personality says so (quality-first studios wait out a buggy build, ship-early studios do not).
- **Reviews** are derived: each publication weighs the genre's critic weights through its own bias,
  then adjusts for bugs, incompleteness, over-hyped marketing, innovation and reputation. The
  prose is generated from the strongest and weakest dimensions, so a review that praises the story
  means the story was actually good. Scores are reproducible from the game's state.
- **Sales** run weekly from an opening figure computed from reviews, player reception, genre
  popularity and demand, platform audience, marketing reach, awareness, reputation, competition and
  price elasticity, then decay with a tail that good reception lengthens and bad reception cuts
  short. Platform royalties and manufacturing cost come off before the money reaches the ledger.
- **The market** is per genre: popularity (mean-reverting random walk with per-genre volatility),
  demand (a shared resource that releases drain and time refills), competition (real concurrent
  projects plus recent releases) and fatigue, plus timed modifiers like a genre craze or a
  hardware price cut. It feeds sales, and sales feed it back.
- **Money**: one payroll per month plus overhead, tooling charged per employee-day while a project
  runs, licences at start, marketing at release, revenue weekly. Every movement is booked to a
  `MonthLedger` row that the UI shows, so the dashboard and the simulation cannot disagree.
  A studio in the red for long enough loses its staff and closes — the player gets more grace
  than an AI studio, and both end the same way.
- **AI studios** are players: same commands, same validators, same systems. Each has an
  `AiProfile` (ambition, risk appetite, quality focus, marketing focus, hiring appetite,
  adaptability, loyalty, preferred genres) that changes what it does with the same options you have.

## Determinism

The contract: **same seed + same command log ⇒ byte-identical world state.** It holds because:

1. One RNG stream lives inside `WorldState` (`state.rng`, plain data), and every derived roll uses
   `randFor(seed, key)` with a stable key rather than a fresh source.
2. All writes go through `WorldState`, so nothing is cached in module scope (no name pools, no
   counters, no "last generated id" outside the state).
3. Iteration is over sorted ids, never over insertion order.
4. Commands are applied at tick boundaries in arrival order, including the ones queued during a day.

`tests/sim/determinism.test.ts` proves it, including that chunk size (one day at a time vs
month-skipping) does not change the outcome, and that a save restored mid-run keeps producing the
identical world.

## Saves

`src/save/schema.ts` wraps the whole `WorldState` in a versioned envelope — magic string, format
version, label, tick, checksum over a key-stable serialisation. Loading validates the shape,
repairs what is derivable (a missing project list, a market that can be rebuilt from the seed,
dangling references in either direction) and refuses with a clear reason when the file is not
recoverable. `SaveManager` keeps six manual slots plus a rolling autosave; the UI's export/import
is the same text, so a save is inspectable and movable between machines.

## Tests

| File | Covers |
| --- | --- |
| `tests/sim/time.test.ts` | calendar arithmetic, cadence, month/year skips |
| `tests/sim/rng.test.ts` | stream reproducibility, keys, no module state |
| `tests/sim/employees.test.ts` | roles, skills, salary model, morale, growth, traits, hiring |
| `tests/sim/development.test.ts` | throughput, caps, bugs, crunch, stalls, forecast vs reality |
| `tests/sim/reviews.test.ts` | score derivation, per-outlet spread, prose from strengths |
| `tests/sim/sales.test.ts` | pricing, opening units, weekly tail, royalties, break-even |
| `tests/sim/release.test.ts` | the history record, its side effects, what may not ship |
| `tests/sim/finances.test.ts` | payroll, overhead, project money, ledger, insolvency |
| `tests/sim/market.test.ts` | genre drift, demand, competition, fatigue, modifiers |
| `tests/sim/ai.test.ts` | studio generation, monthly decisions, personality, consistency |
| `tests/sim/commands.test.ts` | validation before mutation, every command's contract |
| `tests/sim/planning.test.ts` | the projection the Create Game screen shows |
| `tests/sim/save.test.ts` | round-trip integrity, damaged files, repair, slots |
| `tests/sim/determinism.test.ts` | the determinism contract |
| `tests/sim/gameplay.test.ts` | six years of a competent player: profitable, growing, and a clean loss when it loses |
| `tests/ui/screens.test.tsx` | every screen rendered from a real world, no NaN, no invented rules |

All of them run in plain Node. There is no browser and no mocking framework: tests build worlds
with the same factories the game uses, so a change to an entity shape breaks tests loudly instead
of quietly making them vacuous.

## Balance

Everything tunable lives in `src/sim/data/balance.ts`, grouped by concern (`time`, `employee`,
`hiring`, `development`, `reviews`, `sales`, `market`, `economy`, `studio`, `ai`, `save`). The
workflow for a balance change:

1. `npm run sim -- --seed 3 --years 6` for the industry view (review spread, profit distribution,
   AI survival, save/determinism check).
2. `npm run sim:play -- 8` for the player view — the scripted strategy in `tools/play-script.ts`
   is the same one `tests/sim/gameplay.test.ts` asserts on, so "is the game beatable but not
   trivial" is a measured question, not a vibe.
3. Change **one** lever, re-measure both. Compounding two changes makes the result unauditable.

The current setting is deliberately survivable-but-sharp: over eight years the scripted player
ends 4 of 5 seeds as a multi-million studio, and one seed closes.

## Extending it (later phases)

The seams Phase 1 exists to provide:

- **New genre / platform / role / scope / trait**: add one entry to the matching file in
  `src/sim/data/`. Nothing else needs to change — screens, projections, market drift and AI choice
  all iterate the data.
- **New simulation concern**: add a system in `src/sim/systems/`, give it an `order`, register it in
  `SYSTEMS`. It gets the cadence, the shared RNG and the event log for free.
- **New player action**: add a variant to `Command`, validate it in `commands.ts`, apply it in
  `applyCommand`. The AI gets it for free if it is worth doing; the UI gets it because it only ever
  dispatches commands. Never mutate state from a component.
- **New screen**: add it to `src/ui/screens/` and register it in the shell's `SCREENS` list. Read
  through selectors in `src/sim` (`monthlyBurn`, `genreMarketOf`, `runwayMonths`, …) so rules stay
  in one place.
- **Save compatibility**: bump `SAVE_FORMAT_VERSION` and add a migration in `schema.ts`;
  `repairWorld` is where "old file, new engine" is negotiated.

Explicitly out of scope, by design, for Phase 1: multiplayer, microtransactions, publisher
contracts, hardware manufacturing, esports, film/TV licensing, modding and procedural world
generation.

## Controls

Desktop-first. The clock has four speeds (pause, 1×, 2×, 4×) and month/year step buttons, `space`
toggles the clock and `1`–`6` jump between Dashboard, Studio, Projects, Create Game, Games and
Industry. Saves are in the top bar; the autosave runs on the interval in `BALANCE.save`.
