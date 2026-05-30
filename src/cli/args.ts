/**
 * Pure helpers for CLI argument parsing.
 *
 * Extracted so they can be unit-tested without spawning a subprocess. The
 * CLI itself lives in `./index.ts` and only deals with side effects
 * (process.argv, console output, HTTP server, process signals).
 *
 * @internal
 * @module
 */

/**
 * Parse a long-flag-only argv slice into a record of `--flag` -> value (or
 * `true` when the flag is provided without a value). Unknown short flags
 * and positional arguments are ignored.
 *
 * @example
 *   parseArgs(['--port', '8787', '--adapter', 'openai', '--verbose'])
 *   // => { port: '8787', adapter: 'openai', verbose: true }
 */
export function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg) continue;
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        out[key] = true;
      } else {
        out[key] = next;
        i += 1;
      }
    }
  }
  return out;
}

/**
 * Default `--keys-env` value for a given adapter. Lets users omit the
 * `--keys-env` flag and have keymesh look up the conventional env var
 * for the chosen adapter.
 */
export function defaultKeysEnv(adapter: string): string {
  switch (adapter) {
    case 'openai':
      return 'OPENAI_API_KEYS';
    case 'anthropic':
      return 'ANTHROPIC_API_KEYS';
    case 'gemini':
      return 'GEMINI_API_KEYS';
    default:
      return 'API_KEYS';
  }
}
