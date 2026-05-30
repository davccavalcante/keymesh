import type { KeyState } from '../types.js';

/**
 * A key-selection strategy. Returns the next key to use, or null if none are eligible.
 *
 * `eligible` is the subset of `allKeys` that are currently usable
 * (circuit not open, not in cooldown). `allKeys` is provided for strategies
 * that need to consider the full pool (e.g., weighted total).
 */
export interface SelectorStrategy {
  readonly name: string;
  pick(eligible: KeyState[], allKeys: KeyState[]): KeyState | null;
}
