import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import type { CircuitState, KeyState } from '../types.js';
import type { StateBackend } from './types.js';

/**
 * The subset of {@link KeyState} that the file backend writes to disk.
 *
 * It deliberately EXCLUDES `config` — the `KeyConfig` object holds the raw
 * API key value (`config.value`). Persisting only the stable hashed `id`
 * and the operational counters guarantees that credential material never
 * touches the filesystem. On reload, the orchestrator merges these counters
 * onto the in-memory `KeyState`, whose `config` already carries the key the
 * caller supplied to `createKeymesh`.
 */
interface PersistedKeyState {
  id: string;
  lastUsedAt: number;
  successCount: number;
  failureCount: number;
  inFlight: number;
  healthScore: number;
  circuitState: CircuitState;
  cooldownUntil: number;
  consecutiveFailures: number;
}

function toPersisted(keyId: string, state: Partial<KeyState>): PersistedKeyState {
  return {
    id: keyId,
    lastUsedAt: state.lastUsedAt ?? 0,
    successCount: state.successCount ?? 0,
    failureCount: state.failureCount ?? 0,
    inFlight: state.inFlight ?? 0,
    healthScore: state.healthScore ?? 100,
    circuitState: state.circuitState ?? 'closed',
    cooldownUntil: state.cooldownUntil ?? 0,
    consecutiveFailures: state.consecutiveFailures ?? 0,
  };
}

/**
 * Append-only JSONL backend. Each line is the latest persisted record for one
 * key, containing only the hashed `id` and operational counters — never the
 * raw API key value (see {@link PersistedKeyState}).
 *
 * On load, later lines override earlier ones for the same keyId.
 * On save, a new line is appended. A coarse compaction step rewrites the
 * file when the line count exceeds 10x the unique key count (floor 100),
 * keeping growth bounded under heavy update traffic without blocking the
 * write path more often than necessary.
 *
 * Writes are serialized through an internal promise queue to avoid
 * interleaving appendFile calls in the same process. This backend does
 * NOT serialize across processes; use Redis or Postgres backends (1.1)
 * for that.
 */
export class FileBackend implements StateBackend {
  readonly name = 'file';
  private writeQueue: Promise<void> = Promise.resolve();
  private lineCount = 0;
  private uniqueIds = new Set<string>();

  constructor(private readonly filePath: string) {}

  async load(keyId: string): Promise<Partial<KeyState> | null> {
    const all = await this.loadAll();
    return all.get(keyId) ?? null;
  }

  async loadAll(): Promise<Map<string, Partial<KeyState>>> {
    const out = new Map<string, Partial<KeyState>>();
    let raw: string;
    try {
      raw = await fs.readFile(this.filePath, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return out;
      throw err;
    }
    const lines = raw.split('\n').filter((l) => l.length > 0);
    this.lineCount = lines.length;
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as { id?: unknown } & Partial<KeyState>;
        if (typeof parsed.id === 'string') {
          // Strip any `config` that may exist in legacy files so credential
          // material from an older format never re-enters memory from disk.
          const { config: _config, ...rest } = parsed;
          out.set(parsed.id, rest);
          this.uniqueIds.add(parsed.id);
        }
      } catch {
        // skip corrupted line
      }
    }
    return out;
  }

  async save(keyId: string, state: KeyState): Promise<void> {
    const work = async () => {
      const line = `${JSON.stringify(toPersisted(keyId, state))}\n`;
      await fs.mkdir(dirname(this.filePath), { recursive: true });
      await fs.appendFile(this.filePath, line, 'utf8');
      this.lineCount += 1;
      this.uniqueIds.add(keyId);
      const threshold = Math.max(this.uniqueIds.size * 10, 100);
      if (this.lineCount > threshold) {
        await this.compact();
      }
    };
    // serialize writes
    this.writeQueue = this.writeQueue.then(work, work);
    await this.writeQueue;
  }

  async close(): Promise<void> {
    await this.writeQueue;
  }

  private async compact(): Promise<void> {
    const snapshot = await this.loadAll();
    const lines: string[] = [];
    for (const [id, state] of snapshot) {
      lines.push(JSON.stringify(toPersisted(id, state)));
    }
    const tmp = `${this.filePath}.tmp`;
    await fs.writeFile(tmp, `${lines.join('\n')}\n`, 'utf8');
    await fs.rename(tmp, this.filePath);
    this.lineCount = lines.length;
  }
}
