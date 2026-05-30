import type { KeyState } from '../types.js';

/**
 * State backend interface. Allows persistence of per-key state across processes
 * or restarts. The default 'memory' backend is in-process only.
 *
 * Implementations should be idempotent and tolerant to concurrent writes.
 */
export interface StateBackend {
  readonly name: string;
  /** Load state for a specific key, or null if not stored. */
  load(keyId: string): Promise<Partial<KeyState> | null>;
  /** Persist state for a specific key. */
  save(keyId: string, state: KeyState): Promise<void>;
  /** Load all persisted states. */
  loadAll(): Promise<Map<string, Partial<KeyState>>>;
  /** Optional teardown (flush, close handles). */
  close?(): Promise<void>;
}
