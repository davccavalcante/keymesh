import { describe, expect, it } from 'vitest';
import { HealthMonitor } from '../../src/core/HealthMonitor.js';
import type { KeyState } from '../../src/types.js';

function makeKey(overrides: Partial<KeyState> = {}): KeyState {
  return {
    config: { value: 'k', label: 'k' },
    id: 'k',
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

describe('HealthMonitor', () => {
  const monitor = new HealthMonitor({ decayHalfLifeMs: 60_000 });

  it('returns 100 unchanged when score is already 100', () => {
    expect(monitor.decay(100, 60_000)).toBe(100);
  });

  it('returns the current score when elapsed is zero or negative', () => {
    expect(monitor.decay(50, 0)).toBe(50);
    expect(monitor.decay(50, -1000)).toBe(50);
  });

  it('regenerates roughly half the gap to 100 after one half-life', () => {
    const startScore = 0;
    const after = monitor.decay(startScore, 60_000);
    expect(after).toBeGreaterThan(49);
    expect(after).toBeLessThan(51);
  });

  it('never exceeds 100 even with very long elapsed time', () => {
    expect(monitor.decay(50, 10 * 60 * 60_000)).toBeLessThanOrEqual(100);
  });

  it('applySuccess boosts the score by 5 capped at 100', () => {
    expect(monitor.applySuccess(makeKey({ healthScore: 90 }))).toBe(95);
    expect(monitor.applySuccess(makeKey({ healthScore: 98 }))).toBe(100);
    expect(monitor.applySuccess(makeKey({ healthScore: 100 }))).toBe(100);
  });

  it('applyFailure (soft) drops the score by 10 floored at 0', () => {
    expect(monitor.applyFailure(makeKey({ healthScore: 80 }), 'soft')).toBe(70);
    expect(monitor.applyFailure(makeKey({ healthScore: 5 }), 'soft')).toBe(0);
  });

  it('applyFailure (hard) drops the score by 25 floored at 0', () => {
    expect(monitor.applyFailure(makeKey({ healthScore: 80 }), 'hard')).toBe(55);
    expect(monitor.applyFailure(makeKey({ healthScore: 10 }), 'hard')).toBe(0);
  });

  it('clamps decayHalfLifeMs to at least 1000ms', () => {
    const fast = new HealthMonitor({ decayHalfLifeMs: 10 });
    expect(fast.decay(0, 1000)).toBeGreaterThan(0);
  });
});
