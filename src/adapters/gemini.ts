import { GoogleGenAI } from '@google/genai';
import type { DetectedError } from '../types.js';
import { extractRetryAfterMs } from './_shared.js';
import type { ProviderAdapter } from './types.js';

/** Constructor options forwarded to the underlying `GoogleGenAI` client. */
export type GeminiClientOptions = ConstructorParameters<typeof GoogleGenAI>[0];

const TRANSIENT_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

/**
 * Drop-in adapter for the official `@google/genai` SDK.
 *
 * Constructs `new GoogleGenAI({ apiKey, ...options })` per key. Errors
 * thrown by the SDK can expose status either at the top level (`err.status`)
 * or under `err.response.status`; both shapes are honored.
 */
export const geminiAdapter: ProviderAdapter<GoogleGenAI, GeminiClientOptions> = {
  name: 'gemini',

  createClient(key, options) {
    return new GoogleGenAI({ ...(options ?? {}), apiKey: key });
  },

  detectError(err: unknown): DetectedError {
    const e = err as {
      status?: number;
      code?: number | string;
      message?: string;
      response?: { status?: number; headers?: Record<string, unknown> };
    };
    const status =
      typeof e?.status === 'number'
        ? e.status
        : typeof e?.response?.status === 'number'
          ? e.response.status
          : undefined;
    const retryAfterMs = extractRetryAfterMs(e?.response?.headers);
    const isTransient = status !== undefined && TRANSIENT_STATUSES.has(status);

    return {
      status,
      retryAfterMs,
      isTransient,
      message: e?.message ?? String(err),
    };
  },
};
