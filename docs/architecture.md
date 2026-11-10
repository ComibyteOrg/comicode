# Architecture

This document describes how ComiCode is put together and why. It is intended for contributors and for users who need to reason about persistence, routing, and safety.

## Layer overview

```text
src/
├─ cli.ts                  Node entry point (warning filter, unhandled rejection/EPIPE)
├─ main.ts                 Commander program, run/resume/chat wiring, exit codes
├─ tui/                    Ink application and screens
│  ├─ app.tsx              Shell, navigation, palette, toasts, mount strategy
│  ├─ components.tsx       Shared UI primitives and confirmation dialog
│  └─ screens/             workspace, providers, models, history, usage, settings
├─ cli/                    Commander command modules and terminal output helpers
│  └─ commands/            providers, models, tasks, usage, settings, system
└─ core/
   ├─ agent/               Agent loop, context builder, tools, collaboration
   ├─ db/                  SQLite wrapper, schema, Store repositories
   ├─ project/             Project inspection, snapshots, command detection
   ├─ providers/           Definitions, presets, adapters, registry, errors, service
   ├─ routing/             Pure routing engine + store-backed Router
   ├─ safety/              Paths, files, shell, process, diff/patch, secrets
   ├─ security/            Redaction, masking, crypto, credential backends
   ├─ app.ts               App context (store + cwd + settings)
   ├─ paths.ts             Cross-platform data locations
   ├─ settings.ts          Zod settings schema/defaults
   └─ types.ts             Shared domain types
```

The CLI and TUI are thin presentation layers. The agent, routing engine, provider adapters, and safety layer are independent modules with unit tests.

## Agent lifecycle

`CodingAgent.run()` executes one bounded attempt:

1. **Prepare** — reload settings, clear expired limits, restore checkpoint cache/summary when resuming, verify project state, and append a resume note that tells the model to verify the working tree instead of assuming previous edits survived.
2. **Optional planning** — if collaboration is enabled and a planner profile is configured, ask it for a plan and persist the plan to the task.
3. **Loop** — up to `agent.maxSteps` (or the per-run `--max-steps`):
   - `ensureCandidate()` selects the next eligible profile/model through `Router`.
   - `buildContext()` assembles a token-budgeted context (system prompt, task state, project snapshot, relevant files, transcript, summaries, cached file notes).
   - The adapter streams a response.
   - Usage is recorded; success clears limits for that profile/model.
   - Tool calls are executed in order with confirmation gates.
   - If `task_complete` succeeds (or a completion summary exists), optional reviewer collaboration runs once, then the task completes.
   - Empty responses are nudged twice, then the task pauses.
4. **Halt** — on cancellation, exhausted candidates, repeated empty responses, or step exhaustion, write a checkpoint, persist diagnostics, and return `paused`/`failed`.
5. **Complete** — persist summary, phase `done`, completion time, and a final checkpoint.

Every tool call and message is appended to SQLite before the next model call. Checkpoints keep the last 30 per task (see `Store.createCheckpoint`) and include the transcript, context cache, summary, and recent tool output.

## Routing

There are two layers:

- **`core/routing/engine.ts`** — a pure function. Inputs: task type, profiles, models, active limits, policy, current selection, excluded candidates, and requirements. Output: an ordered chain plus blocked reasons. This is exhaustively unit-testable.
- **`core/routing/router.ts`** — loads store state, applies one-run policy overrides, resolves the saved/explicit selection, invokes the engine, and records routing events.

Candidate ordering:

1. Explicit profile/model selection (always first when usable).
2. Same-provider profiles, including other models of the current profile.
3. Other providers, preferred providers first, then free classifications.
4. Final score accounts for provider preference, free access, same-model matches, default-model status, coding/reasoning suitability, context window, output limit, and profile priority.

Filters: disabled/excluded profiles, task capability requirements (tools, vision, minimum context), model availability, user access overrides, active limits, paid policy, and unknown-access policy.

When a candidate fails, `handleFailure()`:

- classifies the error;
- records an attempt, profile error, and health event;
- retries retryable categories with backoff (honoring reset times);
- persists a limit for quota/outage/auth/permission/billing/model/tool failures;
- excludes the candidate for the rest of the run;
- returns to the loop, which selects the next candidate or pauses.

Explicit selections bypass the paid/unknown policy gate, but are still subject to active limits and capability checks that cannot be satisfied.

## Provider adapters

`ProviderAdapter` has three operations:

```ts
interface ProviderAdapter {
  readonly kind: ProviderKind;
  readonly supportsStreaming: boolean;
  chat(context, request, options?): Promise<ChatResponse>;
  listModels(context): Promise<DiscoveredModel[]>;
  testConnection(context): Promise<TestConnectionResult>;
}
```

`createAdapter(profile)` chooses a transport:

- Gemini provider or `config.apiStyle === 'gemini'` → `GeminiAdapter`.
- Everything else → `OpenAICompatibleAdapter`.

Both adapters accept a custom `baseUrl`, paths, auth header/prefix, and extra headers from profile configuration. There is no privileged "custom" code path; custom platforms use exactly the same transports.

`createProfileContext()` resolves the credential (environment variable first, then credential store, then no-auth if allowed) and supplies the base URL. Tests inject `adapterFactory` and `contextFactory` into `CodingAgent` to avoid network access.

See [provider-adapters.md](provider-adapters.md).

## Persistence

SQLite is accessed through Node's built-in `node:sqlite`. Because bundlers can rewrite a static `node:sqlite` import to a bare `sqlite` package, `database.ts` resolves it with `process.getBuiltinModule('node:sqlite')`.

Tables:

| Table               | Contents                                                                |
| ------------------- | ----------------------------------------------------------------------- |
| `meta`              | Schema version and UI selection keys                                    |
| `settings`          | JSON settings document                                                  |
| `provider_profiles` | Non-secret profile configuration and health timestamps                  |
| `models`            | Catalog metadata, access classification, prices, capabilities           |
| `tasks`             | Request, status, phase, plan, changed/relevant files, attempts, summary |
| `task_messages`     | Ordered transcript including tool calls/results                         |
| `checkpoints`       | Context cache, summary, transcript snapshot, recent tool output         |
| `usage_events`      | Per-call tokens, estimated cost, source                                 |
| `provider_limits`   | Active/reset quotas by profile and model (`*` = profile-wide)           |
| `routing_events`    | Selection transitions and reasons                                       |
| `provider_health`   | Connection test/health results                                          |

Custom endpoint models are scoped by `profile_id` so two custom platforms can both expose `my-model` without colliding. Standard providers share a provider-wide catalog.

Credentials are _never_ stored in these tables. Profile rows contain only `api_key_env` and non-secret endpoint configuration.

## Safety model

- **Paths** — `PathGuard` resolves real paths, rejects traversal and symlink escapes, and confines file tools to the project root.
- **Files** — ignore-aware listing, binary detection, size limits, secret-file patterns, and private-key detection.
- **Shell** — commands are inspected for danger patterns, run with a sanitized environment, a timeout, and process-tree termination; dangerous commands need a separate opt-in.
- **Patches** — unified diff application is strict: context mismatch aborts without writing a partial file. Diffs are shown before approval.
- **Approvals** — writes, deletes, commands, dangerous commands, and secret reads require `confirm` unless auto-approved by run flag or settings.
- **Secrets** — known secrets are registered for redaction; token-shaped strings and credential JSON fields are scrubbed from errors and logs; output and exports mask keys.

## Context management

`ContextBuilder` enforces a token budget derived from the active model's context window (or a configured override). It:

- caches file contents by hash to avoid resending unchanged files;
- summarizes older turns and prunes low-value history;
- includes task state, plan, changed/relevant files, detected commands, and project snapshot;
- supports a reduced-context retry after a context-length error.

## Configuration

Settings live in `src/core/settings.ts` with Zod defaults and validation. CLI/TUI settings paths mirror the schema (for example `routing.allowPaid`, `agent.maxSteps`, `agent.collaboration.enabled`). Settings are deep-merged with defaults on load, so new fields do not break existing databases.

Environment overrides:

| Variable                       | Effect                            |
| ------------------------------ | --------------------------------- |
| `COMICODE_HOME`                | Data directory                    |
| `COMICODE_DB_PATH`             | Explicit SQLite path              |
| `COMICODE_DEBUG`               | Print stack traces for CLI errors |
| `NO_COLOR` / `FORCE_COLOR`     | Color control                     |
| `COMICODE_REAL_PROVIDER_TESTS` | Enables manual integration tests  |

## Extension points

- Add a provider preset in `providers/definitions.ts`.
- Add curated model metadata in `providers/catalog.ts`.
- Add a transport in `providers/` and register it in `registry.ts`.
- Add a tool definition/executor branch in `agent/tools/`.
- Add a settings field in `settings.ts` and optionally to `SETTING_PATHS`.
- Add a CLI command module and register it in `main.ts`.
- Add an Ink screen and register it in `tui/components.tsx` + `tui/app.tsx`.

Keep new behavior covered by tests that do not need real credentials.
