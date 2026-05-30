import { describe, expect, it } from 'vitest';
import {
  AllKeysExhaustedError,
  CircuitOpenError,
  ConfigurationError,
  KeymeshError,
  RateLimitedError,
  TotalBudgetExceededError,
} from '../src/errors.js';

describe('KeymeshError', () => {
  it('exposes message via Error and sets name', () => {
    const err = new KeymeshError('test message');
    expect(err.message).toBe('test message');
    expect(err.name).toBe('KeymeshError');
    expect(err).toBeInstanceOf(Error);
  });

  it('preserves a native cause when supplied', () => {
    const root = new Error('underlying');
    const err = new KeymeshError('wrapper', { cause: root });
    expect((err as Error & { cause: unknown }).cause).toBe(root);
  });
});

describe('ConfigurationError', () => {
  it('inherits from KeymeshError and has its own name', () => {
    const err = new ConfigurationError('bad config');
    expect(err.name).toBe('ConfigurationError');
    expect(err).toBeInstanceOf(KeymeshError);
    expect(err).toBeInstanceOf(Error);
  });
});

describe('AllKeysExhaustedError', () => {
  it('carries attempts/poolSize/lastError', () => {
    const last = new Error('last upstream failure');
    const err = new AllKeysExhaustedError('pool exhausted', {
      attempts: 4,
      poolSize: 3,
      lastError: last,
    });
    expect(err.name).toBe('AllKeysExhaustedError');
    expect(err.attempts).toBe(4);
    expect(err.poolSize).toBe(3);
    expect(err.lastError).toBe(last);
    expect((err as Error & { cause: unknown }).cause).toBe(last);
  });

  it('works without a lastError', () => {
    const err = new AllKeysExhaustedError('exhausted', { attempts: 1, poolSize: 1 });
    expect(err.lastError).toBeUndefined();
    expect((err as Error & { cause: unknown }).cause).toBeUndefined();
  });
});

describe('CircuitOpenError', () => {
  it('formats the message with keyId and ISO cooldown', () => {
    const cooldown = Date.UTC(2026, 0, 1, 0, 0, 0);
    const err = new CircuitOpenError('abc12345', cooldown);
    expect(err.name).toBe('CircuitOpenError');
    expect(err.keyId).toBe('abc12345');
    expect(err.cooldownUntil).toBe(cooldown);
    expect(err.message).toContain('abc12345');
    expect(err.message).toContain('2026-01-01T00:00:00.000Z');
  });
});

describe('RateLimitedError', () => {
  it('exposes retryAfterMs and status', () => {
    const err = new RateLimitedError('rate limited', { retryAfterMs: 5000, status: 429 });
    expect(err.name).toBe('RateLimitedError');
    expect(err.retryAfterMs).toBe(5000);
    expect(err.status).toBe(429);
  });

  it('allows omitted retryAfterMs and status', () => {
    const err = new RateLimitedError('rate limited', {});
    expect(err.retryAfterMs).toBeUndefined();
    expect(err.status).toBeUndefined();
  });
});

describe('TotalBudgetExceededError', () => {
  it('formats the message with elapsed and budget', () => {
    const err = new TotalBudgetExceededError(7000, 5000);
    expect(err.name).toBe('TotalBudgetExceededError');
    expect(err.elapsedMs).toBe(7000);
    expect(err.budgetMs).toBe(5000);
    expect(err.message).toBe('Retry budget exceeded: 7000ms > 5000ms');
  });
});
