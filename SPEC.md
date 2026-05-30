# @takk/keymesh - Technical Specification

**Version:** 1.0.0
**Status:** Stable
**License:** Apache-2.0

This document is the binding contract between `@takk/keymesh` and its consumers. Behavior described here is covered by SemVer: breaking changes require a major version bump and a deprecation cycle (see [SEMVER POLICY](#semver-policy)).

---

## 1. Purpose

`keymesh` is a universal, zero-runtime-dependency library and CLI that sits between a TypeScript/JavaScript application and any external HTTP API, transparently:

- **Rotating** a pool of API keys to spread load and avoid rate limits.
- **Failing over** to the next key on transient failure (rate limits, 5xx, network errors).
- **Circuit-breaking** repeatedly failing keys with a cooldown window.
- **Retrying** with bounded full-jitter exponential backoff.
- **Surfacing** lifecycle events for observability.

It is library-shaped, not service-shaped. There is no central server, no SaaS dependency, no SDK lock-in.

---

## 2. Public surface

### 2.1 Entry points

The package ships five subpath exports, each with separate `import` (ESM) and `require` (CJS) conditions and matching `.d.ts` / `.d.cts` files:

| Subpath | Default | Use |
|---|---|---|
| `.` | `./dist/index.{js,cjs}` | Core: `createKeymesh`, errors, strategies, backends, types |
| `./openai` | `./dist/adapters/openai.{js,cjs}` | OpenAI SDK adapter |
| `./anthropic` | `./dist/adapters/anthropic.{js,cjs}` | Anthropic SDK adapter |
| `./gemini` | `./dist/adapters/gemini.{js,cjs}` | Google GenAI SDK adapter |
| `./http` | `./dist/adapters/http.{js,cjs}` | Generic REST adapter |
| `./package.json` | `./package.json` | Manifest access for tooling |

A `keymesh` binary is exposed via `package.json#bin -> ./dist/cli/index.js`.

### 2.2 Core API

#### `createKeymesh<TClient extends object, TOptions = unknown>(config: KeymeshConfig<TClient, TOptions>): TClient & KeymeshExtras`

Returns a Proxy wrapping the first pre-built SDK client. Method calls at any depth are intercepted and routed through the orchestrator (key pick + retry + rotate + circuit). Top-level access to `on`/`off`/`inspect`/`close` shortcuts to the `KeymeshExtras` surface.

#### `KeymeshConfig<TClient, TOptions>`

```ts
interface KeymeshConfig<TClient = unknown, TOptions = unknown> {
  provider: ProviderAdapter<TClient, TOptions>;
  keys: Array<string | KeyConfig>;
  strategy?: StrategyName | SelectorStrategy;
  state?: BackendName | StateBackend;
  stateFile?: string;
  circuitBreaker?: Partial<CircuitBreakerConfig>;
  retry?: Partial<RetryConfig>;
  health?: Partial<HealthMonitorConfig>;
  telemetry?: Partial<TelemetryConfig>;
  failoverStatusCodes?: number[];
  providerOptions?: TOptions;
}
```

#### `KeymeshExtras`

```ts
interface KeymeshExtras {
  on<T extends TelemetryEventName>(event: T, handler: EventHandler<T>): void;
  off<T extends TelemetryEventName>(event: T, handler: EventHandler<T>): void;
  inspect(): PoolSnapshot;
  close(): Promise<void>;
}
```

### 2.3 Error hierarchy

```
Error
 └─ KeymeshError
     ├─ ConfigurationError       (synchronous, invalid input at createKeymesh)
     ├─ AllKeysExhaustedError    (pool exhausted: every eligible key failed transiently or budget exceeded)
     ├─ CircuitOpenError         (request dispatched against an open-circuit key; rare in normal use)
     ├─ RateLimitedError         (upstream 429 with no remaining retry budget)
     └─ TotalBudgetExceededError (retry wall-clock budget exhausted)
```

All carry native `Error.cause`. `AllKeysExhaustedError` additionally exposes `attempts`, `poolSize`, `lastError`.

### 2.4 Telemetry events

| Event | Payload |
|---|---|
| `request.start` | `{ keyId, path: string[], timestamp }` |
| `request.success` | `{ keyId, path, elapsedMs, timestamp }` |
| `request.fail` | `{ keyId, path, status?, error, elapsedMs, timestamp }` |
| `key.rotated` | `{ from, to, reason, timestamp }` |
| `circuit.open` | `{ keyId, consecutiveFailures, cooldownUntil, timestamp }` |
| `circuit.closed` | `{ keyId, timestamp }` |
| `circuit.half-open` | `{ keyId, timestamp }` |
| `all.exhausted` | `{ reason, timestamp }` |

A handler that throws is caught and ignored; misbehaving subscribers cannot crash the orchestrator.

---

## 3. Architecture

```
+-----------------------------------------+
| Caller code                             |
| const client = createKeymesh({...})     |
| await client.chat.completions.create()  |
+-------------------+---------------------+
                    | Proxy intercept
                    v
+-----------------------------------------+
| Orchestrator                            |
| - KeyRegistry  (pool state)             |
| - SelectorStrategy (pick)               |
| - CircuitBreaker (open/half/closed)     |
| - Retrier (full-jitter backoff)         |
| - HealthMonitor (decay)                 |
| - Telemetry (event emitter)             |
| - StateBackend (persist)                |
+-------------------+---------------------+
                    | per-key pre-built client
                    v
+-----------------------------------------+
| ProviderAdapter                         |
| (openai | anthropic | gemini | http)    |
+-------------------+---------------------+
                    | HTTP
                    v
              Upstream API
```

### 3.1 Selector strategies

- `round-robin`: cyclic across eligible keys.
- `weighted`: random pick proportional to `KeyConfig.weight` (default `1`; negative weights clamp to `0`; all-zero falls back to first eligible).
- `least-used`: lowest `inFlight`, tie-broken by `successCount + failureCount`, then oldest `lastUsedAt`.
- `sequential-then-rotate`: preserve registration order; first eligible wins.

### 3.2 State backends

- `MemoryBackend`: in-process `Map`, default, ephemeral.
- `FileBackend`: append-only JSONL with corrupted-line tolerance and bounded compaction at `max(10 * uniqueKeyCount, 100)` lines. Writes serialized through a single in-process promise queue (does NOT serialize across processes).

A consumer-supplied `StateBackend` must implement `load`, `save`, `loadAll`, and optionally `close`.

### 3.3 Circuit breaker

State machine: `closed -> open` after `threshold` consecutive failures (default `3`); `open -> half-open` once `cooldownMs` (default `30_000`) has elapsed at the next pick; `half-open -> closed` on the first success; `half-open -> open` on any failure. The orchestrator filters out keys whose `cooldownUntil > now` from the eligible set, so an `open` key is automatically skipped during its cooldown window.

### 3.4 Retry policy

AWS full-jitter backoff:
```
delay = random_between(0, min(maxMs, baseMs * 2 ** attempt))
```

Bounded by both `max` (default `5` retries) and `totalBudgetMs` (default `60_000`). If the upstream provides `Retry-After`, that value is used verbatim, capped at `maxMs`, instead of computing exponential backoff.

### 3.5 Failover trigger set

Default `failoverStatusCodes`: `[408, 425, 429, 500, 502, 503, 504]`. The Anthropic adapter also treats `529 Overloaded` as transient. The HTTP adapter additionally treats network-error patterns (`ECONNRESET`, `ETIMEDOUT`, `ECONNREFUSED`, `EAI_AGAIN`, `fetch failed`, abort/timeout) as transient.

### 3.6 Auth-failure handling

A response with status `401` triggers a 24-hour cooldown on the key, on the assumption that the credential itself is invalid and should be skipped until the operator rotates it. Status `403` is treated as a hard failure for health-scoring purposes (`-25` instead of `-10`) but does not auto-cool.

---

## 4. Operational SLOs

The library is small; targets here are runtime characteristics, not service SLOs.

| Target | Budget |
|---|---|
| Runtime dependencies (required) | 0 |
| Runtime dependencies (optional peer deps, per adapter) | 1 |
| ESM core bundle (`dist/index.js`) | <= 32 KB unminified |
| CJS core bundle (`dist/index.cjs`) | <= 32 KB unminified |
| Per-request orchestrator overhead (no retry path) | < 1 ms on M-series Mac |
| Per-failure rotation overhead (excluding upstream latency) | < 5 ms |
| Tarball size (full package) | <= 200 KB |
| Engines | Node >= 20.0.0 |

These are not enforced by CI gates today; they are the design intent and the basis for evaluating regressions.

---

## 5. Stability promise

### 5.1 What counts as the public API

For 1.0.0 onward:

- Every name exported from `./dist/index.{js,cjs,d.ts}` and from each subpath export.
- Every type, interface, class shape, function signature, and discriminated-union variant reachable from those exports.
- The shape of `KeymeshConfig`, `KeyConfig`, `KeyState`, `PoolSnapshot`, and every event payload.
- The CLI flags and subcommands of `keymesh`.
- The on-disk JSONL schema of the `FileBackend`.

Not part of the public API:

- Anything inside `src/` that is not re-exported from `src/index.ts` or an adapter entrypoint.
- Files whose name starts with `_` (e.g. `src/adapters/_shared.ts`).
- The format of debug log lines.
- The internal layout of the orchestrator's intermediate state.

### 5.2 SemVer policy

| Change | Bump |
|---|---|
| Bug fix, internal refactor, doc-only | patch (`1.0.0 -> 1.0.1`) |
| New export, new optional field, new event kind | minor (`1.0.0 -> 1.1.0`) |
| Renaming/removing an export, signature change, on-disk schema change, CLI flag removal | major (`1.0.0 -> 2.0.0`) |

### 5.3 Deprecation policy

Breaking a public API requires:

1. **Announce** the deprecation in a minor release of the current major: add `@deprecated` JSDoc on the export and a runtime `console.warn` (debounced once per process).
2. **Ship** the deprecated API for at least one further minor of the same major. Consumers must always have a non-deprecated path.
3. **Remove** only in the next major release, accompanied by a `MIGRATING.md` with a migration recipe.

Security-driven exceptions (e.g. removing a function that bypasses a safety check) ship in the next patch across all supported majors with a `### Security` CHANGELOG entry.

### 5.4 License and provenance invariants

- License stays Apache-2.0 within a major.
- `NOTICE` is preserved verbatim in the tarball.
- Every release is published with `--provenance` (SLSA attestation by GitHub Actions). Consumers can verify via `npm view @takk/keymesh@<version> --json | jq .dist.attestations`.

---

## 6. Runtime expectations

- `keymesh` is a library; it does not call out to any service at import time.
- The orchestrator hydrates state from the configured backend asynchronously after construction (`void this.hydrateFromBackend()`). Synchronous calls before hydration completes operate on the in-memory defaults.
- Persistence (`StateBackend.save`) is fire-and-forget by design; persistence errors are non-fatal and never propagate to the caller. In-memory state remains authoritative for the lifetime of the orchestrator.
- All telemetry handlers are invoked synchronously inside `emit()`. Throwing in a handler is caught and ignored.

---

## 7. Test surface

- Unit tests for every selector strategy, state backend, core component, and adapter (error detection only; SDK construction is exercised at import time and by the smoke test).
- Integration tests for end-to-end failover, retry-after honoring, and pool exhaustion.
- Functional smoke test that spawns the built CLI binary against a fake upstream and asserts round-robin rotation and the `/__keymesh_inspect` endpoint.

Coverage thresholds enforced via `vitest.config.ts`: `lines >= 80`, `functions >= 80`, `branches >= 75`, `statements >= 80`. Current run (1.0.0): `lines 91.02%, statements 89.88%, functions 87.12%, branches 78.76%`.

---

## 8. Non-goals (in 1.0)

- Streaming/pagination wrappers for SDK methods that return iterators (use the underlying SDK directly; planned for 1.1).
- `cost-aware` selector strategy (requires per-key tier model; planned for 1.1).
- Distributed state (Redis/SQLite/Postgres backends planned for 1.1).
- A hosted observability dashboard (separate product, `keymesh.cloud`).
- MCP server exposure (planned for a later release as part of MCP ecosystem alignment).

See [TASK.md](./TASK.md) for the live deferred-work list.
