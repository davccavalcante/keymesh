/**
 * Internal helpers shared by the SDK adapters. The leading underscore in the
 * filename marks this as a private surface — it is not exported via any
 * package subpath in `package.json#exports`. Consumers must not import it
 * directly.
 *
 * tsup is configured with `splitting: false`, so the contents of this file
 * are inlined into each adapter bundle. Keeping the helpers here avoids
 * three copies in source and centralizes maintenance.
 *
 * @internal
 * @module
 */

/**
 * Parse a `Retry-After` header value into a delay in milliseconds.
 *
 * Per [RFC 7231](https://www.rfc-editor.org/rfc/rfc7231#section-7.1.3),
 * `Retry-After` may be either:
 *  - a non-negative decimal number of seconds, or
 *  - an HTTP-date.
 *
 * Returns `undefined` if the value matches neither shape.
 */
export function parseRetryAfter(value: string): number | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  // Prefer numeric-seconds when the value is a pure number; otherwise fall
  // back to HTTP-date parsing. `Number('')` coerces to 0, so the empty-string
  // check above is what guards the "no value" case from silently becoming 0.
  if (/^[+-]?\d+(\.\d+)?$/.test(trimmed)) {
    const seconds = Number(trimmed);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  }
  const date = Date.parse(trimmed);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return undefined;
}

/**
 * Extract the `Retry-After` value from either a Fetch-style `Headers`
 * object (via `.get()`) or a plain object whose keys are header names.
 * Returns the parsed milliseconds, or `undefined` if no usable value is
 * present.
 */
export function extractRetryAfterMs(
  headers: { get?: (name: string) => string | null } | Record<string, unknown> | null | undefined,
): number | undefined {
  if (!headers) return undefined;
  const h = headers as { get?: (name: string) => string | null } & Record<string, unknown>;
  let raw: string | null | undefined;
  if (typeof h.get === 'function') {
    raw = h.get('retry-after');
  } else if (typeof h['retry-after'] === 'string') {
    raw = h['retry-after'] as string;
  }
  return raw ? parseRetryAfter(raw) : undefined;
}
