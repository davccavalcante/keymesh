import type { KeyState } from '../types.js';
import type { SelectorStrategy } from './types.js';

/**
 * Weighted random selection. Each key has a `weight` (default 1).
 * Probability of selection is `weight / sum(weights)`.
 */
export class WeightedStrategy implements SelectorStrategy {
  readonly name = 'weighted';

  pick(eligible: KeyState[], _allKeys: KeyState[]): KeyState | null {
    if (eligible.length === 0) return null;
    const weights = eligible.map((k) => Math.max(0, k.config.weight ?? 1));
    const total = weights.reduce((a, b) => a + b, 0);
    if (total <= 0) return eligible[0] ?? null;

    const r = Math.random() * total;
    let cumulative = 0;
    for (let i = 0; i < eligible.length; i++) {
      cumulative += weights[i] ?? 0;
      if (r < cumulative) return eligible[i] ?? null;
    }
    return eligible[eligible.length - 1] ?? null;
  }
}
