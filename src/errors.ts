/**
 * Custom errors emitted by keymesh.
 *
 * Every error in this module extends {@link KeymeshError}, which itself
 * extends the native {@link Error}. Consumers can branch on `instanceof` to
 * distinguish recoverable transient conditions (e.g.
 * {@link AllKeysExhaustedError}) from programmer mistakes
 * (e.g. {@link ConfigurationError}).
 *
 * @module
 */

/**
 * Base class for every error thrown by keymesh. Inherits the native
 * `Error(message, options)` constructor, so it carries the `cause` chain
 * when an underlying error is supplied via `{ cause }`.
 */
export class KeymeshError extends Error {
  override readonly name: string = 'KeymeshError';
}

/**
 * Thrown synchronously by `createKeymesh()` when the supplied configuration
 * is invalid (e.g. empty key pool, unknown strategy name, adapter returning
 * a non-object client).
 */
export class ConfigurationError extends KeymeshError {
  override readonly name = 'ConfigurationError';
}

/**
 * Thrown when every key in the pool has been tried and the request still
 * failed transiently, or when the retry budget was exhausted with no
 * candidate left. The original underlying error (if any) is exposed both
 * via `lastError` and the native `cause` chain.
 */
export class AllKeysExhaustedError extends KeymeshError {
  override readonly name = 'AllKeysExhaustedError';

  readonly attempts: number;
  readonly poolSize: number;
  readonly lastError?: Error | undefined;

  constructor(
    message: string,
    info: { attempts: number; poolSize: number; lastError?: Error | undefined },
  ) {
    super(message, info.lastError ? { cause: info.lastError } : undefined);
    this.attempts = info.attempts;
    this.poolSize = info.poolSize;
    this.lastError = info.lastError;
  }
}

/**
 * Thrown when a request is dispatched against a key whose circuit is open.
 * The orchestrator avoids this by filtering eligible keys before dispatch,
 * so this error surfaces only via custom selectors or explicit pool access.
 */
export class CircuitOpenError extends KeymeshError {
  override readonly name = 'CircuitOpenError';
  readonly keyId: string;
  readonly cooldownUntil: number;

  constructor(keyId: string, cooldownUntil: number) {
    super(`Circuit open for key ${keyId} until ${new Date(cooldownUntil).toISOString()}`);
    this.keyId = keyId;
    this.cooldownUntil = cooldownUntil;
  }
}

/**
 * Thrown when the upstream signalled a rate limit (HTTP 429 or equivalent)
 * and no retry budget remains. Consumers usually do not see this directly;
 * the orchestrator unwraps it into an {@link AllKeysExhaustedError} after
 * all keys are tried.
 */
export class RateLimitedError extends KeymeshError {
  override readonly name = 'RateLimitedError';
  readonly retryAfterMs?: number | undefined;
  readonly status?: number | undefined;

  constructor(
    message: string,
    info: { retryAfterMs?: number | undefined; status?: number | undefined },
  ) {
    super(message);
    this.retryAfterMs = info.retryAfterMs;
    this.status = info.status;
  }
}

/**
 * Thrown by the retrier when the cumulative time spent retrying exceeded
 * the configured `retry.totalBudgetMs`. The orchestrator propagates this
 * unchanged so the caller can distinguish "no more time" from "no more
 * keys".
 */
export class TotalBudgetExceededError extends KeymeshError {
  override readonly name = 'TotalBudgetExceededError';
  readonly elapsedMs: number;
  readonly budgetMs: number;

  constructor(elapsedMs: number, budgetMs: number) {
    super(`Retry budget exceeded: ${elapsedMs}ms > ${budgetMs}ms`);
    this.elapsedMs = elapsedMs;
    this.budgetMs = budgetMs;
  }
}
