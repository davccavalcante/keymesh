import type { CircuitBreakerConfig, CircuitState, KeyState } from '../types.js';

/**
 * The next state a key should transition to, plus the cooldown to apply
 * and whether the consecutive-failure counter should reset.
 */
export interface CircuitDecision {
  /** Next circuit state. */
  state: CircuitState;
  /** Timestamp (ms) until which the key is in cooldown; 0 if no cooldown. */
  cooldownUntil: number;
  /** Reset the consecutive-failure counter. */
  resetConsecutive: boolean;
}

/**
 * Stateless circuit breaker. Each method computes what the next state of a
 * key should be without mutating the input. The orchestrator applies the
 * decision via {@link KeyRegistry.patch}.
 *
 * State machine: `closed -> open` after `threshold` consecutive failures;
 * `open -> half-open` once the cooldown window elapses (see
 * {@link transitionOnPick}); `half-open -> closed` on the first success;
 * `half-open -> open` on any failure.
 */
export class CircuitBreaker {
  constructor(private readonly config: CircuitBreakerConfig) {}

  /** Called after a successful request. Always closes the circuit. */
  onSuccess(_state: KeyState, _now: number): CircuitDecision {
    return { state: 'closed', cooldownUntil: 0, resetConsecutive: true };
  }

  /**
   * Called after a failed request. Opens the circuit and sets a cooldown
   * once `consecutiveFailures + 1 >= threshold`. If the upstream provided
   * a `Retry-After` value (ms), it is honored verbatim instead of the
   * configured `cooldownMs`.
   */
  onFailure(state: KeyState, now: number, retryAfterMs?: number): CircuitDecision {
    const consecutive = state.consecutiveFailures + 1;
    if (consecutive >= this.config.threshold) {
      const cooldown = retryAfterMs ?? this.config.cooldownMs;
      return {
        state: 'open',
        cooldownUntil: now + cooldown,
        resetConsecutive: false,
      };
    }
    return {
      state: state.circuitState,
      cooldownUntil: state.cooldownUntil,
      resetConsecutive: false,
    };
  }

  /**
   * Called when picking a key. Transitions `open -> half-open` once the
   * cooldown window has elapsed; otherwise returns the existing state
   * unchanged. The orchestrator uses this to give a key one trial request
   * before fully re-closing the circuit on success.
   */
  transitionOnPick(state: KeyState, now: number): CircuitState {
    if (state.circuitState === 'open' && state.cooldownUntil <= now) {
      return 'half-open';
    }
    return state.circuitState;
  }
}
