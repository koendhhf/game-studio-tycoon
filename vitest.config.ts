import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Tests run in plain Node — no browser, no jsdom. That is deliberate: the simulation is UI-free,
 * so `npm test` verifies the game itself, and the UI tests render to static markup to prove the
 * screens are a projection of the world rather than a second copy of its rules.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    globals: false,
    testTimeout: 120000,
    hookTimeout: 120000,
    pool: 'threads',
  },
});
