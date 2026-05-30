# CLI proxy mode

`keymesh` can run as a local HTTP proxy when you don't want to embed the
library in code.

## Start

```bash
# OpenAI (default adapter), reads keys from OPENAI_API_KEYS
export OPENAI_API_KEYS="sk-key1,sk-key2,sk-key3"
npx @takk/keymesh start --port 8787

# Anthropic
export ANTHROPIC_API_KEYS="sk-ant-key1,sk-ant-key2"
npx @takk/keymesh start --port 8788 --adapter anthropic

# Gemini
export GEMINI_API_KEYS="key1,key2"
npx @takk/keymesh start --port 8789 --adapter gemini

# Any REST API
export API_KEYS="tvly-key1,tvly-key2"
npx @takk/keymesh start --port 8790 --adapter http \
  --base-url https://api.tavily.com \
  --keys-env API_KEYS
```

## Use

```bash
# From your app, point your OpenAI SDK at localhost
curl http://localhost:8787/v1/chat/completions \
  -H "content-type: application/json" \
  -d '{
    "model": "gpt-4.1",
    "messages": [{"role":"user","content":"Hello"}]
  }'
```

`keymesh` injects the rotated key as the `Authorization` (or `x-api-key`,
or `x-goog-api-key`, depending on the adapter) header before forwarding
upstream.

## Inspect

```bash
# Live pool state via HTTP
curl http://localhost:8787/__keymesh_inspect | jq

# Or from the state file
npx @takk/keymesh inspect --state-file ./.keymesh-state.jsonl
```

## Notes

- The proxy is a thin pass-through for JSON request/response bodies. For
  streaming SSE responses (e.g., `stream: true` with OpenAI), use the
  library API in 1.0; streaming proxy lands in 1.1.
- Multiple `keymesh start` instances can run on different ports for
  different providers; they don't share state unless you point them at
  the same `--state-file`.
