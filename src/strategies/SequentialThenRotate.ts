import type { KeyState } from '../types.js';
import type { SelectorStrategy } from './types.js';

/**
 * Uses the first eligible key (in registration order) until it fails or is
 * cooled down. Falls through to the next in order. Reverts to the first as
 * soon as it becomes eligible again.
 */
export class SequentialThenRotateStrategy implements SelectorStrategy {
  readonly name = 'sequential-then-rotate';

  pick(eligible: KeyState[], allKeys: KeyState[]): KeyState | null {
    if (eligible.length === 0) return null;
    const eligibleIds = new Set(eligible.map((k) => k.id));
    for (const key of allKeys) {
      if (eligibleIds.has(key.id)) return key;
    }
    return eligible[0] ?? null;
  }
}
