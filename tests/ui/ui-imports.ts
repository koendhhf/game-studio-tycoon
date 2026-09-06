/**
 * What the UI tests are allowed to see: the engine's public surface and the UI's own formatter.
 * Deliberately narrow — if a screen needs more than this to render, the screen is doing work it
 * should not be doing.
 */

export { Simulation, createProject } from '../../src/sim';
export { money } from '../../src/ui/format';
export type { WorldState } from '../../src/sim';
