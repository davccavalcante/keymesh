import { describe, expect, it } from 'vitest';
import { LeastUsedStrategy } from '../../src/strategies/LeastUsed.js';
import { RoundRobinStrategy } from '../../src/strategies/RoundRobin.js';
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

describe('Strategy edge cases', () => {
  it('round-robin handles single-key pool correctly', () => {
    const s = new RoundRobinStrategy();
    const k = key('only');
    expect(s.pick([k], [k])?.id).toBe('only');
    expect(s.pick([k], [k])?.id).toBe('only');
  });

  it('weighted with negative weight treats it as zero', () => {
    const s = new WeightedStrategy();
    const a = key('a', { config: { value: 'a', weight: -5 } });
    const b = key('b', { config: { value: 'b', weight: 5 } });
    const counts = new Map<string, number>();
    for (let i = 0; i < 200; i++) {
      const p = s.pick([a, b], [a, b]);
      if (p) counts.set(p.id, (counts.get(p.id) ?? 0) + 1);
    }
    expect(counts.get('a') ?? 0).toBe(0);
    expect(counts.get('b') ?? 0).toBe(200);
  });

  it('least-used falls back deterministically with all-equal state', () => {
    const s = new LeastUsedStrategy();
    const a = key('a');
    const b = key('b');
    expect(s.pick([a, b], [a, b])?.id).toBe('a');
  });
});
