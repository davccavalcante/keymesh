import { createHash } from 'node:crypto';
import { ConfigurationError } from '../errors.js';
import type { KeyConfig, KeyState } from '../types.js';

/**
 * Owns the canonical pool of {@link KeyState}. All other components mutate
 * it via {@link patch}, which preserves invariants (clamping `healthScore`
 * to `[0, 100]`, flooring `inFlight` at 0). Insertion order is preserved
 * via {@link order} for strategies that depend on it
 * (e.g. `sequential-then-rotate`).
 *
 * Identity: each key is hashed with SHA-256 and the first 8 hex chars are
 * used as the stable id. Duplicate values collapse to a single state entry
 * silently.
 */
export class KeyRegistry {
  private readonly states = new Map<string, KeyState>();
  /** Order of insertion, used by sequential-then-rotate. */
  readonly order: string[] = [];

  constructor(rawKeys: Array<string | KeyConfig>) {
    if (rawKeys.length === 0) {
      throw new ConfigurationError('keymesh requires at least one key. Got an empty array.');
    }
    const seen = new Set<string>();
    for (const raw of rawKeys) {
      const config: KeyConfig = typeof raw === 'string' ? { value: raw } : { ...raw };
      if (!config.value || typeof config.value !== 'string') {
        throw new ConfigurationError(
          'Invalid key: every key must have a non-empty string `value`.',
        );
      }
      const id = hashKey(config.value);
      if (seen.has(id)) {
        // Duplicate value: silently collapse to a single state entry.
        continue;
      }
      seen.add(id);
      const label = config.label ?? `key-${id}`;
      const state: KeyState = {
        config: { ...config, label },
        id,
        lastUsedAt: 0,
        successCount: 0,
        failureCount: 0,
        inFlight: 0,
        healthScore: 100,
        circuitState: 'closed',
        cooldownUntil: 0,
        consecutiveFailures: 0,
      };
      this.states.set(id, state);
      this.order.push(id);
    }
    if (this.states.size === 0) {
      throw new ConfigurationError('After deduplication, no valid keys remain in the pool.');
    }
  }

  /** Number of unique keys in the pool. */
  get size(): number {
    return this.states.size;
  }

  /** Return every key state in registration order. */
  all(): KeyState[] {
    return this.order
      .map((id) => this.states.get(id))
      .filter((s): s is KeyState => s !== undefined);
  }

  /** Look up a single key state by id. */
  get(keyId: string): KeyState | undefined {
    return this.states.get(keyId);
  }

  /**
   * Return the subset of keys currently eligible to serve a request:
   * cooldown elapsed (`cooldownUntil <= now`). A key in the `open` circuit
   * state is filtered out by the cooldown check until its window expires;
   * the orchestrator then transitions it to `half-open` at pick time via
   * {@link CircuitBreaker.transitionOnPick}.
   */
  eligible(now: number): KeyState[] {
    const out: KeyState[] = [];
    for (const id of this.order) {
      const s = this.states.get(id);
      if (!s) continue;
      if (s.cooldownUntil > now) continue;
      out.push(s);
    }
    return out;
  }

  /**
   * Apply a partial state update. Clamps `healthScore` to `[0, 100]` and
   * floors `inFlight` at 0 so callers can pass arithmetic results without
   * worrying about negative drift.
   */
  patch(keyId: string, update: Partial<KeyState>): KeyState | null {
    const current = this.states.get(keyId);
    if (!current) return null;
    const next: KeyState = { ...current, ...update };
    next.inFlight = Math.max(0, next.inFlight);
    next.healthScore = clamp(next.healthScore, 0, 100);
    this.states.set(keyId, next);
    return next;
  }
}

function hashKey(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 8);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
