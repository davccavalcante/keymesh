# Security Policy

`@takk/keymesh` is a stable (1.0.0) library for API key rotation, failover,
and rate-limit recovery. We take security reports seriously and aim to
acknowledge each one within two business days.

## Supported versions

Each published version follows strict SemVer (see [`SPEC.md`](./SPEC.md) §5 and
[`.github/RELEASING.md`](./.github/RELEASING.md)). Only the latest minor of the
current major receives security patches; an older major receives critical-CVE
fixes for 6 months after the next major lands.

| Package | Supported |
|---|---|
| `@takk/keymesh` | current `latest` dist-tag |

## Reporting a vulnerability

**Please do not file public GitHub issues for security problems.** Send reports
to **davccavalcante@proton.me** (preferred) or **say@takk.ag** (Takk relay),
with the subject line beginning `[SECURITY]`.

Include, at minimum:

- Affected version (`npm ls @takk/keymesh`).
- Reproduction steps or a minimal proof-of-concept.
- Impact assessment (what an attacker can achieve).
- Any suggested mitigation.

If your report involves a vulnerability in a third-party peer dependency, please
also link the upstream advisory (CVE, GHSA, etc.) so we can coordinate the
disclosure.

PGP / signed reports are welcome but not required. If you need an out-of-band
channel, ask in the first message and we will propose one.

## Response process

1. Acknowledgement within **2 business days**.
2. Triage and severity assignment within **7 days**.
3. Fix targeted for the next release; critical issues ship as an out-of-band
   patch on the affected minor.
4. Coordinated disclosure: the reporter is credited in the changelog and
   advisory unless they request anonymity.

## Threat model in scope

Findings in any of the following are in scope:

- **Credential handling.** Any path that leaks a raw API key into a telemetry
  event, a `client.inspect()` snapshot, a thrown error message, or a log line.
  (By design, keys are identified only by their 8-char SHA-256 `id` in those
  surfaces.)
- **State persistence.** Path traversal in the `FileBackend` write path; any
  way to make keymesh write outside the configured `stateFile`. The `file`
  backend persists only the hashed `id` plus operational counters — never the
  raw key value (see [`PRIVACY.md`](./PRIVACY.md) §2.3). Any path that causes a
  raw key to reach the state file is therefore in scope and treated as a
  vulnerability.
- **Failover / circuit logic.** Any way to defeat the per-key circuit breaker
  or the retry budget so that a single failing key can cause unbounded retries,
  a cost spike, or a denial of service against the caller.
- **Auth-failure handling.** Any way to bypass the 24-hour cooldown applied to
  a key that returned `401`, or to flip a cooled-down key back into the eligible
  set without the cooldown elapsing.
- **HTTP adapter.** Header or URL injection through the `authHeader` / `baseUrl`
  configuration that lets an attacker redirect requests or smuggle headers.
- **Supply chain.** Tarball contamination, compromised npm scope, or a published
  artifact whose provenance attestation does not match the source commit.

## Out of scope

- The security of the upstream provider APIs themselves (OpenAI, Anthropic,
  Google, or any HTTP endpoint you configure) and the quality or safety of
  their responses.
- The custody of your API keys before they reach keymesh (your environment, your
  secret manager) — that is the operator's responsibility.
- Denial of service via unbounded inputs against your own application; request
  sizing and upstream rate limiting remain the operator's responsibility.
- Theoretical attacks against the cryptographic primitives used for key
  identification (SHA-256) — report those upstream.

## Supply-chain assurances

- **Zero required runtime dependencies.** The attack surface from transitive
  dependencies is eliminated for the core and the HTTP adapter. Provider SDKs
  are optional peer dependencies you install explicitly.
- **Provenance.** Every release is published with `npm publish --provenance`
  (SLSA attestation by GitHub Actions). Verify with
  `npm view @takk/keymesh@<version> --json | jq .dist.attestations`.
- **Lockfile committed.** `pnpm-lock.yaml` is tracked in git for reproducible
  installs.
