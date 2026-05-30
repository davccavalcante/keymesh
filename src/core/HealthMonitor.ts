import type { HealthMonitorConfig, KeyState } from '../types.js';

/**
 * Health score management. Score is bounded to `[0, 100]` and starts at 100.
 *
 * - Success: nudges score upward by a small fixed amount, capped at 100.
 * - Failure: drops score by a larger amount, floored at 0. Severity is
 *   `'soft'` by default; pass `'hard'` for auth-class failures (401/403)
 *   that signal the key itself is invalid.
 * - Time decay: a key not used for a while regenerates toward 100 with a
 *   configurable half-life. The orchestrator calls {@link decay} once per
 *   pick to refresh the score before recording success/failure.
 *
 * All methods are pure functions over `KeyState` and return the next value;
 * the caller (via {@link KeyRegistry.patch}) persists the result.
 */
export class HealthMonitor {
  private readonly halfLifeMs: number;

  constructor(config: HealthMonitorConfig) {
    this.halfLifeMs = Math.max(1000, config.decayHalfLifeMs);
  }

  /**
   * Compute the new score that should replace `currentScore` after
   * `elapsedMs` has passed since the last update. Uses first-order
   * exponential regeneration toward 100 with the configured half-life.
   */
  decay(currentScore: number, elapsedMs: number): number {
    if (currentScore >= 100) return 100;
    if (elapsedMs <= 0) return currentScore;
    const lambda = Math.LN2 / this.halfLifeMs;
    const gap = 100 - currentScore;
    const regenerated = gap * (1 - Math.exp(-lambda * elapsedMs));
    return Math.min(100, currentScore + regenerated);
  }

  /** Apply a success: +5 score, capped at 100. */
  applySuccess(state: KeyState): number {
    return Math.min(100, state.healthScore + 5);
  }

  /**
   * Apply a failure penalty.
   * @param severity `'soft'` (default) costs 10 points; `'hard'` costs 25.
   *                 Use `'hard'` for 401/403 (likely invalid credential).
   */
  applyFailure(state: KeyState, severity: 'soft' | 'hard' = 'soft'): number {
    const penalty = severity === 'hard' ? 25 : 10;
    return Math.max(0, state.healthScore - penalty);
  }
}
