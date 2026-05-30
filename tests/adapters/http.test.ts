import { describe, expect, it, vi } from 'vitest';
import { HttpResponseError, httpAdapter } from '../../src/adapters/http.js';

describe('httpAdapter', () => {
  it('builds a client with get/post/put/patch/delete/request', () => {
    const adapter = httpAdapter({
      baseUrl: 'https://api.example.com',
      authHeader: (k) => ({ Authorization: `Bearer ${k}` }),
      fetch: vi.fn(),
    });
    const client = adapter.createClient('key1');
    expect(typeof client.get).toBe('function');
    expect(typeof client.post).toBe('function');
    expect(typeof client.put).toBe('function');
    expect(typeof client.patch).toBe('function');
    expect(typeof client.delete).toBe('function');
    expect(typeof client.request).toBe('function');
  });

  it('injects the auth header into every request', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const adapter = httpAdapter({
      baseUrl: 'https://api.example.com',
      authHeader: (k) => ({ Authorization: `Bearer ${k}` }),
      fetch: mockFetch,
    });
    const client = adapter.createClient('secret-key');
    await client.get('/search');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const init = mockFetch.mock.calls[0]?.[1] as RequestInit | undefined;
    const headers = init?.headers as Record<string, string> | undefined;
    expect(headers?.Authorization).toBe('Bearer secret-key');
  });

  it('serializes JSON bodies automatically', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(
        new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
      );
    const adapter = httpAdapter({
      baseUrl: 'https://api.example.com',
      authHeader: () => ({}),
      fetch: mockFetch,
    });
    const client = adapter.createClient('k');
    await client.post('/items', { name: 'foo' });
    const init = mockFetch.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init?.body).toBe(JSON.stringify({ name: 'foo' }));
  });

  it('throws HttpResponseError on non-2xx with body text', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response('upstream error detail', {
        status: 502,
        statusText: 'Bad Gateway',
      }),
    );
    const adapter = httpAdapter({
      baseUrl: 'https://api.example.com',
      authHeader: () => ({}),
      fetch: mockFetch,
    });
    const client = adapter.createClient('k');
    await expect(client.get('/x')).rejects.toBeInstanceOf(HttpResponseError);
  });

  it('detectError marks 429 as transient and parses Retry-After', () => {
    const adapter = httpAdapter({
      baseUrl: 'https://api.example.com',
      authHeader: () => ({}),
      fetch: vi.fn(),
    });
    const err = new HttpResponseError(
      429,
      'Too Many Requests',
      new Headers({ 'retry-after': '5' }),
      'rate limit',
    );
    const detected = adapter.detectError(err);
    expect(detected.status).toBe(429);
    expect(detected.isTransient).toBe(true);
    expect(detected.retryAfterMs).toBe(5000);
  });

  it('detectError treats 400 as non-transient', () => {
    const adapter = httpAdapter({
      baseUrl: 'https://api.example.com',
      authHeader: () => ({}),
      fetch: vi.fn(),
    });
    const err = new HttpResponseError(400, 'Bad Request', new Headers(), 'oops');
    expect(adapter.detectError(err).isTransient).toBe(false);
  });

  it('detectError treats network-ish errors as transient', () => {
    const adapter = httpAdapter({
      baseUrl: 'https://api.example.com',
      authHeader: () => ({}),
      fetch: vi.fn(),
    });
    const detected = adapter.detectError(new Error('fetch failed: ECONNRESET'));
    expect(detected.isTransient).toBe(true);
  });
});
