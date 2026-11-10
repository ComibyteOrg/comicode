# Contributing to ComiCode

Thanks for helping improve ComiCode. This project aims to be a dependable, vendor-neutral coding agent: correctness, honest error handling, and user safety matter more than adding surface area quickly.

## Before you start

- Search existing issues and pull requests.
- For large changes, open an issue first so the approach can be discussed.
- Never include real API keys, tokens, database files, or private project code in issues, logs, tests, or commits.

## Development setup

Requirements: Node.js 22.13+ (Node 24 recommended), npm 10+.

```bash
git clone https://github.com/YOUR_USERNAME/comicode.git
cd comicode
npm install
npm run typecheck
npm test
npm run build
node dist/cli.js --version
```

Useful commands:

| Command                    | Purpose                                         |
| -------------------------- | ----------------------------------------------- |
| `npm run dev -- run "..."` | Run the TypeScript entry point without building |
| `npm run typecheck`        | TypeScript strict check                         |
| `npm run lint`             | ESLint                                          |
| `npm run format`           | Prettier write                                  |
| `npm test`                 | Vitest unit/integration suite                   |
| `npm run test:watch`       | Watch mode                                      |
| `npm run build`            | Bundle `dist/cli.js` with tsup                  |
| `npm run verify`           | Typecheck + lint + tests + build                |

For manual testing, point ComiCode at a disposable home:

```bash
# PowerShell
$env:COMICODE_HOME="$env:TEMP\comicode-dev"
node dist/cli.js doctor

# bash
COMICODE_HOME=/tmp/comicode-dev node dist/cli.js doctor
```

## What to test

- **Unit tests** live in `tests/*.test.ts` and use in-memory SQLite (`openStore(':memory:')`), temporary project directories, and injected fake adapters. They must never require real credentials or network access.
- **Real-provider tests** live in `tests/integration/` and are skipped unless `COMICODE_REAL_PROVIDER_TESTS=1` and the relevant key is present.
- Add regression tests for every bug fix. For routing changes, cover explicit selection, same-provider fallback, cross-provider fallback, active limits, paid/unknown blocking, and pause/resume behavior.

## Adding or changing a provider adapter

1. Read `docs/provider-adapters.md` and the `ProviderAdapter` contract in `src/core/providers/adapter.ts`.
2. Prefer the existing OpenAI-compatible or Gemini-compatible transport with a new profile configuration over a one-off adapter.
3. Preserve credential redaction: never log request headers or full error bodies without `redactSecrets`.
4. Classify failures through `src/core/providers/errors.ts`. Do not guess reset times.
5. Add adapter tests with a stubbed `fetchImpl`; verify URL construction, auth header/prefix, extra headers, request body shape, tool-call decoding, usage decoding, and error classification.

## Coding standards

- TypeScript strict mode; avoid `any`. Use `unknown` and narrow.
- Keep provider-specific behavior behind adapters and profile configuration.
- Do not store secrets in SQLite, logs, exports, or task messages.
- Prefer small pure functions in `src/core/routing`, `src/core/safety`, and `src/core/security`; they are the easiest pieces to test.
- Preserve cross-platform behavior (Windows paths, CRLF, shell quoting, process killing).
- Run `npm run format` before committing.
- Do not commit generated `dist/`, database files, `.env` files, or logs.

## Commit and pull request guidance

- Keep commits focused and explain the _why_ in the message.
- A pull request should state the problem, the approach, user-visible behavior changes, and how it was tested.
- Include screenshots or terminal captures for TUI changes.
- Update `README.md`, `docs/`, and `CHANGELOG.md` when behavior or setup changes.
- Confirm `npm run verify` passes locally.

## Security-sensitive changes

Changes to credential storage, redaction, path safety, shell execution, patch application, or permission gating need extra review. Explain the threat model and add negative tests (for example, traversal attempts, symlink escapes, context mismatch, dangerous commands).

## License

By contributing, you agree that your contribution is licensed under the MIT License.
