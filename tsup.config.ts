import { defineConfig } from 'tsup';

/**
 * Build configuration for @takk/keymesh.
 *
 * Emits dual ESM + CJS bundles plus matching .d.ts / .d.cts type files for
 * the public library entrypoints. The CLI entry skips type emission because
 * it is a script and not part of the published type surface.
 */
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'adapters/openai': 'src/adapters/openai.ts',
    'adapters/anthropic': 'src/adapters/anthropic.ts',
    'adapters/gemini': 'src/adapters/gemini.ts',
    'adapters/http': 'src/adapters/http.ts',
    'cli/index': 'src/cli/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: {
    entry: {
      index: 'src/index.ts',
      'adapters/openai': 'src/adapters/openai.ts',
      'adapters/anthropic': 'src/adapters/anthropic.ts',
      'adapters/gemini': 'src/adapters/gemini.ts',
      'adapters/http': 'src/adapters/http.ts',
    },
  },
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  target: 'node20',
  outDir: 'dist',
  shims: false,
  minify: false,
  esbuildOptions(options) {
    options.conditions = ['module'];
  },
});
