import { describe, expect, it } from 'vitest';
import { Retrier, RetryContext } from '../../src/core/Retrier.js';
import { TotalBudgetExceededError } from '../../src/errors.js';

describe('Retrier / RetryContext', () => {
  it('returns null after max retries', () => {
    const r = new Retrier({
      max: 2,
      baseMs: 10,
      maxMs: 100,
      jitter: false,
      totalBudgetMs: 60_000,
    });
    const ctx = r.start();
    expect(ctx.nextDelay()).toBe(10);
    expect(ctx.nextDelay()).toBe(20);
    expect(ctx.nextDelay()).toBeNull();
  });

  it('caps at maxMs', () => {
    const r = new Retrier({
      max: 10,
      baseMs: 100,
      maxMs: 250,
      jitter: false,
      totalBudgetMs: 60_000,
    });
    const ctx = r.start();
    ctx.nextDelay(); // 100
    ctx.nextDelay(); // 200
    expect(ctx.nextDelay()).toBe(250); // capped
  });

  it('jitter produces a value within [0, ceiling]', () => {
    const r = new Retrier({
      max: 1,
      baseMs: 100,
      maxMs: 100,
      jitter: true,
      totalBudgetMs: 60_000,
    });
    const ctx = r.start();
    const delay = ctx.nextDelay();
    expect(delay).not.toBeNull();
    expect(delay).toBeGreaterThanOrEqual(0);
    expect(delay).toBeLessThanOrEqual(100);
  });

  it('honors explicit retryAfterMs', () => {
    const r = new Retrier({
      max: 5,
      baseMs: 10,
      maxMs: 1000,
      jitter: false,
      totalBudgetMs: 60_000,
    });
    const ctx = r.start();
    expect(ctx.nextDelay(500)).toBe(500);
  });

  it('caps retryAfterMs at maxMs', () => {
    const r = new Retrier({
      max: 5,
      baseMs: 10,
      maxMs: 1000,
      jitter: false,
      totalBudgetMs: 60_000,
    });
    const ctx = r.start();
    expect(ctx.nextDelay(5000)).toBe(1000);
  });

  it('throws when total budget is exceeded', async () => {
    const r = new Retrier({
      max: 100,
      baseMs: 10,
      maxMs: 1000,
      jitter: false,
      totalBudgetMs: 50,
    });
    const ctx = r.start();
    await RetryContext.sleep(60);
    expect(() => ctx.nextDelay()).toThrow(TotalBudgetExceededError);
  });

  it('tracks retryCount accurately', () => {
    const r = new Retrier({
      max: 3,
      baseMs: 10,
      maxMs: 1000,
      jitter: false,
      totalBudgetMs: 60_000,
    });
    const ctx = r.start();
    expect(ctx.retryCount).toBe(0);
    ctx.nextDelay();
    expect(ctx.retryCount).toBe(1);
    ctx.nextDelay();
    expect(ctx.retryCount).toBe(2);
  });
});
