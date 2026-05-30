import { describe, expect, it } from 'vitest';
import { LeastUsedStrategy } from '../../src/strategies/LeastUsed.js';
import { RoundRobinStrategy } from '../../src/strategies/RoundRobin.js';
import { SequentialThenRotateStrategy } from '../../src/strategies/SequentialThenRotate.js';
import { WeightedStrategy } from '../../src/strategies/Weighted.js';
import type { KeyState } from '../../src/types.js';

function key(id: string, overrides: Partial<KeyState> = {}): KeyState {
  return {
    config: { value: id, label: id, weight: 1 },
    id,
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

describe('RoundRobinStrategy', () => {
  it('returns null on empty eligible', () => {
    const s = new RoundRobinStrategy();
    expect(s.pick([], [])).toBeNull();
  });

  it('cycles through eligible keys', () => {
    const s = new RoundRobinStrategy();
    const all = [key('a'), key('b'), key('c')];
    const picks = [s.pick(all, all), s.pick(all, all), s.pick(all, all), s.pick(all, all)];
    expect(picks.map((k) => k?.id)).toEqual(['a', 'b', 'c', 'a']);
  });
});

describe('WeightedStrategy', () => {
  it('picks proportionally to weight (statistical)', () => {
    const s = new WeightedStrategy();
    const keys = [
      key('a', { config: { value: 'a', weight: 1 } }),
      key('b', { config: { value: 'b', weight: 9 } }),
    ];
    const counts = new Map<string, number>();
    for (let i = 0; i < 1000; i++) {
      const picked = s.pick(keys, keys);
      if (picked) counts.set(picked.id, (counts.get(picked.id) ?? 0) + 1);
    }
    const ratioB = (counts.get('b') ?? 0) / 1000;
    expect(ratioB).toBeGreaterThan(0.7); // expect ~0.9, allow noise
  });

  it('falls back to first key when total weight is zero', () => {
    const s = new WeightedStrategy();
    const keys = [
      key('a', { config: { value: 'a', weight: 0 } }),
      key('b', { config: { value: 'b', weight: 0 } }),
    ];
    expect(s.pick(keys, keys)?.id).toBe('a');
  });

  it('returns null on empty', () => {
    expect(new WeightedStrategy().pick([], [])).toBeNull();
  });
});

describe('LeastUsedStrategy', () => {
  it('picks the key with lowest inFlight', () => {
    const s = new LeastUsedStrategy();
    const keys = [key('a', { inFlight: 3 }), key('b', { inFlight: 1 }), key('c', { inFlight: 2 })];
    expect(s.pick(keys, keys)?.id).toBe('b');
  });

  it('breaks ties by lowest total usage', () => {
    const s = new LeastUsedStrategy();
    const keys = [
      key('a', { inFlight: 0, successCount: 10, failureCount: 0 }),
      key('b', { inFlight: 0, successCount: 1, failureCount: 0 }),
    ];
    expect(s.pick(keys, keys)?.id).toBe('b');
  });

  it('breaks tie by lastUsedAt when usage is equal', () => {
    const s = new LeastUsedStrategy();
    const keys = [key('a', { lastUsedAt: 2000 }), key('b', { lastUsedAt: 1000 })];
    expect(s.pick(keys, keys)?.id).toBe('b');
  });
});

describe('SequentialThenRotateStrategy', () => {
  it('returns the first eligible key in registration order', () => {
    const s = new SequentialThenRotateStrategy();
    const all = [key('a'), key('b'), key('c')];
    const eligible = all.filter((k) => k.id !== 'a'); // 'a' is excluded (cooled down)
    expect(s.pick(eligible, all)?.id).toBe('b');
  });

  it('falls back to eligible[0] if iteration through allKeys finds nothing (defensive)', () => {
    const s = new SequentialThenRotateStrategy();
    // eligible contains a key not in allKeys (cannot happen via orchestrator;
    // defensive coverage for the fallback branch).
    const orphan = key('orphan');
    const all = [key('a'), key('b')];
    expect(s.pick([orphan], all)?.id).toBe('orphan');
  });

  it('reverts to first as soon as it becomes eligible again', () => {
    const s = new SequentialThenRotateStrategy();
    const all = [key('a'), key('b'), key('c')];
    expect(s.pick(all, all)?.id).toBe('a');
  });

  it('returns null when no eligible keys', () => {
    const s = new SequentialThenRotateStrategy();
    expect(s.pick([], [key('a')])).toBeNull();
  });
});
