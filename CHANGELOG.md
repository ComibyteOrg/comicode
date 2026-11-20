# Changelog

All notable changes to ComiCode are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
semantic versioning.

## [0.2.5] - 2026-11-21

### Fixed

- `comicode update` now invokes npm through `node.exe` and `npm-cli.js` instead
  of spawning `npm.cmd` without a shell, which silently failed on Windows.

## [0.2.4] - 2026-11-21

### Changed

- Removed all keyboard hint strips from the header, footer and composer to
  give the transcript more height.
- Compressed the mode/model/token status into a single line.
- Team sidebar rows have more vertical spacing and a `CURRENT:` indicator.
- Team credit budget is much larger so runs no longer pause in the middle.

### Fixed

- `/tasks`, `/history` and `/session` open the task-history popup again; a new
  informational command no longer overrides them.
- Composer text wraps within the available pane width.

## [0.2.3] - 2026-11-20

### Fixed

- Native terminal text selection works by default (mouse capture is now off).
- Team sidebar and activity panel are narrower, and the activity panel is
  collapsible (F7), leaving more room for the transcript.
- Short prompts such as "hi" no longer assemble a full agent team.
- Queued messages are shown in the composer and the first can be pulled back
  for editing with alt+up before it runs.

## [0.2.2] - 2026-11-20

### Fixed

- Composer text now wraps to the available pane width instead of running in a
  single truncated line when the team sidebar and activity panel are visible.

## [0.2.1] - 2026-11-20

### Fixed

- `comicode update` now installs GitHub release tarballs instead of `github:`
  specs, avoiding Windows `ENOTEMPTY`/dangling-junction failures during git
  dependency preparation.
- Documented the manual recovery steps in the README.

## [0.2.0] - 2026-11-20

### Added

- Mission-control terminal workspace: 14-agent sidebar, live activity feed,
  agent inspector, task board, keyboard navigation and slash commands, all
  driven by real runtime events.
- Typed bounded event bus (`agent.*`, `task.*`, `tool.*`) with restart recovery.
- 14-agent registry including real Database Architect and Mobile Developer
  runtime roles; Team Lead coordinates without making a model call.
- Structured task contracts with assignees, dependencies, priorities and
  expected vs actual results.
- Exact-model cross-provider routing: the same model is tried on other
  connected APIs before different models.
- Automatic specialist selection in Auto mode and revisitable multi-agent
  teams for multi-part prompts, with a shared credit budget and stage compaction.
- Character-level and whole-message terminal highlighting with clipboard
  fallback, plus live follow-up prompts during a run.
- Installable plugins, image generation and headed browser inspection with
  user highlighting.
- Optional web dashboard (`comicode serve`) reusing the root install.

### Changed

- Team runs persist event snapshots and contracts and resume from their queue.
- Selection mode no longer arms the app quit shortcut.

## [Unreleased]

### Added

- Initial public preview of ComiCode.
- Multi-provider profiles for Gemini, Groq, OpenRouter, OpenAI, and arbitrary
  OpenAI-compatible or Gemini-compatible endpoints.
- Custom endpoint configuration: base URL, API style, auth header/prefix,
  extra headers, chat and model paths, max-token parameter, no-auth mode,
  context-window override, discovery/streaming toggles, and manual model IDs.
- Provider presets for DeepSeek, Mistral, xAI, Together, Fireworks, Cerebras,
  Ollama, LM Studio, vLLM, Azure, and LiteLLM.
- Quota-aware routing: explicit model, same-provider profiles, cross-provider
  fallback, free-first ranking, capability matching, paid/unknown policy gates,
  and safe pause/resume.
- Error classifier for rate limits, daily quotas, outages, network failures,
  auth failures, permission errors, missing models, unsupported tool calling,
  context-length errors, billing restrictions, cancellations, and unknowns.
- `Retry-After`, rate-limit reset header, and Gemini retry-delay parsing with
  exponential backoff and jitter. Reset times are never invented.
- Persistent SQLite tasks, transcripts, attempts, usage events, provider
  limits, routing events, health checks, resume summaries, and checkpoints.
- Agent tool loop with project inspection, search, file operations, unified
  patches, command/test/lint/build execution, diffs, plans, and completion.
- Permission-gated writes, deletes, commands, dangerous commands, and secret
  reads, with diff previews and approval dialogs.
- Safety layer: path guards, traversal and symlink checks, ignore-aware file
  listing, binary detection, secret-file detection, sanitized environments,
  timeouts, and process-tree termination.
- Credential storage using Windows DPAPI, macOS Keychain, Linux Secret Service,
  or an AES-256-GCM encrypted file fallback, plus environment-variable keys.
- Secret masking, fingerprinting, and redaction in logs, errors, and output.
- Ink terminal UI with workspace, providers, models, history, usage, settings,
  command palette, confirmations, and live routing/usage state.
- CLI commands for run, resume, chat, providers, models, auth, tasks, history,
  usage, limits, settings, config, data, doctor, init, and completion.
- Unit tests for routing, agent quota failover and resume, error classification,
  credential redaction/masking, unified diffs/patches, persistence, custom
  endpoint transport, and headless TUI input/navigation.
- Manual real-provider integration checks gated by environment variables.
- Global installation from GitHub or a packed tarball, with a `prepare` build so
  gitignored `dist/` output is generated at install time. Detailed
  cross-platform PATH and troubleshooting guidance in `docs/install.md`.
- Documentation, contributor guides, security policy, issue/PR templates, and CI.

### Changed

- Minimum Node.js version is now 22.13, the first release where `node:sqlite`
  runs without `--experimental-sqlite`.
- Terminal UI rebuilt around a full-screen alternate buffer with an
  "obsidian editorial" theme, pill navigation, rounded panels, a single-line
  composer, command completion/history, and a line-budgeted transcript that
  keeps the newest output visible.
- Passing Enter now submits on both `\r` and `\n`, and pasted line breaks are
  flattened instead of creating new lines in the composer.
- Screens cycle with `←`/`→` or `tab`; `ctrl+1..6` was removed because
  terminals encode those chords as `ctrl+a..f`. `/workspace` returns home.
- Ink 8, React 19, Zod 4, and Vitest 5. Production dependency audit is clean.
- Removed the unused `ink-text-input` dependency in favor of a controlled prompt
  component with predictable key handling.

### Fixed

- Stale quota/limit rows are cleared when a profile is refreshed, reconnected,
  or its credentials are saved. An explicitly selected model also gets one
  attempt past a persisted cooldown instead of showing a false "quota reached"
  state.
- `xhigh` and other effort profiles now use the model's published output limit
  or the full effort cap instead of silently falling back to a 4096-token
  budget.
- Free-model discovery now classifies Gemini/Groq profiles and local or
  free-tier custom endpoints, recognizes `:free`/zero-priced models, and
  refreshes access metadata on re-discovery. The picker groups by provider,
  sorts free first, and keeps the `free` badge visible on the selected row.
- Fallback tries free models on the same provider before paid ones, rotates
  every API key (including resetting to key 1 for the next model), and moves
  across providers only after about five same-provider failures. A provider
  switch asks once, remembers approval, and appends a context handoff note.
- The transcript scrolls by terminal line with a clamped offset and line
  window scrollbar. `ctrl+y` enters select/copy mode, releasing mouse capture
  so text can be highlighted anywhere; `esc` or `ctrl+y` exits.
- The header model control always reads `Change model` instead of duplicating
  the selected model name.
