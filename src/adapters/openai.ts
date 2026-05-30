import OpenAI from 'openai';
import type { DetectedError } from '../types.js';
import { extractRetryAfterMs } from './_shared.js';
import type { ProviderAdapter } from './types.js';

/** Constructor options forwarded to the underlying `OpenAI` client. */
export type OpenAIClientOptions = ConstructorParameters<typeof OpenAI>[0];

const TRANSIENT_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

/**
 * Drop-in adapter for the official `openai` SDK.
 *
 * The wrapped client mirrors the OpenAI SDK shape one-to-one
 * (`client.chat.completions.create(...)`, `client.embeddings.create(...)`,
 * etc.) plus the {@link KeymeshExtras} surface.
 *
 * Streaming and pagination from the SDK are not yet wrapped by the rotation
 * layer in 1.0; use the underlying SDK directly for those, or call
 * `client.inspect()` to discover which key is current. Streaming support
 * lands in 1.1.
 */
export const openaiAdapter: ProviderAdapter<OpenAI, OpenAIClientOptions> = {
  name: 'openai',

  createClient(key, options) {
    return new OpenAI({ ...(options ?? {}), apiKey: key });
  },

  detectError(err: unknown): DetectedError {
    const e = err as {
      status?: number;
      headers?: { get?: (name: string) => string | null } | Record<string, unknown>;
      message?: string;
    };
    const status = typeof e?.status === 'number' ? e.status : undefined;
    const retryAfterMs = extractRetryAfterMs(e?.headers);
    const isTransient = status !== undefined && TRANSIENT_STATUSES.has(status);

    return {
      status,
      retryAfterMs,
      isTransient,
      message: e?.message ?? String(err),
    };
  },
};
