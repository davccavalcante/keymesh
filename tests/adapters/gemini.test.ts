import { describe, expect, it } from 'vitest';
import { geminiAdapter } from '../../src/adapters/gemini.js';

describe('geminiAdapter.detectError', () => {
  it('reads status from a top-level field', () => {
    expect(geminiAdapter.detectError({ status: 503 }).status).toBe(503);
  });

  it('reads status from err.response.status fallback', () => {
    const detected = geminiAdapter.detectError({ response: { status: 502 } });
    expect(detected.status).toBe(502);
    expect(detected.isTransient).toBe(true);
  });

  it('parses Retry-After from err.response.headers', () => {
    const detected = geminiAdapter.detectError({
      response: { status: 429, headers: { 'retry-after': '4' } },
    });
    expect(detected.retryAfterMs).toBe(4000);
  });

  it('marks 403 as non-transient (auth issue)', () => {
    expect(geminiAdapter.detectError({ status: 403 }).isTransient).toBe(false);
  });

  it('handles entirely opaque errors', () => {
    const detected = geminiAdapter.detectError('weird');
    expect(detected.status).toBeUndefined();
    expect(detected.isTransient).toBe(false);
    expect(detected.message).toBe('weird');
  });
});
