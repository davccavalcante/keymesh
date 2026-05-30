#!/usr/bin/env node
/**
 * keymesh CLI.
 *
 * Commands:
 *   keymesh start  --port 8787 --adapter openai --base-url https://api.openai.com \
 *                  --keys-env OPENAI_API_KEYS --strategy round-robin
 *   keymesh inspect [--state-file .keymesh-state.jsonl]
 *   keymesh help
 *   keymesh version
 *
 * The proxy is generic over any HTTPS upstream that accepts a single
 * Bearer/X-API-Key header. For richer SDK semantics, embed keymesh as a
 * library in your code instead.
 *
 * @module
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { type HttpClient, HttpResponseError, httpAdapter } from '../adapters/http.js';
import { createKeymesh } from '../core/createKeymesh.js';
import { FileBackend } from '../state/file.js';
import type { KeymeshExtras, StrategyName } from '../types.js';
import { defaultKeysEnv, parseArgs } from './args.js';

type AdapterName = 'openai' | 'anthropic' | 'gemini' | 'http';

const VALID_ADAPTERS: ReadonlySet<AdapterName> = new Set(['openai', 'anthropic', 'gemini', 'http']);

const ADAPTER_PRESETS: Record<
  Exclude<AdapterName, 'http'>,
  { baseUrl: string; authHeaderName: string; authHeaderValue: (k: string) => string }
> = {
  openai: {
    baseUrl: 'https://api.openai.com',
    authHeaderName: 'authorization',
    authHeaderValue: (k) => `Bearer ${k}`,
  },
  anthropic: {
    baseUrl: 'https://api.anthropic.com',
    authHeaderName: 'x-api-key',
    authHeaderValue: (k) => k,
  },
  gemini: {
    baseUrl: 'https://generativelanguage.googleapis.com',
    authHeaderName: 'x-goog-api-key',
    authHeaderValue: (k) => k,
  },
};

const STRIPPED_INCOMING_HEADERS = new Set([
  'authorization',
  'x-api-key',
  'x-goog-api-key',
  'host',
  'content-length',
]);

function printHelp(): void {
  console.log(`keymesh - universal API key rotation proxy

Usage:
  keymesh start --port 8787 --adapter openai --keys-env OPENAI_API_KEYS
  keymesh inspect [--state-file PATH]
  keymesh help
  keymesh version

Common options for "start":
  --port PORT                Port to listen on (default: 8787)
  --adapter NAME             one of: openai, anthropic, gemini, http (default: openai)
  --keys-env NAME            env var holding CSV list of keys (default: OPENAI_API_KEYS)
  --strategy NAME            round-robin | weighted | least-used | sequential-then-rotate
                             (default: round-robin)
  --base-url URL             override the upstream base URL (required for adapter=http)
  --auth-header NAME         override the auth header name (for adapter=http)
  --state-file PATH          persist key state at PATH (uses memory backend if omitted)
`);
}

function printVersion(): void {
  console.log('@takk/keymesh 1.0.0');
}

async function inspectCommand(args: Record<string, string | boolean>): Promise<void> {
  const file = typeof args['state-file'] === 'string' ? args['state-file'] : '.keymesh-state.jsonl';
  const backend = new FileBackend(file);
  const all = await backend.loadAll();
  if (all.size === 0) {
    console.log(`No persisted state at ${file}.`);
    return;
  }
  console.log(`State file: ${file}`);
  for (const [id, state] of all) {
    console.log(
      `  ${id}  health=${state.healthScore ?? '?'}  ` +
        `success=${state.successCount ?? 0}  failure=${state.failureCount ?? 0}  ` +
        `circuit=${state.circuitState ?? 'closed'}  ` +
        `cooldownUntil=${state.cooldownUntil ? new Date(state.cooldownUntil).toISOString() : '-'}`,
    );
  }
}

async function startCommand(args: Record<string, string | boolean>): Promise<void> {
  const adapter = ((args.adapter as string) || 'openai') as AdapterName;
  if (!VALID_ADAPTERS.has(adapter)) {
    throw new Error(`Unknown adapter: ${adapter}`);
  }

  const port = Number(args.port ?? 8787);
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error(`Invalid --port: ${args.port}`);
  }

  const keysEnv = (args['keys-env'] as string) || defaultKeysEnv(adapter);
  const rawKeys = process.env[keysEnv];
  if (!rawKeys) {
    throw new Error(`Environment variable ${keysEnv} is not set. Provide keys via --keys-env.`);
  }
  const keys = rawKeys
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
  if (keys.length === 0) {
    throw new Error(`${keysEnv} is set but contains no keys.`);
  }

  const strategy = (args.strategy as StrategyName) ?? 'round-robin';

  let baseUrl: string;
  let authHeaderName: string;
  let authHeaderValue: (k: string) => string;

  if (adapter === 'http') {
    baseUrl = (args['base-url'] as string) || '';
    if (!baseUrl) throw new Error('--base-url is required for adapter=http');
    authHeaderName = ((args['auth-header'] as string) || 'authorization').toLowerCase();
    authHeaderValue = (k) => (authHeaderName === 'authorization' ? `Bearer ${k}` : k);
  } else {
    const preset = ADAPTER_PRESETS[adapter];
    baseUrl = (args['base-url'] as string) || preset.baseUrl;
    authHeaderName = preset.authHeaderName;
    authHeaderValue = preset.authHeaderValue;
  }

  const stateFile =
    typeof args['state-file'] === 'string' ? (args['state-file'] as string) : undefined;

  const client = createKeymesh({
    provider: httpAdapter({
      baseUrl,
      authHeader: (k) => ({ [authHeaderName]: authHeaderValue(k) }),
    }),
    keys,
    strategy,
    state: stateFile ? 'file' : 'memory',
    stateFile,
  });

  const server = createServer((req, res) => {
    void handleRequest(req, res, client).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      res.statusCode = 502;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: 'keymesh.upstream', message }));
    });
  });

  server.listen(port, () => {
    console.log(
      `keymesh: listening on http://localhost:${port}\n` +
        `  adapter=${adapter} strategy=${strategy} keys=${keys.length} upstream=${baseUrl}`,
    );
  });

  const shutdown = async () => {
    server.close();
    await client.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  client: HttpClient & KeymeshExtras,
): Promise<void> {
  const url = req.url ?? '/';
  if (url === '/__keymesh_inspect') {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(client.inspect(), null, 2));
    return;
  }
  const method = req.method ?? 'GET';
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(req.headers)) {
    if (typeof value !== 'string') continue;
    if (STRIPPED_INCOMING_HEADERS.has(name.toLowerCase())) continue;
    headers[name] = value;
  }
  const bodyBuffer = await readBody(req);
  let body: unknown;
  if (bodyBuffer.length > 0) {
    const text = bodyBuffer.toString('utf8');
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  try {
    const result = await client.request(method, url, { body, headers });
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(result));
  } catch (err: unknown) {
    if (err instanceof HttpResponseError) {
      res.statusCode = err.status;
      res.setHeader('content-type', 'application/json');
      res.end(err.bodyText || JSON.stringify({ error: err.message }));
      return;
    }
    throw err;
  }
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  switch (command) {
    case 'start':
      await startCommand(args);
      break;
    case 'inspect':
      await inspectCommand(args);
      break;
    case 'version':
    case '--version':
    case '-v':
      printVersion();
      break;
    case 'help':
    case '--help':
    case '-h':
    case undefined:
      printHelp();
      break;
    default:
      console.error(`keymesh: unknown command "${command}"`);
      printHelp();
      process.exitCode = 1;
  }
}

void main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`keymesh: ${message}`);
  process.exitCode = 1;
});
