import type { KeyState } from '../types.js';
import type { SelectorStrategy } from './types.js';

/**
 * Plain round-robin selection. Each pick advances an internal counter so
 * successive calls cycle through the eligible set in order. The counter is
 * stateful per strategy instance, which means two clients using the same
 * strategy instance would share the cursor; in practice every keymesh
 * client constructs its own instance via the string alias `'round-robin'`.
 */
export class RoundRobinStrategy implements SelectorStrategy {
  readonly name = 'round-robin';
  private index = 0;

  pick(eligible: KeyState[], _allKeys: KeyState[]): KeyState | null {
    if (eligible.length === 0) return null;
    const choice = eligible[this.index % eligible.length] ?? null;
    this.index = (this.index + 1) % eligible.length;
    return choice;
  }
}
