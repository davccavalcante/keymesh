import type { DetectedError } from '../types.js';
import { parseRetryAfter } from './_shared.js';
import type { ProviderAdapter } from './types.js';

/** Construction options for {@link httpAdapter}. */
export interface HttpAdapterOptions {
  /** Base URL prefixed to every request path that does not already start with `http`. */
  baseUrl: string;
  /** Build the auth header(s) for a given key. Called once per registered key at init. */
  authHeader: (key: string) => Record<string, string>;
  /** Additional headers applied to every request. Merged with `authHeader` (auth wins on collision). */
  defaultHeaders?: Record<string, string>;
  /** Default request timeout in ms. Omit or pass <= 0 to disable. */
  timeoutMs?: number;
  /**
   * Custom `fetch` implementation. Defaults to `globalThis.fetch` if available.
   * Supply this to inject a mock in tests or to route through a custom transport.
   */
  fetch?: typeof globalThis.fetch;
  /** Status codes considered transient in addition to the standard `[408, 425, 429, 500, 502, 503, 504]`. */
  extraTransientStatuses?: number[];
}

/** Request options accepted by {@link HttpClient.request}. */
export type HttpRequestInit = Omit<RequestInit, 'body'> & { body?: unknown };

/**
 * Ergonomic HTTP client returned by `httpAdapter().createClient(key)`.
 * Methods auto-serialize JSON bodies and parse JSON responses; pass a
 * `string` or `Uint8Array` body to send a raw payload.
 */
export interface HttpClient {
  get<T = unknown>(path: string, init?: Omit<RequestInit, 'body'>): Promise<T>;
  post<T = unknown>(path: string, body?: unknown, init?: Omit<RequestInit, 'body'>): Promise<T>;
  put<T = unknown>(path: string, body?: unknown, init?: Omit<RequestInit, 'body'>): Promise<T>;
  patch<T = unknown>(path: string, body?: unknown, init?: Omit<RequestInit, 'body'>): Promise<T>;
  delete<T = unknown>(path: string, init?: Omit<RequestInit, 'body'>): Promise<T>;
  request<T = unknown>(method: string, path: string, init?: HttpRequestInit): Promise<T>;
}

/**
 * Error thrown by the HTTP adapter when an upstream returns a non-2xx
 * response. Exposes the status, headers, and (truncated) response body
 * so callers and the keymesh error detector can introspect it.
 */
export class HttpResponseError extends Error {
  override readonly name = 'HttpResponseError';
  readonly status: number;
  readonly headers: Headers;
  readonly bodyText: string;

  constructor(status: number, statusText: string, headers: Headers, bodyText: string) {
    super(`HTTP ${status} ${statusText}: ${truncate(bodyText, 200)}`);
    this.status = status;
    this.headers = headers;
    this.bodyText = bodyText;
  }
}

const BASE_TRANSIENT_STATUSES = [408, 425, 429, 500, 502, 503, 504] as const;
const NETWORK_ERROR_PATTERN = /ECONNRESET|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|fetch failed|network/i;
const ABORT_ERROR_PATTERN = /abort|timeout/i;

/**
 * Build an HTTP adapter for an arbitrary REST endpoint.
 *
 * @example
 * const tavily = createKeymesh({
 *   provider: httpAdapter({
 *     baseUrl: 'https://api.tavily.com',
 *     authHeader: (key) => ({ Authorization: `Bearer ${key}` }),
 *   }),
 *   keys: process.env.TAVILY_API_KEYS?.split(',') ?? [],
 *   strategy: 'round-robin',
 * });
 * const result = await tavily.post('/search', { query: 'AI infrastructure 2026' });
 */
export function httpAdapter(options: HttpAdapterOptions): ProviderAdapter<HttpClient, void> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (!fetchImpl) {
    throw new Error(
      'keymesh httpAdapter: no fetch implementation available. Pass `options.fetch` or run in a fetch-capable runtime.',
    );
  }
  const transientCodes = new Set<number>([
    ...BASE_TRANSIENT_STATUSES,
    ...(options.extraTransientStatuses ?? []),
  ]);
  const baseUrlTrimmed = options.baseUrl.replace(/\/$/, '');

  return {
    name: 'http',

    createClient(key): HttpClient {
      const fixedHeaders = {
        ...(options.defaultHeaders ?? {}),
        ...options.authHeader(key),
      };

      async function request<T>(
        method: string,
        path: string,
        init: HttpRequestInit = {},
      ): Promise<T> {
        const url = path.startsWith('http') ? path : `${baseUrlTrimmed}/${path.replace(/^\//, '')}`;

        const { body: rawBody, headers: initHeaders, signal: initSignal, ...rest } = init;
        const merged: RequestInit = {
          ...rest,
          method,
          headers: {
            'content-type': 'application/json',
            ...fixedHeaders,
            ...((initHeaders as Record<string, string> | undefined) ?? {}),
          },
        };

        if (rawBody !== undefined && rawBody !== null) {
          const serialized =
            typeof rawBody === 'string' || rawBody instanceof Uint8Array
              ? rawBody
              : JSON.stringify(rawBody);
          (merged as { body?: string | Uint8Array }).body = serialized;
        }

        const controller = new AbortController();
        const timeoutId =
          options.timeoutMs && options.timeoutMs > 0
            ? setTimeout(() => controller.abort(), options.timeoutMs)
            : undefined;
        merged.signal = initSignal ?? controller.signal;

        try {
          const res = await fetchImpl(url, merged);
          if (!res.ok) {
            const bodyText = await res.text().catch(() => '');
            throw new HttpResponseError(res.status, res.statusText, res.headers, bodyText);
          }
          const contentType = res.headers.get('content-type') ?? '';
          if (contentType.includes('application/json')) {
            return (await res.json()) as T;
          }
          return (await res.text()) as unknown as T;
        } finally {
          if (timeoutId) clearTimeout(timeoutId);
        }
      }

      return {
        get: (path, init) => request('GET', path, init),
        post: (path, body, init) => request('POST', path, { ...init, body }),
        put: (path, body, init) => request('PUT', path, { ...init, body }),
        patch: (path, body, init) => request('PATCH', path, { ...init, body }),
        delete: (path, init) => request('DELETE', path, init),
        request: (method, path, init) => request(method, path, init ?? {}),
      };
    },

    detectError(err: unknown): DetectedError {
      if (err instanceof HttpResponseError) {
        const raw = err.headers.get('retry-after');
        const retryAfterMs = raw ? parseRetryAfter(raw) : undefined;
        return {
          status: err.status,
          retryAfterMs,
          isTransient: transientCodes.has(err.status),
          message: err.message,
        };
      }
      const message = err instanceof Error ? err.message : String(err);
      const looksLikeAbort = ABORT_ERROR_PATTERN.test(message);
      const looksLikeNetwork = NETWORK_ERROR_PATTERN.test(message);
      return {
        isTransient: looksLikeAbort || looksLikeNetwork,
        message,
      };
    },
  };
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}...`;
}
