import { describe, expect, it } from 'vitest';
import { MemoryBackend } from '../../src/state/memory.js';
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

describe('MemoryBackend', () => {
  it('returns null for missing keys', async () => {
    const b = new MemoryBackend();
    expect(await b.load('missing')).toBeNull();
  });

  it('persists and reloads state', async () => {
    const b = new MemoryBackend();
    const state = makeState({ successCount: 5 });
    await b.save(state.id, state);
    const loaded = await b.load(state.id);
    expect(loaded?.successCount).toBe(5);
  });

  it('loadAll returns a copy of all stored states', async () => {
    const b = new MemoryBackend();
    await b.save('a', makeState({ id: 'a' }));
    await b.save('b', makeState({ id: 'b' }));
    const all = await b.loadAll();
    expect(all.size).toBe(2);
    expect(all.has('a')).toBe(true);
    expect(all.has('b')).toBe(true);
  });

  it('overwrites on subsequent saves', async () => {
    const b = new MemoryBackend();
    await b.save('a', makeState({ id: 'a', successCount: 1 }));
    await b.save('a', makeState({ id: 'a', successCount: 99 }));
    const loaded = await b.load('a');
    expect(loaded?.successCount).toBe(99);
  });
});
