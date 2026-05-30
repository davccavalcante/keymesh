import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileBackend } from '../../src/state/file.js';
import type { KeyState } from '../../src/types.js';

function makeState(overrides: Partial<KeyState> = {}): KeyState {
  return {
    config: { value: 'k', label: 'k' },
    id: 'abc12345',
    lastUsedAt: 0,
    successCount: 0,
    failureCount: 0,
    inFlight: 0,
    healthScore: 100,
    circuitState: 'closed',
    cooldownUntil: 0,
    consecutiveFailures: 0,
    ...overrides,
  };
}

describe('FileBackend', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'keymesh-'));
    file = join(dir, 'state.jsonl');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns empty map for non-existent file', async () => {
    const b = new FileBackend(file);
    const all = await b.loadAll();
    expect(all.size).toBe(0);
  });

  it('persists and reloads state', async () => {
    const b = new FileBackend(file);
    await b.save('a', makeState({ id: 'a', successCount: 7 }));
    const loaded = await b.load('a');
    expect(loaded?.successCount).toBe(7);
  });

  it('latest line wins on duplicate keys', async () => {
    const b = new FileBackend(file);
    await b.save('a', makeState({ id: 'a', successCount: 1 }));
    await b.save('a', makeState({ id: 'a', successCount: 2 }));
    const loaded = await b.load('a');
    expect(loaded?.successCount).toBe(2);
  });

  it('survives a fresh instance reading the same file', async () => {
    const b1 = new FileBackend(file);
    await b1.save('a', makeState({ id: 'a', successCount: 9 }));
    await b1.close();
    const b2 = new FileBackend(file);
    const loaded = await b2.load('a');
    expect(loaded?.successCount).toBe(9);
  });

  it('skips corrupted lines on load', async () => {
    const b = new FileBackend(file);
    await b.save('a', makeState({ id: 'a', successCount: 1 }));
    // Append a junk line
    const { promises: fs } = await import('node:fs');
    await fs.appendFile(file, 'not-json\n', 'utf8');
    const loaded = await b.load('a');
    expect(loaded?.successCount).toBe(1);
  });

  it('never writes the raw key value to disk (security)', async () => {
    const b = new FileBackend(file);
    await b.save('a', makeState({ id: 'a', config: { value: 'super-secret-key', label: 'a' } }));
    const { promises: fs } = await import('node:fs');
    const content = await fs.readFile(file, 'utf8');
    // The raw credential and its containing object must never reach disk.
    expect(content).not.toContain('super-secret-key');
    expect(content).not.toContain('"config"');
    expect(content).not.toContain('"value"');
    // Operational counters still round-trip; config is absent on reload.
    const loaded = await b.load('a');
    expect(loaded?.successCount).toBe(0);
    expect(loaded?.config).toBeUndefined();
  });

  it('drops config from legacy lines that contain it', async () => {
    const b = new FileBackend(file);
    const { promises: fs } = await import('node:fs');
    // Simulate a legacy file written by an older format that embedded config.
    await fs.writeFile(
      file,
      `${JSON.stringify({ id: 'a', successCount: 5, config: { value: 'legacy-secret', label: 'a' } })}\n`,
      'utf8',
    );
    const loaded = await b.load('a');
    expect(loaded?.successCount).toBe(5);
    expect(loaded?.config).toBeUndefined();
  });

  it('compacts the file when line count grows large', async () => {
    const b = new FileBackend(file);
    for (let i = 0; i < 200; i++) {
      await b.save('a', makeState({ id: 'a', successCount: i }));
    }
    const { promises: fs } = await import('node:fs');
    const content = await fs.readFile(file, 'utf8');
    const lines = content.split('\n').filter((l) => l.length > 0);
    // After 200 saves with 1 unique key, compaction must have fired at least
    // once. Without compaction we'd see 200 lines; with it we see fewer.
    expect(lines.length).toBeLessThan(200);
    // The latest state must still be readable.
    const loaded = await b.load('a');
    expect(loaded?.successCount).toBe(199);
  });
});
