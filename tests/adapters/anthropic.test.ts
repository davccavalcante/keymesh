import { describe, expect, it } from 'vitest';
import { anthropicAdapter } from '../../src/adapters/anthropic.js';

describe('anthropicAdapter.detectError', () => {
  it('marks Anthropic-specific 529 (overloaded) as transient', () => {
    const detected = anthropicAdapter.detectError({ status: 529 });
    expect(detected.isTransient).toBe(true);
  });

  it('marks 429 as transient with Retry-After parsed', () => {
    const headers = new Headers({ 'retry-after': '12' });
    const detected = anthropicAdapter.detectError({ status: 429, headers });
    expect(detected.isTransient).toBe(true);
    expect(detected.retryAfterMs).toBe(12_000);
  });

  it('marks 401 (unauthorized) as non-transient', () => {
    expect(anthropicAdapter.detectError({ status: 401 }).isTransient).toBe(false);
  });

  it('returns undefined status when none is provided', () => {
    expect(anthropicAdapter.detectError(new Error('disconnect')).status).toBeUndefined();
  });
});
