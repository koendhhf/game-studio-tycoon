/**
 * Measures the scripted "competent player" policy across several seeds and prints a table.
 * Used to set (and re-check) the balance expectations in `tests/sim/gameplay.test.ts`.
 *
 * Run with: npx tsx tools/measure-play.ts [years] [seeds...]
 */

import { Simulation } from '../src/sim';
import { BALANCE } from '../src/sim/data/balance';
import { playMonths } from './play-script';

const years = Number(process.argv[2] ?? 8);
const seeds = process.argv.slice(3).map(Number).filter((n) => !Number.isNaN(n));
const list = seeds.length > 0 ? seeds : [3, 9, 17, 42, 101];

let survivors = 0;
for (const seed of list) {
  const sim = Simulation.newGame(seed, 'Competent Studios');
  const outcome = playMonths(sim, years * 12);
  if (outcome.alive) survivors += 1;
  const cashM = (outcome.cash / 1e6).toFixed(2);
  console.log(
    `seed ${String(seed).padStart(3)}  alive=${outcome.alive ? 'yes' : 'no '}  cash ${cashM.padStart(7)}M  rep ${outcome.reputation.toFixed(1).padStart(5)}` +
      `  staff ${String(outcome.headcount).padStart(2)}  games ${String(outcome.games).padStart(2)}  avg ${outcome.avgScore.toFixed(1).padStart(5)}` +
      `  best ${String(outcome.bestScore.toFixed(0)).padStart(3)}  units ${(outcome.units / 1000).toFixed(0).padStart(6)}k  profit ${(outcome.profit / 1e6).toFixed(2).padStart(8)}M  hires ${outcome.hires}`,
  );
}
console.log(`survivors ${survivors}/${list.length} over ${years}y (start cash ${(BALANCE.studio.startingCash / 1e6).toFixed(2)}M)`);
