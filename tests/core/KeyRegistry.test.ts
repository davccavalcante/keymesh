import { describe, expect, it } from 'vitest';
import { KeyRegistry } from '../../src/core/KeyRegistry.js';
import { ConfigurationError } from '../../src/errors.js';

describe('KeyRegistry', () => {
  it('throws on empty key array', () => {
    expect(() => new KeyRegistry([])).toThrow(ConfigurationError);
  });

  it('throws on invalid key (empty string)', () => {
    expect(() => new KeyRegistry([''])).toThrow(ConfigurationError);
  });

  it('throws on invalid key (object without value)', () => {
    // @ts-expect-error -- testing runtime validation
    expect(() => new KeyRegistry([{ label: 'bad' }])).toThrow(ConfigurationError);
  });

  it('accepts string keys and assigns deterministic ids', () => {
    const r1 = new KeyRegistry(['key-a', 'key-b']);
    const r2 = new KeyRegistry(['key-a', 'key-b']);
    expect(r1.size).toBe(2);
    expect(r1.all()[0]?.id).toBe(r2.all()[0]?.id);
  });

  it('deduplicates identical keys', () => {
    const r = new KeyRegistry(['same', 'same', 'same']);
    expect(r.size).toBe(1);
  });

  it('respects insertion order via .order', () => {
    const r = new KeyRegistry(['a', 'b', 'c']);
    const ids = r.order;
    expect(r.all().map((s) => s.id)).toEqual(ids);
  });

  it('default label is key-<id>', () => {
    const r = new KeyRegistry(['x']);
    const state = r.all()[0];
    expect(state?.config.label).toMatch(/^key-[a-f0-9]{8}$/);
  });

  it('respects explicit labels', () => {
    const r = new KeyRegistry([{ value: 'x', label: 'free-tier' }]);
    expect(r.all()[0]?.config.label).toBe('free-tier');
  });

  it('eligible() excludes keys with cooldownUntil > now', () => {
    const r = new KeyRegistry(['a', 'b']);
    const now = Date.now();
    const firstId = r.order[0];
    if (!firstId) throw new Error('no key');
    r.patch(firstId, { cooldownUntil: now + 60_000 });
    const eligible = r.eligible(now);
    expect(eligible.map((s) => s.id)).not.toContain(firstId);
  });

  it('eligible() excludes keys with open circuit and active cooldown', () => {
    const r = new KeyRegistry(['a', 'b']);
    const now = Date.now();
    const firstId = r.order[0];
    if (!firstId) throw new Error('no key');
    r.patch(firstId, { circuitState: 'open', cooldownUntil: now + 60_000 });
    expect(r.eligible(now).map((s) => s.id)).not.toContain(firstId);
  });

  it('patch() clamps healthScore between 0 and 100', () => {
    const r = new KeyRegistry(['a']);
    const id = r.order[0];
    if (!id) throw new Error('no key');
    r.patch(id, { healthScore: -10 });
    expect(r.get(id)?.healthScore).toBe(0);
    r.patch(id, { healthScore: 999 });
    expect(r.get(id)?.healthScore).toBe(100);
  });

  it('patch() clamps inFlight at 0', () => {
    const r = new KeyRegistry(['a']);
    const id = r.order[0];
    if (!id) throw new Error('no key');
    r.patch(id, { inFlight: -5 });
    expect(r.get(id)?.inFlight).toBe(0);
  });
});
