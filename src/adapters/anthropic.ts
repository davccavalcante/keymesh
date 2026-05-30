import Anthropic from '@anthropic-ai/sdk';
import type { DetectedError } from '../types.js';
import { extractRetryAfterMs } from './_shared.js';
import type { ProviderAdapter } from './types.js';

/** Constructor options forwarded to the underlying `Anthropic` client. */
export type AnthropicClientOptions = ConstructorParameters<typeof Anthropic>[0];

/**
 * Anthropic-specific transient set includes `529 Overloaded`, which the
 * Anthropic API returns when capacity is exhausted and the request should
 * be retried with backoff. The other entries are the standard
 * 5xx/rate-limit set shared with OpenAI.
 */
const TRANSIENT_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504, 529]);

/**
 * Drop-in adapter for the official `@anthropic-ai/sdk`.
 *
 * The wrapped client mirrors the Anthropic SDK shape one-to-one
 * (`client.messages.create(...)`, `client.beta.messages.create(...)`,
 * etc.) plus the {@link KeymeshExtras} surface.
 */
export const anthropicAdapter: ProviderAdapter<Anthropic, AnthropicClientOptions> = {
  name: 'anthropic',

  createClient(key, options) {
    return new Anthropic({ ...(options ?? {}), apiKey: key });
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
