import { type ChildProcessByStdio, spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, resolve } from 'node:path';
import type { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

type SpawnedCli = ChildProcessByStdio<null, Readable, Readable>;

/**
 * Functional smoke test for the `keymesh start` proxy.
 *
 * Boots a real fake upstream HTTP server, then spawns the CLI pointing at
 * it. Sends two requests through the proxy and verifies:
 *  1. Both reach the upstream.
 *  2. The auth header injected by keymesh carries the configured key.
 *  3. Round-robin rotates between the two configured keys.
 *
 * Skipped when the dist/ build is missing so this suite does not block
 * source-only iterations.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI_ENTRY = resolve(ROOT, 'dist', 'cli', 'index.js');

let upstream: Server;
let upstreamPort: number;
const received: Array<{ authHeader: string | null; path: string }> = [];

async function fileExists(path: string): Promise<boolean> {
  const { stat } = await import('node:fs/promises');
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

beforeAll(async () => {
  upstream = createServer((req, res) => {
    received.push({
      authHeader: (req.headers.authorization as string | undefined) ?? null,
      path: req.url ?? '',
    });
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ok: true, seen: received.length }));
  });
  await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r));
  upstreamPort = (upstream.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((r) => upstream.close(() => r()));
});

describe('CLI smoke: keymesh start proxy', () => {
  it('forwards requests to the upstream and rotates keys round-robin', async () => {
    if (!(await fileExists(CLI_ENTRY))) {
      return; // dist/ not built; integration is opt-in to keep unit cycles fast
    }

    const proxyPort = await pickPort();
    const child: SpawnedCli = spawn(
      process.execPath,
      [
        CLI_ENTRY,
        'start',
        '--port',
        String(proxyPort),
        '--adapter',
        'http',
        '--base-url',
        `http://127.0.0.1:${upstreamPort}`,
        '--keys-env',
        'KEYMESH_SMOKE_KEYS',
        '--strategy',
        'round-robin',
      ],
      {
        env: { ...process.env, KEYMESH_SMOKE_KEYS: 'alpha,beta' },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    try {
      await waitForListening(child);

      const r1 = await fetch(`http://127.0.0.1:${proxyPort}/v1/foo`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ hello: 'world' }),
      });
      expect(r1.status).toBe(200);

      const r2 = await fetch(`http://127.0.0.1:${proxyPort}/v1/foo`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ hello: 'again' }),
      });
      expect(r2.status).toBe(200);

      const both = received.slice(-2);
      expect(both[0]?.authHeader).toBe('Bearer alpha');
      expect(both[1]?.authHeader).toBe('Bearer beta');

      const inspectResp = await fetch(`http://127.0.0.1:${proxyPort}/__keymesh_inspect`);
      const snapshot = (await inspectResp.json()) as { keys: unknown[]; strategy: string };
      expect(snapshot.strategy).toBe('round-robin');
      expect(snapshot.keys.length).toBe(2);
    } finally {
      child.kill('SIGTERM');
      await new Promise<void>((r) => child.once('exit', () => r()));
    }
  }, 15_000);
});

async function pickPort(): Promise<number> {
  return new Promise<number>((res) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as AddressInfo).port;
      s.close(() => res(port));
    });
  });
}

function waitForListening(child: SpawnedCli): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('CLI did not start within 5s')), 5_000);
    const onData = (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      if (text.includes('listening on')) {
        clearTimeout(timeout);
        child.stdout.off('data', onData);
        resolve();
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', (chunk) => {
      // surface errors fast
      const text = chunk.toString('utf8');
      if (text.toLowerCase().includes('error')) {
        clearTimeout(timeout);
        reject(new Error(`CLI stderr: ${text}`));
      }
    });
    child.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        clearTimeout(timeout);
        reject(new Error(`CLI exited early with code ${code}`));
      }
    });
  });
}
