# Privacy Notice — keymesh

This notice describes what data `@takk/keymesh` processes when you install
and run it. `keymesh` is an npm library and CLI that runs entirely inside your
own process and infrastructure. The author (David C Cavalcante) hosts no
service, sees no traffic, and collects no telemetry.

Last updated: **2026-05-28**.

---

## 1. What keymesh is, and isn't

`keymesh` is a library you install and run in your own environment. There is
**no keymesh cloud**, no account, no sign-up. The author does not host any
endpoint that your installation talks to. The only network traffic `keymesh`
produces is the request **you** ask it to make, against the upstream API
**you** configured, using the credentials **you** supplied.

---

## 2. Data keymesh processes (in your process)

### 2.1 API keys (in memory)

You pass a pool of API keys to `createKeymesh({ keys: [...] })` (typically read
from your own environment variables). keymesh holds them in process memory for
the lifetime of the client in order to attach the correct credential to each
outbound request. Keys are **never** sent anywhere except to the upstream you
configured, and are **never** transmitted to the author.

In telemetry events and in `client.inspect()` snapshots, a key is identified
only by the first 8 hex characters of its SHA-256 hash (its `id`). The raw key
value is never included in an event or a snapshot.

### 2.2 Pool state (in memory by default)

For each key, keymesh tracks operational counters: success/failure counts,
in-flight count, health score, circuit state, cooldown timestamp, and last-used
timestamp. With the default `memory` backend this state lives only in process
memory and is discarded on exit.

### 2.3 Persisted pool state (only if you choose the `file` backend)

If you configure `state: 'file'`, keymesh writes the pool state to a JSONL file
at the path you specify (default `.keymesh-state.jsonl`).

**No credential material on disk.** The persisted record for each key contains
only the stable hashed `id` (the first 8 hex characters of the key's SHA-256
hash) and the operational counters (success/failure counts, in-flight count,
health score, circuit state, cooldown timestamp, last-used timestamp). The raw
API key value is **never** written to the state file. On reload, keymesh merges
these counters back onto the in-memory key, whose value comes from the `keys`
you passed to `createKeymesh` — not from disk.

The state file is therefore not a secret in the credential sense, but it does
reveal operational metadata (how many requests each key id served, when, and
whether it was rate-limited). Treat it according to your own threat model; a
typical project simply adds it to `.gitignore`.

### 2.4 Upstream provider traffic

When keymesh dispatches a request through an adapter (OpenAI, Anthropic,
Gemini, or the generic HTTP adapter), the request body and headers traverse
**the upstream provider's** infrastructure. keymesh never sees that traffic
except as the response it returns to you. **Each provider has its own
data-handling policy** — you must read and comply with it independently:

| Provider | Data-handling policy |
|---|---|
| OpenAI | <https://openai.com/policies> |
| Anthropic | <https://www.anthropic.com/legal> |
| Google (Gemini) | <https://ai.google.dev/terms> |
| Any HTTP endpoint | The endpoint operator's own policy |

---

## 3. Data keymesh does NOT collect

- **No telemetry to the author.** keymesh makes zero outbound network calls to
  the author's infrastructure. The telemetry surface is an in-process event
  emitter you subscribe to yourself; nothing leaves your process unless you
  wire it to leave.
- **No analytics.** No usage statistics, no error reporting, no fingerprinting.
- **No third-party SDK that phones home.** keymesh has zero required runtime
  dependencies. Adapter peer dependencies (`openai`, `@anthropic-ai/sdk`,
  `@google/genai`) are the official provider SDKs; audit them with
  `npm ls --all`.

---

## 4. GDPR + LGPD posture

`keymesh` itself processes credentials and operational counters, not end-user
personal data — the prompts and payloads you send through it are **your** data
under **your** control, and keymesh never persists them. If your application
sends personal data through an adapter, that flow is governed by your own
privacy program and the upstream provider's policy, not by keymesh.

For operators in scope of **GDPR** or **LGPD**:

- **Minimisation**: keymesh persists only key configuration and operational
  counters (only when the `file` backend is enabled). It never logs request or
  response bodies.
- **Right to erasure**: delete the state file (default `.keymesh-state.jsonl`)
  to remove all persisted keymesh state.
- **Portability**: the JSONL state layout is plain text and portable by
  construction.

---

## 5. Security disclosure

See [`SECURITY.md`](./SECURITY.md) for vulnerability reports and the threat
model. The author can be reached at **davccavalcante@proton.me** (preferred) or
**say@takk.ag** (Takk relay) with the `[SECURITY]` prefix.

---

## 6. Children

`keymesh` is developer infrastructure with no user-facing surface and no
features directed at children. It is not intended for direct use by children
under 13.

---

## 7. Changes to this notice

This file is versioned in git alongside the code. Material changes are announced
in [`CHANGELOG.md`](./CHANGELOG.md) and in the next release notes on GitHub.

---

## 8. Contact

- General (author): **davccavalcante@proton.me**
- Takk relay: **say@takk.ag**
- LinkedIn: <https://linkedin.com/in/hellodav>
- Security: **davccavalcante@proton.me** (or **say@takk.ag**) with the
  `[SECURITY]` prefix (see [`SECURITY.md`](./SECURITY.md)).
