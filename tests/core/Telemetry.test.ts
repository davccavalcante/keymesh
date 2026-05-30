import { describe, expect, it, vi } from 'vitest';
import { Telemetry } from '../../src/core/Telemetry.js';

describe('Telemetry', () => {
  it('does not emit when disabled', () => {
    const t = new Telemetry(false);
    const handler = vi.fn();
    t.on('request.start', handler);
    t.emit({ type: 'request.start', keyId: 'k', path: ['x'], timestamp: 0 });
    expect(handler).not.toHaveBeenCalled();
  });

  it('emits to subscribers of the matching event type only', () => {
    const t = new Telemetry(true);
    const startHandler = vi.fn();
    const failHandler = vi.fn();
    t.on('request.start', startHandler);
    t.on('request.fail', failHandler);

    t.emit({ type: 'request.start', keyId: 'k', path: ['x'], timestamp: 0 });

    expect(startHandler).toHaveBeenCalledTimes(1);
    expect(failHandler).not.toHaveBeenCalled();
  });

  it('off() removes a subscriber', () => {
    const t = new Telemetry(true);
    const handler = vi.fn();
    t.on('request.start', handler);
    t.off('request.start', handler);
    t.emit({ type: 'request.start', keyId: 'k', path: ['x'], timestamp: 0 });
    expect(handler).not.toHaveBeenCalled();
  });

  it('off() with no prior subscription is a noop', () => {
    const t = new Telemetry(true);
    expect(() => t.off('request.start', () => {})).not.toThrow();
  });

  it('supports multiple subscribers of the same event', () => {
    const t = new Telemetry(true);
    const a = vi.fn();
    const b = vi.fn();
    t.on('circuit.open', a);
    t.on('circuit.open', b);
    t.emit({
      type: 'circuit.open',
      keyId: 'k',
      consecutiveFailures: 3,
      cooldownUntil: 0,
      timestamp: 0,
    });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('isolates a throwing handler from other subscribers', () => {
    const t = new Telemetry(true);
    const throwing = vi.fn(() => {
      throw new Error('boom');
    });
    const safe = vi.fn();
    t.on('request.start', throwing);
    t.on('request.start', safe);
    expect(() =>
      t.emit({ type: 'request.start', keyId: 'k', path: ['x'], timestamp: 0 }),
    ).not.toThrow();
    expect(throwing).toHaveBeenCalledTimes(1);
    expect(safe).toHaveBeenCalledTimes(1);
  });
});
