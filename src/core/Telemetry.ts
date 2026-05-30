import type { EventHandler, EventOf, TelemetryEvent, TelemetryEventName } from '../types.js';

/**
 * Minimal, runtime-agnostic event emitter used by the orchestrator to
 * surface lifecycle events ({@link TelemetryEvent}) to subscribers.
 *
 * Deliberately does not depend on `node:events` so the same code runs in
 * Cloudflare Workers, Deno, Bun, and browsers. Handlers are invoked
 * synchronously inside `emit`; thrown handler errors are swallowed so a
 * misbehaving subscriber cannot crash the orchestrator.
 *
 * When constructed with `enabled = false`, `emit` becomes a no-op while
 * `on`/`off` continue to work (so consumers can wire subscriptions
 * unconditionally and toggle observability via the `telemetry.enabled`
 * config flag).
 */
export class Telemetry {
  private listeners = new Map<TelemetryEventName, Set<(event: TelemetryEvent) => void>>();
  private readonly enabled: boolean;

  constructor(enabled = true) {
    this.enabled = enabled;
  }

  on<T extends TelemetryEventName>(event: T, handler: EventHandler<T>): void {
    const set = this.listeners.get(event) ?? new Set<(event: TelemetryEvent) => void>();
    set.add(handler as (event: TelemetryEvent) => void);
    this.listeners.set(event, set);
  }

  off<T extends TelemetryEventName>(event: T, handler: EventHandler<T>): void {
    const set = this.listeners.get(event);
    if (!set) return;
    set.delete(handler as (event: TelemetryEvent) => void);
    if (set.size === 0) this.listeners.delete(event);
  }

  emit<T extends TelemetryEventName>(event: EventOf<T>): void {
    if (!this.enabled) return;
    const set = this.listeners.get(event.type);
    if (!set) return;
    for (const handler of set) {
      try {
        handler(event);
      } catch {
        // Never let a handler crash the orchestrator.
      }
    }
  }
}
