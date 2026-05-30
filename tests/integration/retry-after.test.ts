import { describe, expect, it, vi } from 'vitest';
import { httpAdapter } from '../../src/adapters/http.js';
import { createKeymesh } from '../../src/core/createKeymesh.js';

describe('integration: Retry-After honored as per-key cooldown', () => {
  it('opens the circuit and routes around a key when Retry-After is provided', async () => {
    let key1Hits = 0;
    let key2Hits = 0;
    const mockFetch: typeof fetch = async (_url, init) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      const auth = headers.Authorization ?? '';
      const key = auth.replace('Bearer ', '');
      if (key === 'k1') {
        key1Hits += 1;
        return new Response('rate limit', {
          status: 429,
          headers: { 'retry-after': '60' },
        });
      }
      key2Hits += 1;
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
      circuitBreaker: { threshold: 1, cooldownMs: 60_000 },
      retry: { max: 5, baseMs: 1, maxMs: 5, jitter: false, totalBudgetMs: 5_000 },
    });

    await client.get('/x');
    await client.get('/x');
    await client.get('/x');

    expect(key1Hits).toBe(1);
    expect(key2Hits).toBe(3);

    const snap = client.inspect();
    expect(snap.keys.length).toBe(2);
  });

  it('emits all.exhausted when no key is eligible', async () => {
    const mockFetch: typeof fetch = async () => new Response('boom', { status: 503 });
    const client = createKeymesh({
      provider: httpAdapter({
        baseUrl: 'https://api.example.com',
        authHeader: (k) => ({ Authorization: `Bearer ${k}` }),
        fetch: mockFetch,
      }),
      keys: ['k1'],
      retry: { max: 3, baseMs: 1, jitter: false },
    });
    const exhausted = vi.fn();
    client.on('all.exhausted', exhausted);
    await expect(client.get('/x')).rejects.toThrow();
    expect(exhausted).toHaveBeenCalled();
  });
});
