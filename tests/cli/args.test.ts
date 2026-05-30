import { describe, expect, it } from 'vitest';
import { defaultKeysEnv, parseArgs } from '../../src/cli/args.js';

describe('parseArgs', () => {
  it('returns an empty object for empty argv', () => {
    expect(parseArgs([])).toEqual({});
  });

  it('parses --flag value pairs', () => {
    expect(parseArgs(['--port', '8787', '--adapter', 'openai'])).toEqual({
      port: '8787',
      adapter: 'openai',
    });
  });

  it('treats a trailing flag with no value as boolean true', () => {
    expect(parseArgs(['--verbose'])).toEqual({ verbose: true });
  });

  it('treats a flag followed by another flag as boolean true', () => {
    expect(parseArgs(['--verbose', '--port', '8787'])).toEqual({
      verbose: true,
      port: '8787',
    });
  });

  it('ignores positional arguments and short flags', () => {
    expect(parseArgs(['start', '-v', '--port', '8787'])).toEqual({ port: '8787' });
  });

  it('handles values with dashes correctly (only -- prefix flips state)', () => {
    expect(parseArgs(['--auth-header', 'x-api-key', '--keys-env', 'OPENAI_API_KEYS'])).toEqual({
      'auth-header': 'x-api-key',
      'keys-env': 'OPENAI_API_KEYS',
    });
  });

  it('keeps the last occurrence when a flag is repeated', () => {
    expect(parseArgs(['--port', '1', '--port', '2'])).toEqual({ port: '2' });
  });
});

describe('defaultKeysEnv', () => {
  it('returns OPENAI_API_KEYS for openai', () => {
    expect(defaultKeysEnv('openai')).toBe('OPENAI_API_KEYS');
  });

  it('returns ANTHROPIC_API_KEYS for anthropic', () => {
    expect(defaultKeysEnv('anthropic')).toBe('ANTHROPIC_API_KEYS');
  });

  it('returns GEMINI_API_KEYS for gemini', () => {
    expect(defaultKeysEnv('gemini')).toBe('GEMINI_API_KEYS');
  });

  it('falls back to API_KEYS for unknown adapters', () => {
    expect(defaultKeysEnv('http')).toBe('API_KEYS');
    expect(defaultKeysEnv('unknown-future-adapter')).toBe('API_KEYS');
  });
});
