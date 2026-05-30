# Changelog

All notable changes to `@takk/keymesh` are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Every entry carries a UTC timestamp.

## [1.0.0] - 2026-05-28T17:19:43Z

Initial stable release. Universal, zero-runtime-dependency NPM library and CLI for intelligent API key rotation, failover, load balancing, circuit breaking, and rate-limit recovery.

### Added

#### Core orchestrator

- `createKeymesh(config)` factory returning a deep Proxy that mirrors the wrapped SDK shape plus the `KeymeshExtras` surface (`on`, `off`, `inspect`, `close`).
- `KeyRegistry` with stable SHA-256-derived IDs, insertion-order preservation, duplicate-value collapse, and clamped state updates (`healthScore` in `[0, 100]`, `inFlight >= 0`).
- `CircuitBreaker` with `closed -> open -> half-open -> closed` state machine. Honors `Retry-After` header as cooldown override.
- `Retrier` implementing the AWS full-jitter backoff (`delay = random_between(0, min(maxMs, baseMs * 2 ** attempt))`) bounded by both attempt count and total time budget.
- `HealthMonitor` with first-order exponential decay regenerating health toward 100 with a configurable half-life (default 5 minutes). Hard auth failures (401/403) penalize 25 points; soft failures penalize 10.
- `Telemetry` event emitter runtime-agnostic (no `node:events` dep). Eight event types: `request.start`, `request.success`, `request.fail`, `key.rotated`, `circuit.open`, `circuit.closed`, `circuit.half-open`, `all.exhausted`.
- 24-hour auto-cooldown for keys returning `401 Unauthorized`.

#### Selection strategies

- `round-robin` (default): cyclic across eligible keys.
- `weighted`: random pick proportional to declared `weight` (default 1, negative weights clamped to 0).
- `least-used`: lowest in-flight count, tie-broken by total usage then oldest `lastUsedAt`.
- `sequential-then-rotate`: registration-order preference, falls through on failure.
- Custom strategies plug into the `SelectorStrategy` interface.

#### Adapters (subpath exports)

- `@takk/keymesh/openai` - drop-in for `openai` SDK (peer dep).
- `@takk/keymesh/anthropic` - drop-in for `@anthropic-ai/sdk` (peer dep). Treats Anthropic-specific `529 Overloaded` as transient.
- `@takk/keymesh/gemini` - drop-in for `@google/genai` (peer dep). Reads status from both top-level and `err.response.status`.
- `@takk/keymesh/http` - generic REST adapter with `get`/`post`/`put`/`patch`/`delete`/`request` ergonomic methods, AbortController-based timeout, and `HttpResponseError` carrying status/headers/bodyText.
- All four adapters share `parseRetryAfter` and `extractRetryAfterMs` helpers in `src/adapters/_shared.ts` (internal, not exported via package surface).

#### State backends

- `MemoryBackend` (default): in-process `Map`, zero overhead.
- `FileBackend`: append-only JSONL with corrupted-line tolerance and bounded compaction at 10x the unique-key count (floor 100 lines).

#### CLI

- Binary `keymesh` exposed via `package.json#bin`.
- `keymesh start --port <n> --adapter <openai|anthropic|gemini|http> --keys-env <ENV> --strategy <name>` boots a local HTTP proxy with the chosen adapter preset (or `--base-url`/`--auth-header` for `http`).
- `keymesh inspect --state-file <path>` prints persisted state.
- `keymesh help` and `keymesh version`.
- Live pool snapshot via `GET /__keymesh_inspect`.
- Pure helpers `parseArgs` and `defaultKeysEnv` extracted to `src/cli/args.ts` for unit testability.

#### Failover defaults

- Automatic rotation/retry on HTTP `408`, `425`, `429`, `500`, `502`, `503`, `504`, plus adapter-specific extras (`529` for Anthropic).
- Network-error pattern detection for `ECONNRESET`, `ETIMEDOUT`, `ECONNREFUSED`, `EAI_AGAIN`, `fetch failed`, and abort/timeout messages on the HTTP adapter.
- `Retry-After` (numeric seconds or HTTP-date) parsed via shared helper.
- `AllKeysExhaustedError`, `TotalBudgetExceededError`, `CircuitOpenError`, `RateLimitedError`, `ConfigurationError` all extend `KeymeshError` and carry native `Error.cause` chain when applicable.

#### Distribution

- Dual ESM + CJS bundles built with tsup 8, target `node20`.
- Separate `.d.ts` and `.d.cts` type files per entrypoint.
- `exports` map with split `import`/`require` conditions per subpath.
- Zero required runtime dependencies. All SDKs are optional peer dependencies.

### Quality

- 133 tests across 20 suites passing under Vitest 4 + Vite 8.
- Coverage: lines 91.02%, statements 89.88%, functions 87.12%, branches 78.76%.
- Lint clean under Biome 2.4.16.
- Typecheck clean under TypeScript 6.0.3 (with `ignoreDeprecations: "6.0"` for the legacy `baseUrl` injected by tsup's dts pipeline).
- `publint` clean.
- Functional CLI smoke test that spawns the built binary against a fake upstream and validates rotation end-to-end.

### Security

- Package is published with `--provenance` (SLSA attestation by GitHub Actions when released via `.github/workflows/publish.yml`). Consumers can verify via `npm view @takk/keymesh --json | jq .dist.attestations`.
- Hard auth failures (401) auto-cool affected keys for 24 hours to limit damage from credential leaks/revocations.

### Licensing

- Licensed under the Apache License, Version 2.0. `NOTICE` file ships in the tarball alongside `LICENSE`.

### Engines

- Node `>=20.0.0`. Tested on Node 20 and 22.

## [Unreleased]

See [TASK.md](./TASK.md) for the live roadmap. Highlights queued for 1.1:

- `cost-aware` selector strategy.
- `redis`, `sqlite`, and `postgres` state backends.
- Additional adapters: Cohere, Mistral, Groq, DeepSeek.
- Native MCP server exposure.
- Streaming wrappers for SDK streaming/pagination paths.
