# models.json schema reference (pi)

Target file: `~/.pi/agent/models.json` (Windows: `%USERPROFILE%\.pi\agent\models.json`).
Root shape: `{ "providers": { "<providerKey>": <provider>, ... } }`.
Reloaded automatically each time `/model` is opened — no restart needed.

## Supported `api` types
| `api` | Use for |
|-------|---------|
| `openai-completions` | OpenAI Chat Completions + most OpenAI-compatible servers (Agnes, OpenRouter, vLLM, LM Studio, Ollama `/v1`, custom proxies) |
| `openai-responses` | OpenAI Responses API |
| `anthropic-messages` | Anthropic Messages API + compatible proxies |
| `google-generative-ai` | Google Generative AI (requires `baseUrl`, e.g. `https://generativelanguage.googleapis.com/v1beta`) |

Set `api` at provider level (applies to all models) or on a single model to override.

## Provider fields
| Field | Description |
|-------|-------------|
| `baseUrl` | API endpoint base URL (e.g. `https://apihub.agnes-ai.com/v1`) |
| `api` | API type (see table above) |
| `apiKey` | Optional. Literal (`sk-...`), env var (`$VAR` / `${VAR}`), or shell command (`"!cmd"`) resolved at request time. Omit to configure auth via `/login`, `auth.json`, or `--api-key`. |
| `headers` | Custom headers (same value resolution as `apiKey`) |
| `authHeader` | `true` to auto-add `Authorization: Bearer <apiKey>` |
| `compat` | Provider-level compatibility quirks (see below) |
| `models` | Array of model configs |
| `modelOverrides` | Per-model overrides for built-in/extension models on this provider |

### `apiKey` / `headers` value resolution
- Shell command: `"!command"` — whole value executed, stdout used.
- Env interpolation: `"$VAR"` / `"${VAR}"` (inside larger literals too).
- Escapes: `"$$"` -> literal `$`, `"$!"` -> literal `!`.
- Plain literal otherwise (use `$VAR` form for env vars).

## Model fields
| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `id` | Yes | — | Model identifier sent to the API |
| `name` | No | `id` | Human-readable label; also used for matching |
| `api` | No | provider `api` | Override provider API for this model |
| `reasoning` | No | `false` | Supports extended thinking |
| `thinkingLevelMap` | No | omitted | Maps pi thinking levels (`off`/`minimal`/`low`/`medium`/`high`/`xhigh`/`max`) to provider values; `null` = unsupported/hidden |
| `input` | No | `["text"]` | `["text"]` or `["text","image"]` |
| `contextWindow` | No | `128000` | Context window in tokens |
| `maxTokens` | No | `16384` | Max output tokens |
| `cost` | No | all 0 | `{ "input", "output", "cacheRead", "cacheWrite" }` per-million rates |
| `compat` | No | provider `compat` | Model-level compatibility overrides (merged with provider `compat`) |

## `compat` — common fields
| Field | Applies to | Effect |
|-------|-----------|--------|
| `supportsDeveloperRole` | openai | `false` sends system prompt as `system` instead of `developer` (local servers) |
| `supportsReasoningEffort` | openai | `false` omits `reasoning_effort` |
| `maxTokensField` | openai | `"max_tokens"` vs `"max_completion_tokens"` |
| `supportsUsageInStreaming` | openai | `false` omits `stream_options.include_usage` |
| `thinkingFormat` | openai | `reasoning_effort` \| `openrouter` \| `deepseek` \| `together` \| `zai` \| `qwen` \| `chat-template` \| `qwen-chat-template` |
| `chatTemplateKwargs` | openai | `chat_template_kwargs` for `chat-template` thinking, e.g. `{ "enable_thinking": { "$var": "thinking.enabled" } }` |
| `supportsEagerToolInputStreaming` | anthropic | `false` uses legacy beta header |
| `forceAdaptiveThinking` | anthropic | `true` sends adaptive thinking payload |
| `allowEmptySignature` | anthropic | `true` replays empty thinking signatures |
| `cacheControlFormat` | openai | `"anthropic"` for Anthropic-style `cache_control` markers |

## Minimal examples

Local (Ollama) — only `id` required per model:
```json
{
  "providers": {
    "ollama": {
      "baseUrl": "http://localhost:11434/v1",
      "api": "openai-completions",
      "apiKey": "ollama",
      "models": [{ "id": "llama3.1:8b" }]
    }
  }
}
```

OpenAI-compatible cloud (Agnes-style thinking via chat_template_kwargs):
```json
{
  "providers": {
    "agnes": {
      "baseUrl": "https://apihub.agnes-ai.com/v1",
      "api": "openai-completions",
      "apiKey": "$AGNES_API_KEY",
      "models": [
        {
          "id": "agnes-2.0-flash",
          "name": "agnes-2.0-flash",
          "reasoning": true,
          "input": ["text", "image"],
          "contextWindow": 512000,
          "maxTokens": 65500,
          "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 },
          "compat": {
            "thinkingFormat": "chat-template",
            "chatTemplateKwargs": { "enable_thinking": { "$var": "thinking.enabled" } }
          }
        }
      ]
    }
  }
}
```

Google AI Studio:
```json
{
  "providers": {
    "my-google": {
      "baseUrl": "https://generativelanguage.googleapis.com/v1beta",
      "api": "google-generative-ai",
      "apiKey": "$GEMINI_API_KEY",
      "models": [{ "id": "gemma-4-31b-it", "input": ["text","image"], "contextWindow": 262144, "reasoning": true }]
    }
  }
}
```
