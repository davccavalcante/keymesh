/**
 * multi-provider.ts - fall back from OpenAI to Anthropic to Gemini.
 *
 * Each provider has its own keymesh client; the application chooses
 * between them at the boundary. Cross-provider routing (picking the
 * cheapest, fastest, or highest-quality provider per query) is the job
 * of `modelmesh`, a separate package in the portfolio.
 *
 * Run:
 *   OPENAI_API_KEYS=...  ANTHROPIC_API_KEYS=...  GEMINI_API_KEYS=... \
 *     pnpm tsx examples/multi-provider.ts
 */

import { anthropicAdapter } from '../src/adapters/anthropic.js';
import { geminiAdapter } from '../src/adapters/gemini.js';
import { openaiAdapter } from '../src/adapters/openai.js';
import { createKeymesh } from '../src/index.js';

const openai = createKeymesh({
  provider: openaiAdapter,
  keys: (process.env.OPENAI_API_KEYS ?? '').split(',').filter(Boolean),
});
const anthropic = createKeymesh({
  provider: anthropicAdapter,
  keys: (process.env.ANTHROPIC_API_KEYS ?? '').split(',').filter(Boolean),
});
const gemini = createKeymesh({
  provider: geminiAdapter,
  keys: (process.env.GEMINI_API_KEYS ?? '').split(',').filter(Boolean),
});

const prompt = 'In one sentence: what does keymesh do?';

async function ask(): Promise<string> {
  try {
    const r = await openai.chat.completions.create({
      model: 'gpt-4.1',
      messages: [{ role: 'user', content: prompt }],
    });
    return r.choices[0]?.message?.content ?? '';
  } catch {
    try {
      const r = await anthropic.messages.create({
        model: 'claude-3-5-sonnet-latest',
        max_tokens: 256,
        messages: [{ role: 'user', content: prompt }],
      });
      const block = r.content[0];
      return block && 'text' in block ? block.text : '';
    } catch {
      const r = await gemini.models.generateContent({
        model: 'gemini-2.0-flash',
        contents: prompt,
      });
      return r.text ?? '';
    }
  }
}

console.log(await ask());

await Promise.all([openai.close(), anthropic.close(), gemini.close()]);
