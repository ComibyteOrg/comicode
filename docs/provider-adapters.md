# Provider adapters and custom platforms

ComiCode is designed around a small transport contract, not a fixed vendor list. Any platform that speaks the OpenAI chat-completions API or the Gemini `generateContent` API can be used by creating a profile with the right base URL and endpoint settings.

## The adapter contract

```ts
export interface AdapterContext {
  profile: ProviderProfile;
  apiKey: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch; // injection point for tests/embedding
  baseUrl?: string; // overrides profile.baseUrl when provided
}

export interface ProviderAdapter {
  readonly kind: ProviderKind;
  readonly supportsStreaming: boolean;
  chat(context: AdapterContext, request: ChatRequest, options?: ChatOptions): Promise<ChatResponse>;
  listModels(context: AdapterContext): Promise<DiscoveredModel[]>;
  testConnection(context: AdapterContext): Promise<TestConnectionResult>;
}
```

`createAdapter()` in `src/core/providers/registry.ts` resolves the transport:

- `providerId === 'gemini'` or `config.apiStyle === 'gemini'` → `GeminiAdapter`
- otherwise → `OpenAICompatibleAdapter`

Built-in provider IDs (`gemini`, `groq`, `openrouter`, `openai`) are conveniences with default URLs, auth style, documentation, and curated model metadata. They are **not** separate transports. A custom profile with `apiStyle: 'openai-compatible'` goes through exactly the same code as an OpenAI profile.

## OpenAI-compatible transport

`src/core/providers/openai-compatible.ts` implements:

- `POST {baseUrl}{chatPath}` with model, messages, `stream`, tools (`function` schema), tool choice, temperature, and the configured max-token parameter.
- SSE streaming when an `onText` handler is supplied and streaming is enabled; otherwise a single JSON response.
- Tool-call decoding from OpenAI `tool_calls`, including streamed argument fragments.
- Usage decoding from `prompt_tokens` / `completion_tokens` / `total_tokens` (and `input_tokens` / `output_tokens` variants).
- `GET {baseUrl}{modelsPath}` discovery with filtering of obvious non-chat models (embeddings, TTS, image generation, moderation, rerankers).
- Context/output/pricing/vision extraction from common model-list fields.
- Error classification for non-2xx responses, including `Retry-After`, rate-limit reset headers, and provider JSON error shapes.

Headers are built as:

```text
content-type: application/json
accept: application/json
<extra headers, sanitized>
<authHeader>: <authPrefix><apiKey>
```

OpenRouter additionally receives `HTTP-Referer` and `X-Title` when the user has not supplied them.

## Gemini-compatible transport

`src/core/providers/gemini.ts` uses the Google Generative Language shape:

- `POST {baseUrl}/models/{model}:generateContent` (or `:streamGenerateContent` for streaming).
- Gemini `contents`, `systemInstruction`, `tools.functionDeclarations`, and generation config.
- Tool schema conversion from JSON Schema to Gemini's subset; unsupported keywords are dropped rather than sent blindly.
- Usage from `usageMetadata.promptTokenCount` / `candidatesTokenCount`.
- Model discovery from `/models`.
- Gemini error bodies, including `RetryInfo.retryDelay`.

`authHeader` defaults to `x-goog-api-key` for Gemini profiles; `authPrefix` is empty.

## Endpoint configuration fields

Stored in `provider_profiles.config_json`, validated by `EndpointConfigSchema`, and exportable because none of these fields are secret.

| Field                    | Default             | Meaning                                                      |
| ------------------------ | ------------------- | ------------------------------------------------------------ |
| `apiStyle`               | `openai-compatible` | `openai-compatible` or `gemini`                              |
| `allowNoAuth`            | `false`             | Permit requests without a key (local servers)                |
| `authHeader`             | `Authorization`     | Header used to send the credential                           |
| `authPrefix`             | `Bearer `           | Prefix before the key; use `""` for headers like `api-key`   |
| `extraHeaders`           | `{}`                | Additional non-secret headers                                |
| `chatPath`               | `/chat/completions` | Chat endpoint path (OpenAI-compatible)                       |
| `modelsPath`             | `/models`           | Model-list path                                              |
| `maxTokensParam`         | `max_tokens`        | `max_tokens` or `max_completion_tokens`                      |
| `supportsModelDiscovery` | `true`              | Call the model-list endpoint                                 |
| `supportsStreaming`      | `true`              | Allow SSE streaming                                          |
| `testWithChat`           | `false`             | Allow a tiny chat request when discovery is disabled         |
| `streamUsage`            | `false`             | Request `stream_options.include_usage`                       |
| `contextWindowOverride`  | `null`              | Fallback context size when the endpoint does not publish one |
| `preset`                 | `null`              | Human-readable preset name                                   |
| `notes`                  | `null`              | Free-form note shown in profile details                      |

`extraHeaders` are sanitized on every request: only `[A-Za-z0-9-]` header names survive, values are stripped of newlines and capped at 500 characters, and `Authorization`, `api-key`/`api_key`, and `Cookie` headers are removed to prevent accidental credential leakage. The profile key is always sent through `authHeader`.

## Creating profiles

### CLI

```bash
comicode providers add \
  --provider custom \
  --name "My platform" \
  --base-url https://api.example.com/v1 \
  --api-key-env MY_PLATFORM_KEY \
  --default-model coder-large \
  --api-style openai-compatible \
  --access unknown
```

Use `--auth-header`, `--auth-prefix`, `--chat-path`, `--models-path`, `--max-tokens-param`, `--extra-header "Name: Value"`, `--context-window`, `--no-auth`, `--no-discovery`, `--no-streaming`, `--test-chat`, `--priority`, `--disabled`, `--test`, and `--refresh` as needed.

Prefer `--api-key-env` (or the interactive prompt) over `--api-key`; command-line arguments can end up in shell history.

### TUI

Providers screen (`/providers` in the workspace, or cycle with `←`/`→`) → `a` → choose a built-in provider, a preset, "Any OpenAI-compatible endpoint", or "Any Gemini-compatible endpoint" → fill in the wizard. The key input is masked, and the final review shows a masked credential.

### Edit, test, refresh

```bash
comicode providers edit "My platform" --base-url https://new.example.com/v1
comicode providers test "My platform"
comicode providers refresh "My platform"
comicode providers show "My platform"
```

## Local and self-hosted endpoints

### Ollama

Ollama exposes an OpenAI-compatible API under `/v1`:

```bash
comicode providers add \
  --provider custom --name "Ollama local" \
  --base-url http://localhost:11434/v1 \
  --no-auth --access user-free --default-model qwen2.5-coder:14b \
  --refresh
```

### LM Studio

```bash
comicode providers add \
  --provider custom --name "LM Studio" \
  --base-url http://localhost:1234/v1 \
  --no-auth --access user-free --default-model local-model \
  --refresh
```

### vLLM / LiteLLM

Use the server's `/v1` URL. If the gateway requires a bearer token, pass `--api-key-env`; if not, `--no-auth`.

### Azure OpenAI-style endpoints

Azure routes by deployment path and uses `api-key` rather than `Authorization: Bearer`:

```bash
comicode providers add \
  --provider custom --name "Azure GPT" \
  --base-url https://my-resource.openai.azure.com \
  --auth-header api-key --auth-prefix "" \
  --chat-path "/openai/deployments/my-deployment/chat/completions?api-version=2024-10-21" \
  --models-path "/openai/models?api-version=2024-10-21" \
  --api-key-env AZURE_OPENAI_KEY \
  --default-model my-deployment \
  --access user-paid
```

Query strings in `chatPath`/`modelsPath` are preserved by URL joining.

### Gateways with custom headers

```bash
comicode providers add \
  --provider custom --name "Team gateway" \
  --base-url https://ai.internal.example/v1 \
  --extra-header "X-Organization: platform-team" \
  --extra-header "X-Route: coding" \
  --api-key-env TEAM_AI_KEY \
  --default-model team-coder
```

## Discovery unavailable? Add models manually

Some gateways do not implement `/models`, or return a shape ComiCode cannot parse.

```bash
comicode providers add ... --no-discovery --default-model my-model
comicode models add "My platform" my-model --default
comicode models select my-model
```

`--test-chat` permits `providers test` to make one tiny chat request when discovery is disabled; it is off by default because it can consume quota or incur cost.

## Access classification

Each model/profile has an access classification used by routing:

| Classification   | Meaning                                                               |
| ---------------- | --------------------------------------------------------------------- |
| `free-confirmed` | Explicitly confirmed free (for example OpenRouter `:free`/zero price) |
| `free-tier`      | Curated provider free tier; limits can change                         |
| `paid`           | Paid model; blocked for fallback unless `allowPaid`                   |
| `user-free`      | The user says this profile/key is free for them; preferred            |
| `user-paid`      | The user says this is paid; blocked unless allowed                    |
| `unknown`        | Unknown pricing/access; allowed only if `allowUnknownAccess`          |
| `unavailable`    | Never routed                                                          |

Override a model's classification:

```bash
comicode models classify my-model user-free
comicode models classify my-model auto
```

Explicitly selected models are honored even when paid or unknown. A persisted cooldown is bypassed for the first attempt so a stale limit cannot block a connected provider; capability requirements still apply, and a real failure records a new limit. Discovery classifies Gemini/Groq profiles as `free-tier`, recognizes local/free-tier endpoint hosts, and treats `:free` or zero-priced models as `free-confirmed`. The model picker groups rows by provider and keeps a leading `free` badge visible even on the selected row.

## Error handling contract

Adapters must throw `ProviderError` (or an error that `classifyThrown` can classify) with:

- `category` — one of `rate_limit`, `daily_quota`, `provider_outage`, `network`, `invalid_api_key`, `auth_failure`, `permission_error`, `model_unavailable`, `unsupported_tool_calling`, `context_length`, `billing_restriction`, `invalid_request`, `cancelled`, `unknown`.
- `status` — HTTP status when known.
- `retryAfterAt` — absolute ISO time from `Retry-After` or Gemini `RetryInfo`.
- `resetAt` — absolute ISO time from rate-limit reset headers.
- `providerCode` — provider error code when available.

Never invent a reset time. If the provider supplies none, the agent uses a short local cooldown (2 minutes for transient limits, 30 minutes for daily quota/billing) and the UI says the reset time is unknown.

## Testing real providers

Unit tests inject fake adapters and never touch the network. Manual checks are gated:

```bash
# bash
export COMICODE_REAL_PROVIDER_TESTS=1
export GEMINI_API_KEY=...        # or GROQ_API_KEY / OPENROUTER_API_KEY / OPENAI_API_KEY
export COMICODE_CUSTOM_BASE_URL=...   # optional
export COMICODE_CUSTOM_API_KEY=...
export COMICODE_CUSTOM_MODEL=...
npm run test:integration
```

These tests create profiles in an in-memory database with `apiKeyEnv` pointing at the environment, then run `testProfileConnection()` and a minimal completion if a model is configured. They are skipped when the gate or credentials are absent, so CI never needs secrets.

To test a custom endpoint manually:

```bash
comicode providers add --provider custom --name "Real check" \
  --base-url "$COMICODE_CUSTOM_BASE_URL" --api-key-env COMICODE_CUSTOM_API_KEY \
  --default-model "$COMICODE_CUSTOM_MODEL"
comicode providers refresh "Real check"
comicode providers test "Real check"
comicode run "Reply with the single word: ok" -p "Real check" --max-steps 1
```

## Troubleshooting

| Symptom                             | Likely cause                             | Fix                                                                       |
| ----------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------- |
| `No API key is configured`          | Key not stored and no env var            | `comicode auth set <profile>` or `--api-key-env`                          |
| `Environment variable X is not set` | Env var not visible to this shell        | Export it, or store the key                                               |
| `model not found` / 404             | Wrong model ID or base URL               | Check `comicode models list`, add manually                                |
| 401 with a valid key                | Wrong auth header/prefix                 | Try `--auth-header api-key --auth-prefix ""` or `Authorization`/`Bearer ` |
| Discovery returns nothing           | Gateway lacks `/models`                  | Add models manually or set `--no-discovery`                               |
| Streaming parse errors              | Gateway streams a non-SSE format         | Try `--no-streaming`                                                      |
| Azure errors                        | Missing `api-version` or deployment path | Include the query string in `--chat-path`                                 |
| Local server refuses connection     | Wrong port or host                       | Verify with `curl http://localhost:PORT/v1/models`                        |
| Paid model blocked                  | `routing.allowPaid` is off               | Use `--allow-paid` for one run or enable it deliberately                  |
| 429 every request                   | Real quota/rate limit                    | Check reset time; add another profile/provider; wait                      |

Run `comicode doctor --test` for a diagnostic report, and `COMICODE_DEBUG=1` for stack traces.

## Adding a new transport

If a platform is neither OpenAI- nor Gemini-compatible:

1. Implement `ProviderAdapter` in `src/core/providers/`.
2. Register it in `registry.ts`, keyed by provider kind or a new `apiStyle`.
3. Extend `EndpointConfigSchema` only for genuinely non-secret configuration.
4. Classify all failures through `classifyProviderError`.
5. Add tests with a stubbed `fetchImpl` covering URL, headers, body, streaming, tool calls, usage, discovery, and error paths.
6. Document the endpoint fields and a working example here.
