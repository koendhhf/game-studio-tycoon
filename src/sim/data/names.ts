/**
 * Procedural name and title generation. Everything takes an Rng, so generated
 * names are a pure function of the seed (and therefore replayable + testable).
 */

import type { Rng } from '../core/rng';
import type { GenreId } from '../core/types';

const FIRST_NAMES = [
  'Aaron', 'Birgit', 'Cameron', 'Dana', 'Elias', 'Farida', 'Gustav', 'Hana', 'Ivan', 'Josefina',
  'Kai', 'Lena', 'Marcus', 'Nadia', 'Oskar', 'Petra', 'Quentin', 'Ragna', 'Soren', 'Tomas',
  'Ursula', 'Viktor', 'Wendy', 'Xenia', 'Yusuf', 'Zoe', 'Anders', 'Bea', 'Chen', 'Dorit',
  'Emil', 'Flora', 'Gideon', 'Helka', 'Ines', 'Jarek', 'Kasper', 'Lucia', 'Milan', 'Noor',
  'Odalys', 'Piotr', 'Ravi', 'Sanne', 'Teo', 'Uwe', 'Vera', 'Wout', 'Yara', 'Zoltan',
];

const LAST_NAMES = [
  'Ahlberg', 'Brannigan', 'Castellan', 'Dvorak', 'Eskildsen', 'Farrow', 'Guttman', 'Halvorsen',
  'Iversen', 'Jansen', 'Kowalczyk', 'Lindqvist', 'Moreau', 'Nakamura', 'Oyelaran', 'Petrov',
  'Quintero', 'Rasmussen', 'Sandoval', 'Tremblay', 'Ustinov', 'Vasquez', 'Wojcik', 'Yamada',
  'Zeller', 'Arvidsson', 'Bakker', 'Corrales', 'Delacroix', 'Eriksen', 'Fontaine', 'Grzesik',
  'Hollis', 'Iwata', 'Jorgensen', 'Kestrel', 'Larkin', 'Marren', 'Novotny', 'Okafor',
];

const STUDIO_WORDS_A = [
  'Iron', 'Neon', 'Copper', 'Midnight', 'Lunar', 'Static', 'Velvet', 'Cobalt', 'Hollow', 'Rogue',
  'Pixel', 'Analog', 'Quantum', 'Paper', 'Thunder', 'Feral', 'Silent', 'Golden', 'Bitter', 'Electric',
  'Ivory', 'Crimson', 'Northern', 'Endless', 'Fractal', 'Molten', 'Hollow', 'Second', 'Blind', 'Bright',
];

const STUDIO_WORDS_B = [
  'Forge', 'Works', 'Interactive', 'Labs', 'Games', 'Softworks', 'Collective', 'Machine', 'Studios', 'Entertainment',
  'Dynasty', 'Foundry', 'Assembly', 'Society', 'Engine', 'Cathedral', 'Circuits', 'Publishing', 'Division', 'Guild',
  'Systems', 'Factory', 'Front', 'Reactor', 'Signal', 'Project', 'Union', 'House', 'Tank', 'Union',
];

const STUDIO_SUFFIX = ['', '', '', ' Media', ' International', ' Design', ' Tech', ' Worldwide'];

export function personName(rng: Rng): string {
  return `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`;
}

/**
 * Generate a studio name. `taken` is supplied by the caller (from the world state) so
 * that de-duplication never depends on module-level state — a global "already used"
 * cache would make world generation depend on how many worlds were built before it.
 */
export function studioName(rng: Rng, taken?: ReadonlySet<string>): string {
  for (let attempt = 0; attempt < 24; attempt++) {
    const base = `${rng.pick(STUDIO_WORDS_A)} ${rng.pick(STUDIO_WORDS_B)}${rng.pick(STUDIO_SUFFIX)}`;
    if (!taken || !taken.has(base)) return base;
  }
  for (let attempt = 0; attempt < 60; attempt++) {
    const base = `${rng.pick(STUDIO_WORDS_A)} ${rng.pick(STUDIO_WORDS_B)} ${rng.int(2, 999)}`;
    if (!taken || !taken.has(base)) return base;
  }
  return `Studio ${rng.int(1000, 9999)}`;
}

export function studioTagline(rng: Rng): string {
  return rng.pick([
    'Small team, long hours, big ideas.',
    'We ship on time. Mostly.',
    'Technology first, feelings second.',
    'Craft over franchise.',
    'Turning caffeine into cutscenes.',
    'No publishers, no apologies.',
    'Building worlds since the mono era.',
    'Playtest-driven development evangelists.',
    'Hardcore for hardcore.',
    'Family friendly, adult budget.',
  ]);
}

const TITLE_WORDS = {
  action: ['Fist', 'Blade', 'Steel', 'Rampage', 'Vendetta', 'Anvil', 'Warpath', 'Renegade', 'Ironhand', 'Combat'],
  rpg: ['Chronicle', 'Legacy', 'Oath', 'Aether', 'Runefall', 'Ashen', 'Sundered', 'Covenant', 'Exile', 'Godsong'],
  strategy: ['Command', 'Dominion', 'Line of March', 'Hegemony', 'War Room', 'Sovereign', 'Logistics', 'Empire', 'Frontline', 'Counsel'],
  simulation: ['Tycoon', 'Manager', 'Ops', 'Simulacra', 'Control Room', 'Cityscape', 'Factory', 'Harvest', 'Transit', 'Habitat'],
  adventure: ['Isle', 'Lantern', 'Journal', 'Cartographer', 'Hollow', 'Voyage', 'Signal', 'Orchard', 'Compass', 'Attic'],
  sports: ['Pro', 'League', 'All-Star', 'Clash', 'Championship', 'Rookie', 'Derby', 'Invitational', 'Playoff', 'Athlete'],
  racing: ['Apex', 'Redline', 'Torque', 'Slipstream', 'Turbo', 'Circuit', 'Overdrive', 'Grip', 'Horizon', 'Pace'],
  horror: ['Whisper', 'Hollow', 'Rot', 'Cellar', 'Nightjar', 'Pale', 'Static', 'Marrow', 'Crawlspace', 'Vigil'],
  shooter: ['Trigger', 'Calibre', 'Breach', 'Magnum', 'Contact', 'Ballistica', 'Suppression', 'Zero Hour', 'Recoil', 'Killzone'],
  puzzle: ['Circuitry', 'Blocks', 'Logic', 'Cascade', 'Tessellate', 'Fold', 'Glyph', 'Sequence', 'Knack', 'Lattice'],
};

const TITLE_CONNECTORS = ['of', 'of the', 'of a', 'and', 'vs.', ''];
const TITLE_TAILS = ['Rising', 'Reborn', 'Unbound', 'Redux', 'Protocol', 'Directive', 'Saga', 'Edge', 'Frontier', 'Zero', 'Two', 'Three', 'Awakening', 'Endgame'];

export function gameTitle(rng: Rng, genre: GenreId): string {
  const words = TITLE_WORDS[genre] ?? TITLE_WORDS.action;
  const style = rng.int(0, 3);
  const head = rng.pick(words);
  const tail = rng.pick(TITLE_WORDS[genre] ?? words);
  switch (style) {
    case 0:
      return `${head} ${rng.pick(TITLE_CONNECTORS)} ${tail}`.replace(/ {2,}/g, ' ');
    case 1:
      return `${head}: ${rng.pick(TITLE_TAILS)}`;
    case 2:
      return rng.chance(0.5) ? `${head} ${rng.int(2, 4)}` : `${head}`;
    default:
      return `${head} ${tail}`;
  }
}
