# ComiCode

An open-source AI coding agent for your terminal. It reads and edits your
project, runs commands and tests, keeps every task resumable, and keeps
working when a provider hits its quota by switching to your next connected
model — with your approval.

![ComiCode workspace](docs/screenshots/screen-1.png)

Works with Gemini, Groq, OpenRouter, OpenAI, and **any OpenAI- or
Gemini-compatible endpoint** — including local servers like Ollama and
LM Studio with no API key.

> Repository: https://github.com/ComibyteOrg/comicode

## Requirements

- Node.js **22.13+** (Node 24 recommended)
- Windows, macOS, or Linux
- One provider API key, or a local no-auth endpoint

## Install

```bash
git clone https://github.com/ComibyteOrg/comicode.git
cd comicode
npm install
npm install -g .    # builds and installs the global command
# or: npm link      # keeps the command pointed at this checkout
comicode --version
```

Prefer not to clone? Install straight from GitHub:

```bash
npm install -g github:ComibyteOrg/comicode
```

The install is small — the CLI bundle is under 1 MB with a handful of
lightweight dependencies, and no browser is ever downloaded.

Then just run it — `comicode` opens the interactive workspace. On first
launch it walks you through connecting a provider.

## First run: connect a provider

ComiCode needs at least one provider before it can answer.

```bash
# Interactive — easiest: pick a provider, paste your key, done
comicode connect

# Or from the CLI directly (key is stored in your OS credential store):
comicode providers add --provider gemini --name "Gemini personal"
comicode providers add --provider groq   --name "Groq free"
```

Then discover the models your key can use:

```bash
comicode models refresh
comicode models list --free
```

![Provider selection](docs/screenshots/screen-2.png)

## Use it

**Interactive (recommended):** run `comicode` in any project folder.

- Type what you want — "fix the failing test", "add a settings page" — and
  the agent inspects your code, plans, edits files, runs checks, and
  summarizes. Every prompt continues the same task thread.
- `ctrl+m` picks the model · `tab`/`shift+tab` or `/mode` cycles agent
  modes · `ctrl+k` opens the command palette · type `/` for commands.
- While it works you can keep typing — messages queue and run in order.
- Approvals appear as a small picker in the input area: arrows + Enter, or
  click. `y`/`a`/`n` shortcuts still work.
- Scroll the transcript with the mouse wheel, `PgUp`/`PgDn`, or `ctrl+j`
  to jump between your questions.

![Agent mode selection](docs/screenshots/screen-3.png)

**One-shot from the shell:**

```bash
comicode run "Find the failing test, fix it, and run the suite"
```

**Resume later** — tasks survive crashes, quota pauses, and closed terminals:

```bash
comicode tasks list
comicode resume <task-id>
```

## What happens when a provider limits you

ComiCode doesn't stop at the first quota error:

1. Rotates through **multiple API keys** on the same profile (add several
   comma-separated keys when connecting).
2. Tries other **models on the same provider**.
3. Offers to switch **providers** — it asks before using a different one.
4. Pauses with progress saved if everything is exhausted — resume anytime.

Paid models are never used silently; enable them per-run with
`--allow-paid` or `/allow-paid on`.

## Agent modes

Twelve modes adapt tools and prompting to the task — `auto` (default)
classifies each request and picks one for you:

`build` `plan` `debug` `architect` `review` `refactor` `test` `docs`
`design` `security` `explain`

`plan`, `review`, `security`, and `explain` are read-only — they can't
modify files. Before finishing code changes, the agent is nudged to run
your configured test/lint/build commands, and a `verify_ui` tool can
screenshot web UIs in a real headless browser when Playwright is
available.

## Any AI platform

Built-in providers: Gemini, Groq, OpenRouter, OpenAI. Everything else is a
custom endpoint — OpenAI-compatible, Gemini-compatible, custom auth
headers, custom model paths, local no-auth servers.

```bash
comicode providers presets                 # see ready-made presets
comicode providers add --provider custom \
  --name "Ollama local" \
  --base-url http://localhost:11434/v1 \
  --no-auth --default-model qwen2.5-coder:14b
```

More examples (custom gateways, auth headers, manual model IDs):
[docs/provider-adapters.md](docs/provider-adapters.md)

## Common commands

| Command | What it does |
| --- | --- |
| `comicode` | Open the interactive workspace |
| `comicode run "<task>"` | Run a task once, non-interactively |
| `comicode resume <id>` | Resume a paused/interrupted task |
| `comicode providers ...` | Add, edit, test, enable/disable profiles |
| `comicode models ...` | List, refresh, select, classify models |
| `comicode tasks` / `history` / `usage` | Inspect tasks, transcripts, token usage |
| `comicode settings ...` | Routing, agent, and UI settings |
| `comicode doctor` | Diagnose Node, storage, credentials, providers |
| `comicode update [--check]` | Install the latest release |
| `comicode data ...` | Storage stats, cleanup, full data deletion |

Most commands accept `--json`. Run `comicode <command> --help` for flags.
Inside the TUI, `/help` lists everything.

## Updating

```bash
comicode update --check   # see if a newer release exists
comicode update           # install it globally
```

## Your data

Everything lives outside your repos:

| Platform | Location |
| --- | --- |
| Windows | `%APPDATA%\comicode` |
| macOS | `~/Library/Application Support/comicode` |
| Linux | `~/.config/comicode` |

Contains `comicode.db` (SQLite: tasks, history, settings, usage), encrypted
credentials, and logs. `comicode data delete-all` wipes it completely.
API keys go to your OS credential store — never plaintext in the database,
never exported, never sent anywhere except your chosen provider.

## Safety

File writes, deletes, shell commands, secret files, and paid fallbacks all
ask for approval first — pick "always allow" if you trust a pattern.
ComiCode blocks path traversal, protects `.env`/key files, sanitizes
command environments, and sends **no telemetry**.

## Development

```bash
npm install
npm run verify    # typecheck + lint + tests + build
```

Tests use fake adapters and in-memory SQLite — no API keys needed.
Architecture: [docs/architecture.md](docs/architecture.md) ·
Contributing: [CONTRIBUTING.md](CONTRIBUTING.md)

## License

[MIT](LICENSE)
