/**
 * universal-http.ts - use the generic HTTP adapter against any REST API.
 *
 * This example targets Tavily Search but works for Serper, Brave Search,
 * Exa, GitHub, Stripe, or any HTTP service.
 *
 * Run:
 *   TAVILY_API_KEYS=tvly-key1,tvly-key2 pnpm tsx examples/universal-http.ts
 */

import { httpAdapter } from '../src/adapters/http.js';
import { createKeymesh } from '../src/index.js';

const keys = (process.env.TAVILY_API_KEYS ?? '').split(',').filter(Boolean);

if (keys.length === 0) {
  console.error('Set TAVILY_API_KEYS to a comma-separated list of Tavily keys.');
  process.exit(1);
}

const tavily = createKeymesh({
  provider: httpAdapter({
    baseUrl: 'https://api.tavily.com',
    authHeader: (key) => ({ Authorization: `Bearer ${key}` }),
    timeoutMs: 15_000,
  }),
  keys,
  strategy: 'round-robin',
  retry: { max: 3, baseMs: 250, jitter: true },
});

const result = await tavily.post<{ results: Array<{ title: string; url: string }> }>('/search', {
  query: 'AI infrastructure 2026',
  max_results: 3,
});

for (const item of result.results) {
  console.log(`- ${item.title}\n  ${item.url}`);
}

await tavily.close();
