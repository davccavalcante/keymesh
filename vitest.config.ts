import { defineConfig } from 'vitest/config';

/**
 * Vitest configuration for @takk/keymesh.
 *
 * - Node environment (the library targets Node and edge runtimes; no DOM).
 * - Explicit imports: `globals: false` keeps `describe`/`it`/`expect` as
 *   real imports for editor go-to-definition and discoverability.
 * - Coverage excludes the CLI (script-style, exercised via integration),
 *   the public re-export barrel, and pure type modules.
 */
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    globals: false,
    reporters: ['default'],
    testTimeout: 10_000,
    hookTimeout: 10_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/cli/index.ts', 'src/**/types.ts', 'src/index.ts'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
    },
  },
});
