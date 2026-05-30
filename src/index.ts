/**
 * @takk/keymesh - universal API key rotation, failover, load balancing,
 * circuit breaking, and rate-limit recovery for Node, Bun, Deno, and edge runtimes.
 *
 * Public entrypoint. Adapters live under their own subpath exports
 * (`@takk/keymesh/openai`, `/anthropic`, `/gemini`, `/http`) so that
 * the optional peer SDKs are only resolved when actually imported.
 *
 * @module
 */

export { createKeymesh } from './core/createKeymesh.js';

export {
  AllKeysExhaustedError,
  CircuitOpenError,
  ConfigurationError,
  KeymeshError,
  RateLimitedError,
  TotalBudgetExceededError,
} from './errors.js';
export { FileBackend } from './state/file.js';
export { MemoryBackend } from './state/memory.js';
export { LeastUsedStrategy } from './strategies/LeastUsed.js';
export { RoundRobinStrategy } from './strategies/RoundRobin.js';
export { SequentialThenRotateStrategy } from './strategies/SequentialThenRotate.js';
export { WeightedStrategy } from './strategies/Weighted.js';
export type {
  AllExhaustedEvent,
  BackendName,
  CircuitBreakerConfig,
  CircuitClosedEvent,
  CircuitHalfOpenEvent,
  CircuitOpenEvent,
  CircuitState,
  DetectedError,
  EventHandler,
  EventOf,
  HealthMonitorConfig,
  KeyConfig,
  KeymeshConfig,
  KeymeshExtras,
  KeyRotatedEvent,
  KeyState,
  PoolSnapshot,
  ProviderAdapter,
  RequestFailEvent,
  RequestStartEvent,
  RequestSuccessEvent,
  RetryConfig,
  SelectorStrategy,
  StateBackend,
  StrategyName,
  TelemetryConfig,
  TelemetryEvent,
  TelemetryEventName,
} from './types.js';

export const VERSION = '1.0.0';
