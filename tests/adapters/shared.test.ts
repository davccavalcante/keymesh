import { describe, expect, it } from 'vitest';
import { extractRetryAfterMs, parseRetryAfter } from '../../src/adapters/_shared.js';

describe('parseRetryAfter', () => {
  it('parses an integer-seconds value', () => {
    expect(parseRetryAfter('5')).toBe(5000);
  });

  it('parses a decimal-seconds value', () => {
    expect(parseRetryAfter('0.5')).toBe(500);
  });

  it('floors negative seconds at 0', () => {
    expect(parseRetryAfter('-10')).toBe(0);
  });

  it('parses an HTTP-date and returns ms until then', () => {
    const future = new Date(Date.now() + 60_000).toUTCString();
    const result = parseRetryAfter(future);
    expect(result).toBeDefined();
    expect(result).toBeGreaterThan(50_000);
    expect(result).toBeLessThanOrEqual(60_000);
  });

  it('floors a past HTTP-date at 0', () => {
    const past = new Date(Date.now() - 60_000).toUTCString();
    expect(parseRetryAfter(past)).toBe(0);
  });

  it('returns undefined for unparseable input', () => {
    expect(parseRetryAfter('soon')).toBeUndefined();
    expect(parseRetryAfter('')).toBeUndefined();
  });
});

describe('extractRetryAfterMs', () => {
  it('returns undefined for null or undefined headers', () => {
    expect(extractRetryAfterMs(null)).toBeUndefined();
    expect(extractRetryAfterMs(undefined)).toBeUndefined();
  });

  it('reads via Headers.get() when present', () => {
    const h = new Headers({ 'retry-after': '7' });
    expect(extractRetryAfterMs(h)).toBe(7000);
  });

  it('reads via plain-object lookup when no .get() exists', () => {
    expect(extractRetryAfterMs({ 'retry-after': '3' })).toBe(3000);
  });

  it('returns undefined when retry-after key is missing', () => {
    expect(extractRetryAfterMs({})).toBeUndefined();
    expect(extractRetryAfterMs(new Headers())).toBeUndefined();
  });

  it('ignores non-string plain-object retry-after values', () => {
    expect(extractRetryAfterMs({ 'retry-after': 3 })).toBeUndefined();
  });
});
