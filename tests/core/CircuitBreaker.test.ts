import { describe, expect, it } from 'vitest';
import { CircuitBreaker } from '../../src/core/CircuitBreaker.js';
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

describe('CircuitBreaker', () => {
  const cb = new CircuitBreaker({
    threshold: 3,
    cooldownMs: 1000,
    halfOpenMaxCalls: 1,
  });

  it('closes circuit on success and resets consecutive failures', () => {
    const decision = cb.onSuccess(
      makeKey({ circuitState: 'half-open', consecutiveFailures: 2 }),
      Date.now(),
    );
    expect(decision.state).toBe('closed');
    expect(decision.resetConsecutive).toBe(true);
    expect(decision.cooldownUntil).toBe(0);
  });

  it('keeps circuit closed under threshold', () => {
    const decision = cb.onFailure(makeKey({ consecutiveFailures: 1 }), Date.now());
    expect(decision.state).toBe('closed');
  });

  it('opens circuit when consecutive failures reach threshold', () => {
    const now = 1000;
    const decision = cb.onFailure(makeKey({ consecutiveFailures: 2 }), now);
    expect(decision.state).toBe('open');
    expect(decision.cooldownUntil).toBe(now + 1000);
  });

  it('honors Retry-After header as cooldown', () => {
    const now = 1000;
    const decision = cb.onFailure(makeKey({ consecutiveFailures: 2 }), now, 5000);
    expect(decision.cooldownUntil).toBe(now + 5000);
  });

  it('transitions open -> half-open after cooldown elapses', () => {
    const now = 2000;
    const next = cb.transitionOnPick(makeKey({ circuitState: 'open', cooldownUntil: 1500 }), now);
    expect(next).toBe('half-open');
  });

  it('keeps open if cooldown not yet elapsed', () => {
    const now = 1000;
    const next = cb.transitionOnPick(makeKey({ circuitState: 'open', cooldownUntil: 2000 }), now);
    expect(next).toBe('open');
  });
});
