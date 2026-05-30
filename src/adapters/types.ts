import type { DetectedError } from '../types.js';

/**
 * A provider adapter. Knows how to:
 *  1. Build an SDK client for a given key.
 *  2. Classify errors so keymesh can decide whether to retry/rotate.
 *
 * @typeParam TClient  The shape of the SDK client created by `createClient`.
 *                     keymesh returns a deep Proxy over this client, augmented
 *                     with `KeymeshExtras`.
 * @typeParam TOptions Optional provider-specific options forwarded via
 *                     `KeymeshConfig.providerOptions`.
 */
export interface ProviderAdapter<TClient = unknown, TOptions = unknown> {
  readonly name: string;
  /** Build an SDK client instance for the given key. */
  createClient(key: string, options?: TOptions): TClient;
  /** Classify an error thrown by the SDK or HTTP fetch. */
  detectError(err: unknown): DetectedError;
}
