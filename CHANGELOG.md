# Changelog

All notable changes to ComiCode are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
semantic versioning.

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
