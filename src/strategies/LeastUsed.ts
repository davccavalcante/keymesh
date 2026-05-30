import type { KeyState } from '../types.js';
import type { SelectorStrategy } from './types.js';

/**
 * Selects the key with the lowest in-flight count, breaking ties by lowest
 * successCount + failureCount, then by oldest lastUsedAt.
 */
export class LeastUsedStrategy implements SelectorStrategy {
  readonly name = 'least-used';

  pick(eligible: KeyState[], _allKeys: KeyState[]): KeyState | null {
    if (eligible.length === 0) return null;

    let best: KeyState | null = null;
    for (const key of eligible) {
      if (best === null) {
        best = key;
        continue;
      }
      if (key.inFlight < best.inFlight) {
        best = key;
        continue;
      }
      if (key.inFlight === best.inFlight) {
        const keyTotal = key.successCount + key.failureCount;
        const bestTotal = best.successCount + best.failureCount;
        if (keyTotal < bestTotal) {
          best = key;
          continue;
        }
        if (keyTotal === bestTotal && key.lastUsedAt < best.lastUsedAt) {
          best = key;
        }
      }
    }
    return best;
  }
}
