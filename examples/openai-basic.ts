/**
 * openai-basic.ts - drop-in keymesh usage with the OpenAI SDK.
 *
 * Run:
 *   OPENAI_API_KEYS="sk-key1,sk-key2,sk-key3" pnpm tsx examples/openai-basic.ts
 */

import { openaiAdapter } from '../src/adapters/openai.js';
import { createKeymesh } from '../src/index.js';

const keys = (process.env.OPENAI_API_KEYS ?? '').split(',').filter(Boolean);

if (keys.length === 0) {
  console.error('Set OPENAI_API_KEYS to a comma-separated list of OpenAI keys.');
  process.exit(1);
}

const client = createKeymesh({
  provider: openaiAdapter,
  keys,
  strategy: 'least-used',
  circuitBreaker: { threshold: 3, cooldownMs: 30_000 },
  retry: { max: 5, baseMs: 200, jitter: true },
  telemetry: { enabled: true },
});

client.on('request.start', (e) => {
  console.log(`request start key=${e.keyId} path=${e.path.join('.')}`);
});
client.on('key.rotated', (e) => {
  console.log(`key rotated from=${e.from} to=${e.to} reason=${e.reason}`);
});

const response = await client.chat.completions.create({
  model: 'gpt-4.1',
  messages: [{ role: 'user', content: 'Say hello in one sentence.' }],
});

console.log(response.choices[0]?.message?.content);
console.log(client.inspect());

await client.close();
