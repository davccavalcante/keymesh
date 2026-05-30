import { describe, expect, it } from 'vitest';
import { openaiAdapter } from '../../src/adapters/openai.js';

describe('openaiAdapter.detectError', () => {
  it('extracts numeric status from a SDK error', () => {
    const err = { status: 429, message: 'rate limit', headers: new Headers() };
    const detected = openaiAdapter.detectError(err);
    expect(detected.status).toBe(429);
    expect(detected.isTransient).toBe(true);
  });

  it('marks 400 as non-transient', () => {
    const detected = openaiAdapter.detectError({ status: 400, message: 'bad request' });
    expect(detected.isTransient).toBe(false);
  });

  it('marks every standard transient status as transient', () => {
    for (const status of [408, 425, 429, 500, 502, 503, 504]) {
      expect(openaiAdapter.detectError({ status }).isTransient).toBe(true);
    }
  });

  it('parses Retry-After in seconds via Headers.get()', () => {
    const headers = new Headers({ 'retry-after': '3' });
    const detected = openaiAdapter.detectError({ status: 429, headers });
    expect(detected.retryAfterMs).toBe(3000);
  });

  it('parses Retry-After from plain object headers', () => {
    const detected = openaiAdapter.detectError({
      status: 429,
      headers: { 'retry-after': '7' },
    });
    expect(detected.retryAfterMs).toBe(7000);
  });

  it('returns undefined retryAfterMs on non-numeric, non-date Retry-After', () => {
    const headers = new Headers({ 'retry-after': 'soon' });
    const detected = openaiAdapter.detectError({ status: 429, headers });
    expect(detected.retryAfterMs).toBeUndefined();
  });

  it('handles missing message gracefully', () => {
    const detected = openaiAdapter.detectError({ status: 500 });
    expect(detected.message).toBeDefined();
    expect(typeof detected.message).toBe('string');
  });

  it('produces a non-transient result for an opaque non-status error', () => {
    const detected = openaiAdapter.detectError(new Error('socket hang up'));
    expect(detected.status).toBeUndefined();
    expect(detected.isTransient).toBe(false);
  });
});
