# Contributing to @takk/keymesh

Thanks for considering a contribution. This document is the canonical guide for proposing changes to `@takk/keymesh`.

The project is open source under [Apache License 2.0](../LICENSE). The package surface and stability promise are documented in [SPEC.md](../SPEC.md); the live roadmap and deferred work are in [TASK.md](../TASK.md).

---

## 1. Code of conduct

Be respectful, be precise, and assume good faith. The maintainer reads every issue and PR personally; disrespectful, harmful, or manipulative behavior is grounds for removal from the project.

---

## 2. Contributor license

Every contribution is governed by the Apache License 2.0 (the same license the project is published under). Sign off every commit with `git commit -s` (Developer Certificate of Origin):

```bash
git commit -s -m "fix(retrier): cap retry-after at maxMs"
```

The `-s` flag appends a `Signed-off-by:` trailer that attests you have the right to submit the change under Apache 2.0. PRs without DCO sign-off are not merged.

---

## 3. Local setup

### 3.1 Prerequisites

- **Node 20 or 22.** CI runs the matrix; pick one for local dev. `.nvmrc` pins the LTS line.
- **pnpm 9 or 10.** The repo uses `pnpm` for install and scripts. `npm` and `yarn` also work but `pnpm-lock.yaml` is the source of truth.
- **git** with `git commit -s` configured (DCO).

### 3.2 Clone and install

```bash
git clone https://github.com/davccavalcante/keymesh.git
cd keymesh
pnpm install
```

### 3.3 Verify locally

```bash
pnpm verify          # lint + typecheck + test + build + publint
# or run individually:
pnpm lint
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm build
pnpm publint
```

Current baseline (verify before opening a PR): **145 tests passing across 21 suites**. Coverage `lines 93% / statements 91.6% / functions 89.1% / branches 79.4%`.

---

## 4. Branch and commit conventions

### 4.1 Branch names

- `fix/<short-slug>` - bug fixes
- `feat/<short-slug>` - new optional surface (minor bump)
- `docs/<short-slug>` - README/SPEC/CHANGELOG-only changes
- `chore/<short-slug>` - tooling, deps, CI
- `refactor/<short-slug>` - internal restructuring with no API change

Avoid PRs larger than ~500 LOC; split into smaller logically-coherent PRs.

### 4.2 Commit style

[Conventional Commits](https://www.conventionalcommits.org/) are encouraged but not enforced. What IS enforced:

- **One commit per logical change.** No `WIP` or `fixup` commits in the merged history.
- **Imperative subject up to 70 chars.** Body wrap at 72 cols.
- **DCO sign-off (`git commit -s`).**
- **No commit credits to AI assistants.** This is the Creator's discipline.

### 4.3 What requires a discussion before coding

Open a GitHub Issue first if your change touches:

- New public export (SemVer minor/major impact - see [SPEC.md §5](../SPEC.md#5-stability-promise)).
- New telemetry event kind.
- The on-disk JSONL schema of `FileBackend`.
- The CLI flags or subcommands.
- The `ProviderAdapter`, `SelectorStrategy`, or `StateBackend` interface.

For docs-only fixes, typos, or contained internal refactors, skip the issue and open a PR directly.

---

## 5. Pull request workflow

### 5.1 Before opening

- All checks green: `pnpm verify`.
- Coverage thresholds preserved or improved (see `vitest.config.ts`).
- For any change that touches the public API: `SPEC.md` and `README.md` updated.
- For any deprecated surface: `@deprecated` JSDoc + runtime `console.warn` (debounced) + a `### Deprecated` section in the next `CHANGELOG.md` entry.

### 5.2 PR description

Fill the [PULL_REQUEST_TEMPLATE.md](./PULL_REQUEST_TEMPLATE.md) honestly. Empty sections are not acceptable; write "N/A" with a one-line reason if a section truly does not apply.

### 5.3 Review

The maintainer reviews every PR personally. Expect:

- Surgical line-by-line read.
- Question on intent before merge (Creator's discipline: "if you notice any problem, error, or inconsistency, ask before acting").
- Required for governance-touching changes: explicit Creator approval before merge.

### 5.4 After merge

CI publishes nothing on merge to `main`. Publishing is a Creator-triggered flow via `git tag v<semver> && git push origin v<semver>` (see [RELEASING.md](./RELEASING.md)).

---

## 6. Tests

Add tests for any non-trivial change. Patterns:

- **Vitest** (`tests/**/*.test.ts`). One file per surface area. Deterministic seeds for randomness; mock `fetch` for HTTP paths.
- **Integration tests** live in `tests/integration/` and may spawn the built CLI binary against a fake upstream (see `tests/integration/cli-smoke.test.ts` for the canonical pattern).
- **No reliance on real provider credentials** in CI. Tests run offline.

Every fix-able bug ships with a regression test that fails pre-fix and passes post-fix.

---

## 7. Security disclosure

Do NOT open a public GitHub Issue for security vulnerabilities. Email `davccavalcante@proton.me` with the prefix `[SECURITY]` and we will coordinate fix + disclosure timeline privately.

---

## 8. Releasing

Releases are maintainer-only. The full runbook lives in [RELEASING.md](./RELEASING.md). Contributors do not tag, do not publish, do not edit historical CHANGELOG entries (those are immutable per Keep a Changelog).

When proposing a change that warrants a release, indicate in your PR description which SemVer bump you believe it triggers (patch / minor / major per [SPEC.md §5.2](../SPEC.md#52-semver-policy)). The maintainer makes the final call.

---

## 9. Communication

- **GitHub Issues** for bug reports + feature requests (see [ISSUE_TEMPLATE/](./ISSUE_TEMPLATE)).
- **GitHub Discussions** (if enabled) for design conversations.
- **Email** `davccavalcante@proton.me` for anything private, sensitive, or trademark/licence-related.

The project's primary language for code, docs, CI, issues, and PRs is **English**. Use English in PR descriptions and code comments.

---

## Contact

**David C Cavalcante**
- Email: [davccavalcante@proton.me](mailto:davccavalcante@proton.me)
- LinkedIn: [linkedin.com/in/hellodav](https://linkedin.com/in/hellodav)
- GitHub: [github.com/davccavalcante](https://github.com/davccavalcante)
- X: [x.com/davccavalcante](https://x.com/davccavalcante)
- Project site: [takk.ag](https://takk.ag)
