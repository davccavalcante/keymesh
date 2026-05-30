import { TotalBudgetExceededError } from '../errors.js';
import type { RetryConfig } from '../types.js';

/**
 * Retry policy factory implementing the AWS full-jitter backoff:
 *
 *   delay = random_between(0, min(maxMs, baseMs * 2 ** attempt))
 *
 * Bounded both by a maximum attempt count (`max`) and by a total wall-clock
 * budget (`totalBudgetMs`). Stateless across requests; call {@link start}
 * to allocate a fresh per-request {@link RetryContext}.
 *
 * The full-jitter algorithm is recommended by AWS for distributed retries
 * because it minimizes synchronized thundering-herd retries across many
 * clients hitting a recovering endpoint simultaneously.
 */
export class Retrier {
  constructor(private readonly config: RetryConfig) {}

  start(): RetryContext {
    return new RetryContext(this.config);
  }
}

/**
 * Per-request retry state. Tracks attempt count and elapsed wall time,
 * and computes the next sleep duration before the next attempt.
 */
export class RetryContext {
  private attempts = 0;
  private readonly startedAt: number;

  constructor(private readonly config: RetryConfig) {
    this.startedAt = Date.now();
  }

  /** Number of retries already performed (not counting the initial attempt). */
  get retryCount(): number {
    return this.attempts;
  }

  /** Total elapsed time since `start()` was called, in ms. */
  elapsedMs(): number {
    return Date.now() - this.startedAt;
  }

  /**
   * Compute the delay before the next attempt and increment the retry
   * counter. Returns `null` if the attempt budget is exhausted. Throws
   * {@link TotalBudgetExceededError} if the time budget is exhausted.
   *
   * If `retryAfterMs` is provided (typically from a `Retry-After` header)
   * it is used verbatim, capped at `config.maxMs`, instead of computing
   * exponential backoff.
   */
  nextDelay(retryAfterMs?: number): number | null {
    if (this.attempts >= this.config.max) return null;
    const elapsed = this.elapsedMs();
    if (elapsed >= this.config.totalBudgetMs) {
      throw new TotalBudgetExceededError(elapsed, this.config.totalBudgetMs);
    }
    this.attempts += 1;
    if (retryAfterMs !== undefined && retryAfterMs > 0) {
      return Math.min(retryAfterMs, this.config.maxMs);
    }
    const ceiling = Math.min(this.config.maxMs, this.config.baseMs * 2 ** (this.attempts - 1));
    if (this.config.jitter) {
      return Math.floor(Math.random() * ceiling);
    }
    return ceiling;
  }

  /** Promise-based sleep helper. Resolves immediately if `ms <= 0`. */
  static async sleep(ms: number): Promise<void> {
    if (ms <= 0) return;
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}
