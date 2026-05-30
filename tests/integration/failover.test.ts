import { describe, expect, it, vi } from 'vitest';
import { httpAdapter } from '../../src/adapters/http.js';
import { createKeymesh } from '../../src/core/createKeymesh.js';
import { AllKeysExhaustedError } from '../../src/errors.js';

describe('integration: failover scenarios', () => {
  it('rotates from a 429 key to a working key', async () => {
    const seenKeys: string[] = [];
    const mockFetch: typeof fetch = async (_url, init) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      const auth = headers.Authorization ?? '';
      const key = auth.replace('Bearer ', '');
      seenKeys.push(key);
      if (key === 'k1') {
        return new Response('rate limit', {
          status: 429,
          headers: { 'retry-after': '1' },
        });
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    const client = createKeymesh({
      provider: httpAdapter({
        baseUrl: 'https://api.example.com',
        authHeader: (k) => ({ Authorization: `Bearer ${k}` }),
        fetch: mockFetch,
      }),
      keys: ['k1', 'k2'],
      retry: { max: 5, baseMs: 1, jitter: false },
    });
    const result = await client.get('/x');
    expect(result).toEqual({ ok: true });
    expect(seenKeys).toEqual(['k1', 'k2']);
  });

  it('throws AllKeysExhaustedError when both keys keep returning 503', async () => {
    const mockFetch = vi.fn(async () => new Response('boom', { status: 503 }));
    const client = createKeymesh({
      provider: httpAdapter({
        baseUrl: 'https://api.example.com',
        authHeader: (k) => ({ Authorization: `Bearer ${k}` }),
        fetch: mockFetch,
      }),
      keys: ['k1', 'k2'],
      retry: { max: 3, baseMs: 1, jitter: false },
    });
    await expect(client.get('/x')).rejects.toBeInstanceOf(AllKeysExhaustedError);
  });

  it('emits key.rotated event on failover', async () => {
    let calls = 0;
    const mockFetch = vi.fn(async () => {
      calls += 1;
      if (calls === 1) return new Response('rate limit', { status: 429 });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const client = createKeymesh({
      provider: httpAdapter({
        baseUrl: 'https://api.example.com',
        authHeader: (k) => ({ Authorization: `Bearer ${k}` }),
        fetch: mockFetch,
      }),
      keys: ['k1', 'k2'],
      retry: { max: 5, baseMs: 1, jitter: false },
    });
    const rotated = vi.fn();
    client.on('key.rotated', rotated);
    await client.get('/x');
    expect(rotated).toHaveBeenCalled();
  });

  it('does not retry on 401 (non-transient hard failure)', async () => {
    let calls = 0;
    const mockFetch = vi.fn(async () => {
      calls += 1;
      return new Response('unauthorized', { status: 401 });
    });
    const client = createKeymesh({
      provider: httpAdapter({
        baseUrl: 'https://api.example.com',
        authHeader: (k) => ({ Authorization: `Bearer ${k}` }),
        fetch: mockFetch,
      }),
      keys: ['k1', 'k2'],
    });
    await expect(client.get('/x')).rejects.toThrow();
    expect(calls).toBe(1);
  });
});
