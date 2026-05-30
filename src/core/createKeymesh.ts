import { AllKeysExhaustedError, ConfigurationError, KeymeshError } from '../errors.js';
import { FileBackend } from '../state/file.js';
import { MemoryBackend } from '../state/memory.js';
import type { StateBackend } from '../state/types.js';
import { LeastUsedStrategy } from '../strategies/LeastUsed.js';
import { RoundRobinStrategy } from '../strategies/RoundRobin.js';
import { SequentialThenRotateStrategy } from '../strategies/SequentialThenRotate.js';
import type { SelectorStrategy } from '../strategies/types.js';
import { WeightedStrategy } from '../strategies/Weighted.js';
import type {
  CircuitBreakerConfig,
  EventHandler,
  HealthMonitorConfig,
  KeymeshConfig,
  KeymeshExtras,
  PoolSnapshot,
  RetryConfig,
  StrategyName,
  TelemetryEventName,
} from '../types.js';
import { CircuitBreaker } from './CircuitBreaker.js';
import { HealthMonitor } from './HealthMonitor.js';
import { KeyRegistry } from './KeyRegistry.js';
import { Retrier, RetryContext } from './Retrier.js';
import { Telemetry } from './Telemetry.js';

const DEFAULT_CIRCUIT_BREAKER: CircuitBreakerConfig = {
  threshold: 3,
  cooldownMs: 30_000,
  halfOpenMaxCalls: 1,
};

const DEFAULT_RETRY: RetryConfig = {
  max: 5,
  baseMs: 200,
  maxMs: 30_000,
  jitter: true,
  totalBudgetMs: 60_000,
};

const DEFAULT_HEALTH: HealthMonitorConfig = {
  decayHalfLifeMs: 5 * 60_000,
};

const DEFAULT_FAILOVER_CODES: readonly number[] = [408, 425, 429, 500, 502, 503, 504];

/** A 24-hour cooldown applied to a key that returned 401 Unauthorized. */
const AUTH_FAILURE_COOLDOWN_MS = 24 * 60 * 60_000;

/**
 * Build a keymesh-wrapped client.
 *
 * The returned value mirrors the shape of `config.provider.createClient(...)`
 * and additionally exposes the {@link KeymeshExtras} surface
 * (`on/off/inspect/close`) for telemetry subscription and pool inspection.
 *
 * @example
 * const client = createKeymesh({
 *   provider: openaiAdapter,
 *   keys: process.env.OPENAI_API_KEYS?.split(',') ?? [],
 *   strategy: 'least-used',
 * });
 * const reply = await client.chat.completions.create({ ... });
 *
 * client.on('key.rotated', (e) => log.info({ from: e.from, to: e.to }));
 * client.inspect(); // current pool snapshot
 * await client.close(); // flushes file backend if configured
 */
export function createKeymesh<TClient extends object, TOptions = unknown>(
  config: KeymeshConfig<TClient, TOptions>,
): TClient & KeymeshExtras {
  const orchestrator = new Orchestrator(config);
  return orchestrator.buildProxy();
}

/**
 * Internal orchestrator. Holds the per-keymesh-instance state (registry,
 * clients, telemetry, breakers) and implements the execute/retry/rotate
 * loop. The public surface is the {@link createKeymesh} factory.
 */
class Orchestrator<TClient extends object, TOptions = unknown> {
  private readonly adapter: KeymeshConfig<TClient, TOptions>['provider'];
  private readonly registry: KeyRegistry;
  private readonly clients = new Map<string, TClient>();
  private readonly strategy: SelectorStrategy;
  private readonly state: StateBackend;
  private readonly telemetry: Telemetry;
  private readonly retrier: Retrier;
  private readonly circuitBreaker: CircuitBreaker;
  private readonly healthMonitor: HealthMonitor;
  private readonly failoverCodes: Set<number>;
  private totalRequests = 0;
  private totalFailures = 0;

  constructor(config: KeymeshConfig<TClient, TOptions>) {
    if (!config.provider) {
      throw new ConfigurationError('keymesh: `provider` is required.');
    }
    this.adapter = config.provider;
    this.registry = new KeyRegistry(config.keys);

    for (const keyState of this.registry.all()) {
      const client = this.adapter.createClient(keyState.config.value, config.providerOptions);
      if (client === null || typeof client !== 'object') {
        throw new ConfigurationError(
          `keymesh: adapter "${this.adapter.name}" produced a non-object client for key ${keyState.id}.`,
        );
      }
      this.clients.set(keyState.id, client);
    }

    this.strategy = resolveStrategy(config.strategy);
    this.state = resolveBackend(config.state, config.stateFile);
    this.telemetry = new Telemetry(config.telemetry?.enabled ?? true);
    this.retrier = new Retrier({ ...DEFAULT_RETRY, ...config.retry });
    this.circuitBreaker = new CircuitBreaker({
      ...DEFAULT_CIRCUIT_BREAKER,
      ...config.circuitBreaker,
    });
    this.healthMonitor = new HealthMonitor({
      ...DEFAULT_HEALTH,
      ...config.health,
    });
    this.failoverCodes = new Set(config.failoverStatusCodes ?? DEFAULT_FAILOVER_CODES);

    void this.hydrateFromBackend();
  }

  private async hydrateFromBackend(): Promise<void> {
    try {
      const stored = await this.state.loadAll();
      for (const [id, partial] of stored) {
        if (this.registry.get(id)) {
          this.registry.patch(id, partial);
        }
      }
    } catch {
      // Backend may not be ready (missing file, transient I/O); silent on init.
    }
  }

  buildProxy(): TClient & KeymeshExtras {
    const first = this.registry.order[0];
    if (!first) {
      throw new ConfigurationError('keymesh: empty key pool after init.');
    }
    const template = this.clients.get(first);
    if (!template) {
      throw new ConfigurationError('keymesh: failed to build client for the first key.');
    }
    return deepWrap(template, this as Orchestrator<object, unknown>, []) as TClient & KeymeshExtras;
  }

  extras(): KeymeshExtras {
    return {
      on: <T extends TelemetryEventName>(event: T, handler: EventHandler<T>) =>
        this.telemetry.on(event, handler),
      off: <T extends TelemetryEventName>(event: T, handler: EventHandler<T>) =>
        this.telemetry.off(event, handler),
      inspect: () => this.inspect(),
      close: () => this.close(),
    };
  }

  inspect(): PoolSnapshot {
    return {
      strategy: this.strategy.name,
      totalRequests: this.totalRequests,
      totalFailures: this.totalFailures,
      keys: this.registry.all().map((s) => ({
        id: s.id,
        label: s.config.label ?? s.id,
        circuitState: s.circuitState,
        healthScore: s.healthScore,
        inFlight: s.inFlight,
        successCount: s.successCount,
        failureCount: s.failureCount,
        consecutiveFailures: s.consecutiveFailures,
        cooldownUntil: s.cooldownUntil,
        lastUsedAt: s.lastUsedAt,
      })),
    };
  }

  async close(): Promise<void> {
    if (this.state.close) {
      await this.state.close();
    }
  }

  /**
   * Main execution loop. Picks an eligible key, dispatches the call,
   * and on transient failure rotates to the next key (respecting the
   * retry/cooldown budget). Surfaces non-transient errors to the caller
   * directly; transient exhaustion as {@link AllKeysExhaustedError}.
   */
  async execute(path: string[], args: unknown[]): Promise<unknown> {
    if (path.length === 0) {
      throw new KeymeshError('keymesh: execute() called with empty path.');
    }
    this.totalRequests += 1;
    const retryCtx = this.retrier.start();
    const triedKeys = new Set<string>();
    let lastError: Error | undefined;
    let previousKeyId: string | undefined;

    while (true) {
      const now = Date.now();
      const eligible = this.registry.eligible(now).filter((k) => !triedKeys.has(k.id));

      if (eligible.length === 0) {
        const reason =
          triedKeys.size >= this.registry.size
            ? 'All keys in pool have been tried and failed'
            : 'All keys are in cooldown or have an open circuit';
        this.telemetry.emit({ type: 'all.exhausted', reason, timestamp: now });
        throw new AllKeysExhaustedError(reason, {
          attempts: retryCtx.retryCount + 1,
          poolSize: this.registry.size,
          lastError,
        });
      }

      const picked = this.strategy.pick(eligible, this.registry.all());
      if (!picked) {
        throw new AllKeysExhaustedError(`keymesh: strategy ${this.strategy.name} returned no key`, {
          attempts: retryCtx.retryCount + 1,
          poolSize: this.registry.size,
          lastError,
        });
      }
      triedKeys.add(picked.id);

      // Open -> half-open transition is decided at pick time.
      const transitionedState = this.circuitBreaker.transitionOnPick(picked, now);
      if (transitionedState !== picked.circuitState) {
        this.registry.patch(picked.id, { circuitState: transitionedState });
        if (transitionedState === 'half-open') {
          this.telemetry.emit({ type: 'circuit.half-open', keyId: picked.id, timestamp: now });
        }
      }

      // Refresh health score with time decay since last use.
      const decayedHealth = this.healthMonitor.decay(
        picked.healthScore,
        Math.max(0, now - picked.lastUsedAt),
      );
      this.registry.patch(picked.id, {
        inFlight: picked.inFlight + 1,
        healthScore: decayedHealth,
      });

      // Emit rotation event when we switch from a previously-tried key.
      if (previousKeyId && previousKeyId !== picked.id) {
        this.telemetry.emit({
          type: 'key.rotated',
          from: previousKeyId,
          to: picked.id,
          reason: lastError?.message ?? 'failover',
          timestamp: now,
        });
      }
      this.telemetry.emit({
        type: 'request.start',
        keyId: picked.id,
        path,
        timestamp: now,
      });

      const startedAt = now;
      try {
        const result = await this.invoke(picked.id, path, args);
        const elapsedMs = Date.now() - startedAt;
        this.onSuccess(picked.id);
        this.telemetry.emit({
          type: 'request.success',
          keyId: picked.id,
          path,
          elapsedMs,
          timestamp: Date.now(),
        });
        return result;
      } catch (err) {
        const elapsedMs = Date.now() - startedAt;
        const detected = this.adapter.detectError(err);
        const isTransient =
          detected.isTransient ||
          (detected.status !== undefined && this.failoverCodes.has(detected.status));

        this.onFailure(picked.id, detected.status, detected.retryAfterMs);
        this.totalFailures += 1;
        this.telemetry.emit({
          type: 'request.fail',
          keyId: picked.id,
          path,
          status: detected.status,
          error: detected.message,
          elapsedMs,
          timestamp: Date.now(),
        });
        lastError = err instanceof Error ? err : new Error(String(err));
        previousKeyId = picked.id;

        if (!isTransient) {
          throw err;
        }

        const delay = retryCtx.nextDelay(detected.retryAfterMs);
        if (delay === null) {
          throw new AllKeysExhaustedError('Retry attempts exhausted', {
            attempts: retryCtx.retryCount + 1,
            poolSize: this.registry.size,
            lastError,
          });
        }
        if (delay > 0) await RetryContext.sleep(delay);
        // Loop continues with the next key.
      }
    }
  }

  /**
   * Resolve `path` against the pre-built client for the given key and
   * invoke the leaf method with `args`. Preserves `this` by calling
   * `.apply(parent, args)` so methods that read sibling properties on
   * their containing object continue to work.
   */
  private async invoke(keyId: string, path: string[], args: unknown[]): Promise<unknown> {
    const client = this.clients.get(keyId);
    if (!client) {
      throw new KeymeshError(`keymesh: no client instance for key ${keyId}`);
    }
    let target: unknown = client;
    let parent: unknown = null;
    for (const segment of path) {
      if (target === null || target === undefined) {
        throw new KeymeshError(
          `keymesh: path ${path.join('.')} resolves to null/undefined on adapter ${this.adapter.name}`,
        );
      }
      parent = target;
      target = (target as Record<string, unknown>)[segment];
    }
    if (typeof target !== 'function') {
      throw new KeymeshError(
        `keymesh: path ${path.join('.')} on adapter ${this.adapter.name} is not a function`,
      );
    }
    return await (target as (...a: unknown[]) => unknown).apply(parent, args);
  }

  private onSuccess(keyId: string): void {
    const current = this.registry.get(keyId);
    if (!current) return;
    const decision = this.circuitBreaker.onSuccess(current, Date.now());
    const wasNonClosed = current.circuitState === 'open' || current.circuitState === 'half-open';
    this.registry.patch(keyId, {
      circuitState: decision.state,
      cooldownUntil: decision.cooldownUntil,
      consecutiveFailures: 0,
      successCount: current.successCount + 1,
      inFlight: current.inFlight - 1,
      lastUsedAt: Date.now(),
      healthScore: this.healthMonitor.applySuccess(current),
    });
    if (wasNonClosed) {
      this.telemetry.emit({ type: 'circuit.closed', keyId, timestamp: Date.now() });
    }
    this.persist(keyId);
  }

  private onFailure(
    keyId: string,
    status: number | undefined,
    retryAfterMs: number | undefined,
  ): void {
    const current = this.registry.get(keyId);
    if (!current) return;
    const now = Date.now();
    const decision = this.circuitBreaker.onFailure(current, now, retryAfterMs);
    const isHardAuth = status === 401 || status === 403;
    this.registry.patch(keyId, {
      circuitState: decision.state,
      cooldownUntil: decision.cooldownUntil,
      consecutiveFailures: current.consecutiveFailures + 1,
      failureCount: current.failureCount + 1,
      inFlight: current.inFlight - 1,
      lastUsedAt: now,
      healthScore: this.healthMonitor.applyFailure(current, isHardAuth ? 'hard' : 'soft'),
    });
    if (decision.state === 'open' && current.circuitState !== 'open') {
      this.telemetry.emit({
        type: 'circuit.open',
        keyId,
        consecutiveFailures: current.consecutiveFailures + 1,
        cooldownUntil: decision.cooldownUntil,
        timestamp: now,
      });
    }
    // A confirmed-bad credential (401) earns a 24-hour cooldown so it is
    // skipped automatically for the rest of the day.
    if (status === 401) {
      this.registry.patch(keyId, { cooldownUntil: now + AUTH_FAILURE_COOLDOWN_MS });
    }
    this.persist(keyId);
  }

  private persist(keyId: string): void {
    const state = this.registry.get(keyId);
    if (!state) return;
    void this.state.save(keyId, state).catch(() => {
      // Persistence errors are non-fatal by design; in-memory state survives.
    });
  }
}

function resolveStrategy(input: StrategyName | SelectorStrategy | undefined): SelectorStrategy {
  if (!input) return new RoundRobinStrategy();
  if (typeof input === 'string') {
    switch (input) {
      case 'round-robin':
        return new RoundRobinStrategy();
      case 'weighted':
        return new WeightedStrategy();
      case 'least-used':
        return new LeastUsedStrategy();
      case 'sequential-then-rotate':
        return new SequentialThenRotateStrategy();
      default:
        throw new ConfigurationError(`Unknown strategy: ${input}`);
    }
  }
  return input;
}

function resolveBackend(input: KeymeshConfig['state'], filePath: string | undefined): StateBackend {
  if (!input || input === 'memory') return new MemoryBackend();
  if (input === 'file') return new FileBackend(filePath ?? '.keymesh-state.jsonl');
  return input;
}

/**
 * Deep Proxy that intercepts property access on the wrapped SDK client.
 * Function calls at any depth are routed through `orchestrator.execute`,
 * which picks a key, navigates the same path on that key's client, and
 * applies the call. Top-level `on/off/inspect/close` shortcut to the
 * extras surface so consumers can subscribe to telemetry without
 * threading an extra object.
 */
function deepWrap(
  target: object,
  orchestrator: Orchestrator<object, unknown>,
  path: string[],
): object {
  return new Proxy(target, {
    get(t, prop, receiver) {
      if (path.length === 0 && typeof prop === 'string') {
        const extras = orchestrator.extras();
        if (prop === 'on') return extras.on.bind(extras);
        if (prop === 'off') return extras.off.bind(extras);
        if (prop === 'inspect') return extras.inspect.bind(extras);
        if (prop === 'close') return extras.close.bind(extras);
      }
      if (typeof prop !== 'string') {
        return Reflect.get(t, prop, receiver);
      }
      const value = Reflect.get(t, prop, receiver);
      const nextPath = [...path, prop];
      if (typeof value === 'function') {
        return (...args: unknown[]) => orchestrator.execute(nextPath, args);
      }
      if (typeof value === 'object' && value !== null) {
        return deepWrap(value as object, orchestrator, nextPath);
      }
      return value;
    },
  });
}
