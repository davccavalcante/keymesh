/**
 * Public types for keymesh.
 * @module
 */

export type StrategyName = 'round-robin' | 'weighted' | 'least-used' | 'sequential-then-rotate';

export type BackendName = 'memory' | 'file';

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface KeyConfig {
  /** The raw key value (e.g., the API token). */
  value: string;
  /** A human-readable identifier. Defaults to `key-<hash8>`. */
  label?: string;
  /** Relative weight for the `weighted` strategy. Default: 1. */
  weight?: number;
  /** Relative cost tier (0 = free, 1 = paid base, 2 = premium...). Reserved for `cost-aware` in 1.1. */
  costTier?: number;
}

export interface KeyState {
  config: KeyConfig;
  /** Stable hashed identifier (first 8 hex chars of SHA-256). */
  id: string;
  /** Last successful use, ms since epoch. 0 if never. */
  lastUsedAt: number;
  /** Total successes since registry init. */
  successCount: number;
  /** Total failures since registry init. */
  failureCount: number;
  /** Current in-flight call count (used by least-used). */
  inFlight: number;
  /** Health score (0 to 100). */
  healthScore: number;
  /** Circuit state. */
  circuitState: CircuitState;
  /** Timestamp (ms) until which this key is in cooldown. 0 if not. */
  cooldownUntil: number;
  /** Consecutive failures since last success. */
  consecutiveFailures: number;
}

export interface CircuitBreakerConfig {
  /** Consecutive failures before opening the circuit. */
  threshold: number;
  /** Time in ms the circuit stays open. */
  cooldownMs: number;
  /** Max calls allowed in half-open state. */
  halfOpenMaxCalls: number;
}

export interface RetryConfig {
  /** Max retry attempts (additional to the initial). */
  max: number;
  /** Base delay before first retry, ms. */
  baseMs: number;
  /** Max delay cap, ms. */
  maxMs: number;
  /** Apply AWS full-jitter algorithm. */
  jitter: boolean;
  /** Total budget across all retries, ms. */
  totalBudgetMs: number;
}

export interface HealthMonitorConfig {
  /** Half-life of the health score, ms. */
  decayHalfLifeMs: number;
}

export interface TelemetryConfig {
  enabled: boolean;
}

export interface DetectedError {
  /** HTTP status if known. */
  status?: number | undefined;
  /** Retry-after suggestion in ms if surfaced by the server. */
  retryAfterMs?: number | undefined;
  /** Whether keymesh should retry/rotate on this error. */
  isTransient: boolean;
  /** Human-readable message. */
  message: string;
}

export type RequestStartEvent = {
  type: 'request.start';
  keyId: string;
  path: string[];
  timestamp: number;
};
export type RequestSuccessEvent = {
  type: 'request.success';
  keyId: string;
  path: string[];
  elapsedMs: number;
  timestamp: number;
};
export type RequestFailEvent = {
  type: 'request.fail';
  keyId: string;
  path: string[];
  status?: number | undefined;
  error: string;
  elapsedMs: number;
  timestamp: number;
};
export type KeyRotatedEvent = {
  type: 'key.rotated';
  from: string;
  to: string;
  reason: string;
  timestamp: number;
};
export type CircuitOpenEvent = {
  type: 'circuit.open';
  keyId: string;
  consecutiveFailures: number;
  cooldownUntil: number;
  timestamp: number;
};
export type CircuitClosedEvent = {
  type: 'circuit.closed';
  keyId: string;
  timestamp: number;
};
export type CircuitHalfOpenEvent = {
  type: 'circuit.half-open';
  keyId: string;
  timestamp: number;
};
export type AllExhaustedEvent = {
  type: 'all.exhausted';
  reason: string;
  timestamp: number;
};

export type TelemetryEvent =
  | RequestStartEvent
  | RequestSuccessEvent
  | RequestFailEvent
  | KeyRotatedEvent
  | CircuitOpenEvent
  | CircuitClosedEvent
  | CircuitHalfOpenEvent
  | AllExhaustedEvent;

export type TelemetryEventName = TelemetryEvent['type'];

export type EventOf<T extends TelemetryEventName> = Extract<TelemetryEvent, { type: T }>;

export type EventHandler<T extends TelemetryEventName> = (event: EventOf<T>) => void;

export interface PoolSnapshot {
  keys: Array<{
    id: string;
    label: string;
    circuitState: CircuitState;
    healthScore: number;
    inFlight: number;
    successCount: number;
    failureCount: number;
    consecutiveFailures: number;
    cooldownUntil: number;
    lastUsedAt: number;
  }>;
  strategy: string;
  totalRequests: number;
  totalFailures: number;
}

/**
 * Public extras attached to any keymesh client (independent of the wrapped SDK).
 */
export interface KeymeshExtras {
  /** Subscribe to a telemetry event. */
  on<T extends TelemetryEventName>(event: T, handler: EventHandler<T>): void;
  /** Unsubscribe a telemetry handler. */
  off<T extends TelemetryEventName>(event: T, handler: EventHandler<T>): void;
  /** Inspect current pool state. */
  inspect(): PoolSnapshot;
  /** Manually close the client (flush file backend, etc.). */
  close(): Promise<void>;
}

// Forward declarations are imported from the interface files.
export type { ProviderAdapter } from './adapters/types.js';
export type { StateBackend } from './state/types.js';
export type { SelectorStrategy } from './strategies/types.js';

import type { ProviderAdapter } from './adapters/types.js';
import type { StateBackend } from './state/types.js';
import type { SelectorStrategy } from './strategies/types.js';

export interface KeymeshConfig<TClient = unknown, TOptions = unknown> {
  /** The provider adapter. */
  provider: ProviderAdapter<TClient, TOptions>;
  /** Pool of credentials. Strings are wrapped into KeyConfig. */
  keys: Array<string | KeyConfig>;
  /** Selection strategy. Default: 'round-robin'. */
  strategy?: StrategyName | SelectorStrategy;
  /** State backend. Default: 'memory'. */
  state?: BackendName | StateBackend;
  /** State file path (only used if state is 'file'). Default: '.keymesh-state.jsonl'. */
  stateFile?: string | undefined;
  /** Circuit breaker config. */
  circuitBreaker?: Partial<CircuitBreakerConfig>;
  /** Retry config. */
  retry?: Partial<RetryConfig>;
  /** Health monitor config. */
  health?: Partial<HealthMonitorConfig>;
  /** Telemetry config. */
  telemetry?: Partial<TelemetryConfig>;
  /** HTTP status codes that trigger failover. Default: [408, 425, 429, 500, 502, 503, 504]. */
  failoverStatusCodes?: number[];
  /** Provider-specific options forwarded to `provider.createClient`. */
  providerOptions?: TOptions;
}
