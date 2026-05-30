# Keymesh NPM

[![status: stable](https://img.shields.io/badge/status-stable-brightgreen)](./CHANGELOG.md)
[![license](https://img.shields.io/badge/license-Apache_2.0-blue.svg)](./LICENSE)
[![version](https://img.shields.io/badge/version-1.0.0-blue)](./CHANGELOG.md)
[![node](https://img.shields.io/badge/node-%E2%89%A520-success)]()
[![tests](https://img.shields.io/badge/tests-143%20passing-brightgreen)]()
[![coverage](https://img.shields.io/badge/coverage-93%25-brightgreen)]()
[![runtime deps](https://img.shields.io/badge/runtime%20deps-0-success)]()

![Keymesh](https://raw.githubusercontent.com/davccavalcante/keymesh/main/assets/keymesh.png)

[![Star History Chart](https://api.star-history.com/svg?repos=davccavalcante/keymesh&type=timeline&legend=top-left)](https://www.star-history.com/#davccavalcante/keymesh&type=timeline&legend=top-left)

> Universal, zero-runtime-dependency NPM library and CLI for intelligent API key rotation, failover, load balancing, circuit breaking, and rate-limit recovery.

`keymesh` lives between your application and any external HTTP API. You declare a pool of credentials; it picks the next key for each request, retries on transient failure, opens a per-key circuit on repeated failure, rotates around exhausted keys, and surfaces telemetry. Drop-in wrappers for OpenAI, Anthropic, and Gemini SDKs. A generic adapter for any REST endpoint. A CLI proxy mode when you don't want to embed.

**Core promise:** zero required runtime dependencies, single-function setup, ergonomic TypeScript types, ESM + CJS dual distribution, SLSA provenance on every release.

---

## Install

```bash
pnpm add @takk/keymesh
# or: npm install @takk/keymesh
# or: yarn add @takk/keymesh
# or: bun add @takk/keymesh
```

Adapters use peer dependencies. Install the SDK you actually need:

```bash
pnpm add openai             # for @takk/keymesh/openai
pnpm add @anthropic-ai/sdk  # for @takk/keymesh/anthropic
pnpm add @google/genai      # for @takk/keymesh/gemini
```

The core (`@takk/keymesh`) and the `http` adapter have no runtime dependencies at all.

---

## Quickstart - OpenAI

```ts
// src/example.ts
import { createKeymesh } from '@takk/keymesh';
import { openaiAdapter } from '@takk/keymesh/openai';

const client = createKeymesh({
  provider: openaiAdapter,
  keys: process.env.OPENAI_API_KEYS?.split(',') ?? [],
  strategy: 'least-used',
  circuitBreaker: { threshold: 3, cooldownMs: 30_000 },
  retry: { max: 5, baseMs: 200, jitter: true },
  telemetry: { enabled: true },
});

const response = await client.chat.completions.create({
  model: 'gpt-4.1',
  messages: [{ role: 'user', content: 'Hello.' }],
});
```

Set `OPENAI_API_KEYS=key1,key2,key3` in your environment. `keymesh` rotates across all three transparently, opens a circuit on any key that returns repeated `429`, and retries with backoff on transient failures.

---

## Quickstart - any HTTP endpoint

```ts
// src/example-universal.ts
import { createKeymesh } from '@takk/keymesh';
import { httpAdapter } from '@takk/keymesh/http';

const tavily = createKeymesh({
  provider: httpAdapter({
    baseUrl: 'https://api.tavily.com',
    authHeader: (key) => ({ Authorization: `Bearer ${key}` }),
  }),
  keys: process.env.TAVILY_API_KEYS?.split(',') ?? [],
  strategy: 'round-robin',
});

const result = await tavily.post('/search', {
  query: 'AI infrastructure 2026',
});
```

---

## Strategies

| Name | When to use |
|---|---|
| `round-robin` | Default. Even distribution. Good baseline. |
| `weighted` | When some keys have higher quotas. Pick probability proportional to declared weight. |
| `least-used` | When keys share quota windows. Picks the key with the lowest in-flight count. |
| `sequential-then-rotate` | When you have one paid key and several free fallbacks. Exhausts the first key until it fails, then moves on. |

Custom strategies plug into the `SelectorStrategy` interface; see [src/strategies/types.ts](./src/strategies/types.ts).

`cost-aware` strategy is on the 1.1 roadmap (requires per-key cost-tier metadata; see [TASK.md](./TASK.md)).

---

## Adapters

| Adapter | Export | Use when |
|---|---|---|
| OpenAI | `@takk/keymesh/openai` | Drop-in for the official `openai` SDK |
| Anthropic | `@takk/keymesh/anthropic` | Drop-in for `@anthropic-ai/sdk` |
| Gemini | `@takk/keymesh/gemini` | Drop-in for `@google/genai` |
| HTTP | `@takk/keymesh/http` | Any REST endpoint (Tavily, Serper, GitHub API, Stripe, etc.) |

---

## CLI

`keymesh` also works as a local proxy if you don't want to embed in code:

```bash
npx @takk/keymesh start --port 8787 --adapter openai

# from another terminal:
curl http://localhost:8787/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4.1","messages":[{"role":"user","content":"Hi"}]}'
```

Inspect current pool state:

```bash
npx @takk/keymesh inspect
# Or live, while a `start` server is running:
curl http://localhost:8787/__keymesh_inspect | jq
```

See [examples/cli-proxy.md](./examples/cli-proxy.md) for full options.

---

## Failover details

`keymesh` automatically rotates the key and retries on the following responses:

- HTTP `408 Request Timeout`
- HTTP `425 Too Early`
- HTTP `429 Too Many Requests` (respects `Retry-After`, both numeric seconds and HTTP-date)
- HTTP `500`, `502`, `503`, `504`
- HTTP `529 Overloaded` (Anthropic-specific, recognized by the Anthropic adapter)
- Network errors: `ECONNRESET`, `ETIMEDOUT`, `ECONNREFUSED`, `EAI_AGAIN`, `fetch failed`, abort/timeout (HTTP adapter only)

When all keys are simultaneously cooling down or circuit-open, `keymesh` throws `AllKeysExhaustedError` with the full pool state attached. Catch it at the boundary of your app.

A key that returns `401 Unauthorized` is auto-cooled for 24 hours, on the assumption that the credential itself is invalid and should be skipped until you rotate it.

---

## Telemetry

```ts
client.on('request.start', (e) => log.info({ keyId: e.keyId, path: e.path }));
client.on('request.success', (e) => metrics.histogram('keymesh.latency', e.elapsedMs));
client.on('request.fail', (e) => log.warn({ keyId: e.keyId, status: e.status }));
client.on('key.rotated', (e) => log.info({ from: e.from, to: e.to, reason: e.reason }));
client.on('circuit.open', (e) => alerts.notify(`Key ${e.keyId} circuit OPEN`));
client.on('circuit.closed', (e) => log.info({ keyId: e.keyId }));
client.on('circuit.half-open', (e) => log.info({ keyId: e.keyId }));
client.on('all.exhausted', (e) => alerts.notify(`Pool exhausted: ${e.reason}`));
```

`keymesh` does not depend on OpenTelemetry. If you want to ship events to an OTel collector, write a small adapter in your app.

---

## Pool inspection

```ts
const snapshot = client.inspect();
// {
//   strategy: 'least-used',
//   totalRequests: 1284,
//   totalFailures: 3,
//   keys: [
//     { id: 'a1b2c3d4', label: 'key-a1b2c3d4',
//       circuitState: 'closed', healthScore: 100,
//       inFlight: 0, successCount: 642, failureCount: 1,
//       consecutiveFailures: 0, cooldownUntil: 0,
//       lastUsedAt: 1748449183210 },
//     ...
//   ]
// }
```

The `id` is the first 8 hex characters of the key's SHA-256 hash. The raw key value is never included in a snapshot or in a telemetry event.

---

## Quality

- 143 tests across 21 suites, all passing under Vitest 4.
- Coverage: lines 93%, statements 91.6%, functions 89.1%, branches 79.4%.
- Lint clean under Biome 2.
- Typecheck clean under TypeScript 6 in maximum strict mode (`exactOptionalPropertyTypes`, `useUnknownInCatchVariables`, `noUncheckedIndexedAccess`).
- `publint` clean.
- Functional CLI smoke test that spawns the built binary against a fake upstream and asserts end-to-end rotation.
- Validated live against the Gemini API: real `429` quota exhaustion triggers rotation, the per-key circuit opens after the failure threshold and recovers (`open -> half-open -> closed`) once the cooldown elapses.
- Published with `--provenance` (SLSA attestation by GitHub Actions).

See [SPEC.md](./SPEC.md) for the formal specification, public surface, and stability promise.

---

## FAQ

**Why not just use LiteLLM?**
LiteLLM is excellent but Python, gateway-style, and requires you to run a sidecar service. `keymesh` is TypeScript-native, embeddable in any Node/Bun/Deno process, and runs as either a library or a CLI.

**Why not just use a proxy gateway like Bifrost or Portkey?**
Same answer. They are services; `keymesh` is a library you `pnpm add`. No extra container, no extra hop, no SaaS lock-in. If you want a proxy, you can also run `keymesh` in CLI mode - same code path.

**Does this work in Cloudflare Workers / Vercel Edge / Bun / Deno?**
Core (`@takk/keymesh`) and the `http` adapter run on any modern JS runtime with `fetch`. The OpenAI/Anthropic/Gemini adapters depend on their respective SDKs' runtime compatibility. Edge-optimized adapters land in a later release.

**Where does the state live?**
By default, in-process memory. For multi-process coordination, use the `file` backend (in 1.0) or `redis`/`sqlite`/`postgres` (planned for 1.1). See [PRIVACY.md](./PRIVACY.md) for how the file backend handles credential material.

**Will you support `cost-aware` routing?**
Yes - planned for 1.1. It requires per-key cost-tier metadata and a small economic model; that earns its own release.

**What about streaming/pagination from the SDKs?**
Not wrapped by the rotation layer in 1.0. Use the underlying SDK directly for those, or watch for streaming support in 1.1.

---

## Contributing

See [.github/CONTRIBUTING.md](./.github/CONTRIBUTING.md) for the contributor guide. Substantive proposals open a GitHub Issue first; trivial fixes can go straight to a PR. All commits require DCO sign-off (`git commit -s`). Non-trivial contributions are governed by the [Contributor License Agreement](./CLA.md).

## Community & support

- **Issues & feature requests.** Open a GitHub issue at [`davccavalcante/keymesh/issues`](https://github.com/davccavalcante/keymesh/issues). For each report, include: the package version, a minimal reproduction, expected vs. actual behaviour, and (where relevant) the relevant telemetry events or the `client.inspect()` pool snapshot.
- **Security disclosures.** Do NOT open public issues for vulnerabilities. Follow the responsible-disclosure flow in [`SECURITY.md`](./SECURITY.md) — contact `davccavalcante@proton.me` (or `say@takk.ag`) with the `[SECURITY]` prefix.
- **Code of Conduct.** This project follows the [Contributor Covenant 2.1](./CODE_OF_CONDUCT.md). Participation in any keymesh space (issues, PRs, discussions) implies agreement.
- **Contributions.** All non-trivial contributions go through the [Contributor License Agreement](./CLA.md). Tests, lint, typecheck, and build must be green before review (`pnpm verify`).

---

## Author

Created by **David C Cavalcante** — [davccavalcante@proton.me](mailto:davccavalcante@proton.me) (preferred) · [say@takk.ag](mailto:say@takk.ag) (Takk relay) · [linkedin.com/in/hellodav](https://linkedin.com/in/hellodav) · [x.com/davccavalcante](https://x.com/davccavalcante) · [takk.ag](https://takk.ag/)

`keymesh` is the foundational layer of a broader portfolio of NPM packages targeting AI-native infrastructure for 2026-2030, built at Takk Innovate Studio.

---

## Related research by the author

The architectural philosophy behind `keymesh` — separating orchestration, state, and adapters into composable, independently-governed layers — echoes the author's research frameworks:

- **MAIC (Massive Artificial Intelligence Consciousness)** — a systemic intelligence framework designed to coordinate, supervise, and govern large-scale artificial intelligence ecosystems, providing global context awareness, alignment, and orchestration across multiple models, agents, and decision layers.
- **HIM (Hybrid Intelligence Model)** — a hybrid intelligence layer that integrates artificial intelligence systems with human-defined logic, rules, heuristics, and strategic intent, interpreting objectives and structuring decision-making before and after model execution.
- **NHE (Non-Human Entity)** — a non-human cognitive entity with a defined functional identity and operational agency within an AI ecosystem, operating through coordinated intelligence layers while maintaining a non-anthropomorphic identity.

These frameworks are published independently of `keymesh` and are separate works:

- Research papers: [The Soul of the Machine](https://philarchive.org/rec/CRTTSO) · [Beyond Consciousness in LLMs](https://philarchive.org/rec/CRTBCI) · [The Cave of Silence](https://philarchive.org/rec/CRTTCO).
- PhilPapers profile: [David Cortes Cavalcante](https://philpeople.org/profiles/david-cortes-cavalcante).
- Hugging Face: [TeleologyHI](https://huggingface.co/TeleologyHI).
- GitHub: [davccavalcante](https://github.com/davccavalcante) · [Takk8IS](https://github.com/Takk8IS).

---

## Sponsors

Join the journey as the portfolio continues to ship AI-native infrastructure. Your support is the cornerstone of this work.

- Sponsor on GitHub: [github.com/sponsors/davccavalcante](https://github.com/sponsors/davccavalcante)
- USDT (TRC-20): `TS1vuhMAhFpbd7y68cu5ZtP9PsXVmZWmeh`

---

## Privacy

`keymesh` runs entirely inside your own process and infrastructure. It makes no outbound calls to the author, collects no telemetry, and ships no analytics. The only network traffic it produces is the request you ask it to make, against the upstream you configured. See [PRIVACY.md](./PRIVACY.md) for the full data-handling notice, including how the optional `file` state backend persists pool state on disk.

---

## License

Licensed under the **Apache License 2.0**. See [LICENSE](./LICENSE) for the full text and [NOTICE](./NOTICE) for attribution and third-party component licenses. You may use, modify, and distribute the code under the terms of that license, including its patent grant and attribution requirements.
