import type { KeyState } from '../types.js';
import type { StateBackend } from './types.js';

/**
 * In-process, non-persistent state backend. The default.
 *
 * Holds key states in a single {@link Map} for the lifetime of the
 * orchestrator. Discarded on restart. Choose this for single-process
 * applications, ephemeral workers, or unit tests. For multi-process
 * coordination use {@link FileBackend} (1.0) or a Redis/SQLite/Postgres
 * backend (1.1).
 */
export class MemoryBackend implements StateBackend {
  readonly name = 'memory';
  private store = new Map<string, Partial<KeyState>>();

  async load(keyId: string): Promise<Partial<KeyState> | null> {
    return this.store.get(keyId) ?? null;
  }

  async save(keyId: string, state: KeyState): Promise<void> {
    this.store.set(keyId, { ...state });
  }

  async loadAll(): Promise<Map<string, Partial<KeyState>>> {
    return new Map(this.store);
  }
}
