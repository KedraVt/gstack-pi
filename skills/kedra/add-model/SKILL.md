---
name: add-model
description: Interactively register a new model (or provider) into pi's models.json so it becomes selectable in /model and usable by the agent. Use when the user wants to add a model from any OpenAI-compatible, Anthropic, Google, or local (Ollama/vLLM/LM Studio) endpoint. The agent asks for the needed details, then writes them to models.json automatically via the bundled helper script.
---

# Add Model to pi

This skill lets the user register a model just by describing it in chat. You (the agent)
collect the required information through a short Q&A, then write it to pi's model config
file (`~/.pi/agent/models.json`) using the bundled `upsert.mjs` helper — no manual JSON
editing, no restart needed (pi reloads `models.json` every time `/model` is opened).

## When to use
- "Add the agnes-2.0-flash model", "register a new model for pi".
- "Add my OpenRouter / OpenAI / Anthropic / Gemini key and model".
- "Wire up Ollama / vLLM / LM Studio / a local proxy as a provider".
- Any request that ends with the model being usable from `/model` or `--model`.

## Target file
Canonical location: `~/.pi/agent/models.json` (Windows: `%USERPROFILE%\.pi\agent\models.json`).
The helper writes there by default. To target a different file (e.g. a project-local
`models.json`), pass `--path <abs-path>` to `upsert.mjs`.

If the file does not exist yet, the helper creates it with a valid `{"providers":{}}` root.

## Workflow

### 1. Inspect the current config
Read the current `models.json` so you know which providers already exist and can offer
to reuse one instead of creating a duplicate.

```bash
node "<skill_dir>/upsert.mjs" --path "<abs-path-to-models.json>" --dry-inspect
```
(If the file is small, just `read` it directly instead.)

### 2. Collect the needed data
Ask the user for the following. Only `model id` is strictly required; use the defaults
from the schema (see `references/schema.md`) for anything the user does not specify.

**Provider** (group of models sharing one endpoint):
- `provider` name — e.g. `agnes`, `openai`, `anthropic`, `ollama`, `my-proxy`.
  Reuse an existing provider name if the model belongs to it.
- `baseUrl` — e.g. `https://apihub.agnes-ai.com/v1` (OpenAI-compatible), `https://generativelanguage.googleapis.com/v1beta` (Google). Not needed if reusing an existing provider that already has it.
- `api` — one of `openai-completions` (default for most), `openai-responses`, `anthropic-messages`, `google-generative-ai`.
- `apiKey` — how auth is supplied:
  - inline literal: `sk-...` (stored in plaintext — note the security tradeoff),
  - env var reference: `$AGNES_API_KEY` (recommended; resolved from the environment at request time),
  - shell command: `"!op read 'op://vault/item/key'"` (resolved at request time),
  - or omit and let the user configure auth later via `/login` / `auth.json` / `--api-key`.

**Model** (at least the `id`):
- `id` — exact model identifier sent to the API, e.g. `agnes-2.0-flash`, `gpt-5`, `llama3.1:8b`.
- `name` — optional human label (defaults to `id`).
- `reasoning` — `true` if the model supports extended thinking.
- `input` — `["text"]` (default) or `["text","image"]` if it accepts images.
- `contextWindow` — tokens (default 128000).
- `maxTokens` — max output tokens (default 16384).
- `cost` — optional `{ "input", "output", "cacheRead", "cacheWrite" }` per-million rates (default 0).
- `compat` — optional provider quirks (see `references/schema.md`), e.g. thinking format, `supportsDeveloperRole: false` for local servers.
- `thinkingLevelMap` — optional mapping of pi thinking levels to provider values.

### 3. Build the payload and run the helper
Assemble a JSON payload and pass it to the helper via stdin (or `--json`). Example:

```bash
node "<skill_dir>/upsert.mjs" --path "<abs-path-to-models.json>" --json '{
  "provider": "agnes",
  "providerConfig": {
    "baseUrl": "https://apihub.agnes-ai.com/v1",
    "api": "openai-completions",
    "apiKey": "$AGNES_API_KEY"
  },
  "model": {
    "id": "agnes-2.0-flash",
    "name": "agnes-2.0-flash",
    "reasoning": true,
    "input": ["text", "image"],
    "contextWindow": 512000,
    "maxTokens": 65500,
    "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 }
  }
}'
```

Behavior of `upsert.mjs`:
- If `provider` already exists, it merges `providerConfig` (only the keys you pass) into
  the existing provider and upserts the model by `id` (new values win).
- If `provider` is new, it creates it with the provided `providerConfig` and the model.
- It validates JSON, pretty-prints with 2-space indent, and never overwrites unrelated
  providers. Other keys in the file are preserved.

You may also write the payload to a temp file and use `--file <tmp.json>` instead of `--json`.

### 4. Verify
Re-read `models.json` (or run `--dry-inspect`) and show the user the added/updated block.
Confirm the model now appears and remind them to open `/model` (no restart needed). If you
used an env var for the key, remind the user to export it (or use `/login`) before selecting the model.

## Rules
- Never hand-edit `models.json` with `edit`/`write` — always go through `upsert.mjs` so the
  file stays valid JSON and other providers are preserved.
- Prefer reusing an existing provider over creating a duplicate with a different name.
- Recommend env-var (`$VAR`) or shell-command (`!cmd`) key storage over inline plaintext.
- If the user is unsure about a field, apply the schema default and tell them what you assumed.
- Keep the model `id` exactly as the upstream API expects it.

## Reference
Field-by-field schema, API types, and common `compat`/`thinkingLevelMap` examples:
see `references/schema.md` (bundle path: `<skill_dir>/references/schema.md`).
