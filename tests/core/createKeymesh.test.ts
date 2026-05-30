import { describe, expect, it, vi } from 'vitest';
import type { ProviderAdapter } from '../../src/adapters/types.js';
import { createKeymesh } from '../../src/core/createKeymesh.js';
import { AllKeysExhaustedError, ConfigurationError } from '../../src/errors.js';

interface FakeClient {
  echo: (msg: string) => Promise<string>;
  nested: {
    deep: {
      action: (n: number) => Promise<number>;
    };
  };
}

function makeFakeAdapter(behavior: {
  onCall: (key: string, path: string[], args: unknown[]) => Promise<unknown> | unknown;
}): ProviderAdapter<FakeClient, void> {
  return {
    name: 'fake',
    createClient(key) {
      return {
        echo: (msg: string) =>
          Promise.resolve(behavior.onCall(key, ['echo'], [msg]) as Promise<string>),
        nested: {
          deep: {
            action: (n: number) =>
              Promise.resolve(
                behavior.onCall(key, ['nested', 'deep', 'action'], [n]) as Promise<number>,
              ),
          },
        },
      };
    },
    detectError(err) {
      const e = err as { status?: number; message?: string };
      const status = e?.status;
      const isTransient =
        status !== undefined && [408, 425, 429, 500, 502, 503, 504].includes(status);
      return { status, isTransient, message: e?.message ?? String(err) };
    },
  };
}

describe('createKeymesh', () => {
  it('rejects when no keys are provided', () => {
    const adapter = makeFakeAdapter({ onCall: () => 'ok' });
    expect(() => createKeymesh({ provider: adapter, keys: [] })).toThrow(ConfigurationError);
  });

  it('returns a client that mirrors the underlying shape', async () => {
    const adapter = makeFakeAdapter({ onCall: () => 'hello' });
    const client = createKeymesh({ provider: adapter, keys: ['k1'] });
    expect(await client.echo('hi')).toBe('hello');
  });

  it('routes nested method calls through the orchestrator', async () => {
    const adapter = makeFakeAdapter({ onCall: () => 42 });
    const client = createKeymesh({ provider: adapter, keys: ['k1'] });
    expect(await client.nested.deep.action(1)).toBe(42);
  });

  it('rotates to the next key on transient error', async () => {
    const calls: Array<{ key: string }> = [];
    const adapter = makeFakeAdapter({
      onCall(key) {
        calls.push({ key });
        if (calls.length === 1) {
          const err = new Error('rate limited') as Error & { status: number };
          err.status = 429;
          throw err;
        }
        return 'success';
      },
    });
    const client = createKeymesh({
      provider: adapter,
      keys: ['k1', 'k2'],
      strategy: 'round-robin',
      retry: { max: 5, baseMs: 1, jitter: false },
    });
    const result = await client.echo('test');
    expect(result).toBe('success');
    expect(calls).toHaveLength(2);
    expect(calls[0]?.key).not.toBe(calls[1]?.key);
  });

  it('throws AllKeysExhaustedError when every key fails transiently', async () => {
    const adapter = makeFakeAdapter({
      onCall() {
        const err = new Error('server error') as Error & { status: number };
        err.status = 503;
        throw err;
      },
    });
    const client = createKeymesh({
      provider: adapter,
      keys: ['k1', 'k2'],
      retry: { max: 5, baseMs: 1, jitter: false },
    });
    await expect(client.echo('x')).rejects.toThrow(AllKeysExhaustedError);
  });

  it('does not retry on non-transient errors', async () => {
    let calls = 0;
    const adapter = makeFakeAdapter({
      onCall() {
        calls += 1;
        const err = new Error('bad request') as Error & { status: number };
        err.status = 400;
        throw err;
      },
    });
    const client = createKeymesh({
      provider: adapter,
      keys: ['k1', 'k2'],
    });
    await expect(client.echo('x')).rejects.toThrow('bad request');
    expect(calls).toBe(1);
  });

  it('emits request.start and request.success on a happy path', async () => {
    const adapter = makeFakeAdapter({ onCall: () => 'ok' });
    const client = createKeymesh({ provider: adapter, keys: ['k1'] });
    const events: string[] = [];
    client.on('request.start', () => events.push('start'));
    client.on('request.success', () => events.push('success'));
    await client.echo('hi');
    expect(events).toEqual(['start', 'success']);
  });

  it('emits circuit.open after threshold failures', async () => {
    const adapter = makeFakeAdapter({
      onCall() {
        const err = new Error('server') as Error & { status: number };
        err.status = 503;
        throw err;
      },
    });
    const client = createKeymesh({
      provider: adapter,
      keys: ['k1', 'k2'],
      circuitBreaker: { threshold: 1, cooldownMs: 1000 },
      retry: { max: 10, baseMs: 1, jitter: false },
    });
    const opened = vi.fn();
    client.on('circuit.open', opened);
    await expect(client.echo('x')).rejects.toThrow(AllKeysExhaustedError);
    expect(opened).toHaveBeenCalled();
  });

  it('inspect() returns the current pool snapshot', () => {
    const adapter = makeFakeAdapter({ onCall: () => 'ok' });
    const client = createKeymesh({
      provider: adapter,
      keys: ['k1', 'k2'],
      strategy: 'least-used',
    });
    const snap = client.inspect();
    expect(snap.strategy).toBe('least-used');
    expect(snap.keys).toHaveLength(2);
    expect(snap.totalRequests).toBe(0);
  });

  it('close() resolves even when no file backend is configured', async () => {
    const adapter = makeFakeAdapter({ onCall: () => 'ok' });
    const client = createKeymesh({ provider: adapter, keys: ['k1'] });
    await expect(client.close()).resolves.toBeUndefined();
  });
});
