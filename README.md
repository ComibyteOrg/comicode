# ComiCode

**An open-source terminal AI coding agent that never runs out of credit.**

ComiCode is a CLI/TUI coding agent for your terminal. It connects to multiple
free AI APIs and keeps working when one hits its quota — automatically rotating
keys, models and providers with full context handoff. Give it a task and it can
also route the work through a virtual software organization (research,
engineering, security, QA, docs, marketing) with step-by-step handoffs.

**The terminal is the main interface.** An optional browser dashboard is
available as an alternative view of the same engine and the same saved tasks:

| Interface | Command | Status |
| --- | --- | --- |
| **Terminal workspace** | `comicode` | **Primary interface** — all features |
| **One-shot CLI** | `comicode run "..."` | Primary interface — scripts, CI, quick tasks |
| Web dashboard *(optional)* | `comicode serve` | Alternative view of the same engine |

---

## Contents

- [Install](#install)
- [Connect your APIs](#connect-your-apis)
- [Your first task](#your-first-task)
- [The agent modes (including `team`)](#agent-modes)
- [How quota failover works](#how-quota-failover-works)
- [Live interaction: follow-ups and text selection](#live-interaction)
- [Plugins, skills and image generation](#plugins-skills-and-image-generation)
- [Inspecting a website (pointing at what you mean)](#inspecting-a-website-pointing-at-what-you-mean)
- [Keyboard shortcuts and slash commands](#keyboard-shortcuts-and-slash-commands)
- [Token efficiency](#token-efficiency)
- [Any AI platform](#any-ai-platform)
- [Optional web dashboard](#optional-web-dashboard-alternative-view)
- [Command reference](#command-reference)
- [Your data and safety](#your-data-and-safety)
- [Development](#development)

---

## Install

Requires **Node.js 22.13+** (Node 24 recommended), on Windows, macOS or Linux.

```bash
git clone https://github.com/ComibyteOrg/comicode.git
cd comicode
npm install
npm install -g .        # builds and installs the `comicode` command
comicode --version
```

Or install straight from GitHub:

```bash
npm install -g github:ComibyteOrg/comicode
```

The install is small (under 1 MB bundled CLI) and downloads no browser. The
optional web dashboard reuses the same `node_modules` — no second install.

---

## Connect your APIs

ComiCode needs at least one provider before it can do anything.

```bash
comicode connect                       # interactive — pick a provider, paste keys
comicode providers add --provider gemini --name "Gemini personal"
comicode providers add --provider groq   --name "Groq free"
comicode models refresh
comicode models list --free
```

**Multiple accounts with the same provider:** add several profiles, or paste
comma-separated keys into one profile:

```bash
comicode providers add --provider gemini --name "Gemini" \
  --api-key "key-one,key-two,key-three"
```

Those three keys are stored as one key pool. ComiCode uses them in order, so a
single profile can keep going after one key is exhausted. API keys are stored
in your OS credential store, never in the SQLite database.

Local no-auth endpoints work too:

```bash
comicode providers add --provider custom --name "Ollama" \
  --base-url http://localhost:11434/v1 \
  --no-auth --default-model qwen2.5-coder:14b
```

---

## Your first task

```bash
cd your-project
comicode                          # interactive workspace
```

Type what you want in plain English:

- `fix the failing test`
- `add a settings page`
- `build a full marketing website with a hero image`
- `audit this code for security issues, then document the fixes`

The agent inspects the project, makes a plan (shown as a live **todo list**),
edits files, runs checks, and shows every step as it works. Every prompt
continues the same task thread.

One-shot version:

```bash
comicode run "Find the failing test, fix it, and run the suite"
comicode run "Build a full product with research, engineering, security and marketing" --mode team
```

Resume anything later — tasks survive crashes, quota pauses, and restarts:

```bash
comicode history                  # browse saved work (also /history in the TUI)
comicode resume <task-id>
```

---

## Agent modes

Switch with `tab` / `shift+tab`, type `/mode` for a **popup picker**, or pass
`--mode <name>` on the CLI.

| Mode | What it does | Tools |
| --- | --- | --- |
| `auto` *(default)* | Classifies the request and picks a workflow for you | full |
| **`team`** | **Full virtual software company — a pipeline of departments with handoffs** | full |
| `build` | Inspect, edit, run commands, verify | full |
| `plan` | Read-only plan, no file changes | read-only |
| `debug` | Reproduce, isolate the root cause, fix, prove | full |
| `architect` | System design before touching code | full |
| `review` | Read-only code review | read-only |
| `refactor` | Safe restructuring, behavior preserved | full |
| `test` | Test-first implementation | full |
| `docs` | Documentation and comments | full |
| `design` | UI/UX, layout and visual assets | full |
| `security` | Read-only security audit | read-only |
| `explain` | Read-only explanations | read-only |

### `team` mode — the full organization

`team` mode runs the task as a sequence of real agent stages, each in the mode
that fits it. You watch the pipeline advance:

```
🔎 Research → 🧭 Product → 🏗 Architecture → 🎨 Design → ⚙️ Engineering
           → 🚀 DevOps → 🛡 Security → 🧪 QA → ✅ Review → 📚 Docs → 📣 Marketing
```

For a focused prompt (`"audit this for security"`) it runs a short focused
team (`Research → Security → Review`). For `"full organization"` /
`"marketing team"` / `"whole product"` it runs the entire company.

Key behaviors:

- **Every department gets its own model.** ComiCode picks the most capable
  available model across *all* connected APIs for that stage's task type.
- **Handoffs are real context.** Each member receives a compact note
  containing the previous stage's stopping point, completed/pending steps and
  changed files, and shares the same task thread and transcript.
- **Failover still applies inside every stage** — quotas, key rotation,
  cooldowns and resume work exactly as in single-agent mode.
- **Images are handled by the Design/Marketing stages** when the request calls
  for a logo, illustration, diagram or hero image (see below).

Example:

```bash
comicode run "Build a full landing page with a hero image and launch copy" --mode team
```

Then press `esc` in the terminal or watch the **Teams** view in the web GUI.

---

## How quota failover works

This is the part that makes free APIs usable for long tasks. When a model hits
a limit, ComiCode does **not** give up:

1. **Same model, next key.** It rotates to key 2, then key 3 of the same
   profile on the *same model* before trying anything else.
2. **Same provider, next free model.** Only after every key for that model is
   exhausted does it try other free models of the same provider. A cooldown is
   saved so it doesn't hammer a limited model.
3. **Next provider.** After repeated same-provider failures it offers to switch
   provider. Approving once remembers that provider for the rest of the run.
4. **Context handoff.** The replacement model receives a note explaining why
   it is there and exactly where the previous one stopped — no lost work.
5. **Pause instead of failing.** If everything is exhausted, progress is
   checkpointed and you can resume after resetting a quota.

Paid models are never used silently. Enable them with `--allow-paid` or
`/allow-paid on`.

Errors are classified precisely (429, daily quota, auth failure, billing,
outage, context length, etc.) using HTTP status and provider error bodies, so
the right retry strategy is chosen automatically.

---

## Live interaction

### Add more prompts while the agent is working

Just keep typing and press Enter. The message is injected into the running
task and the model sees it on its **next step** — no need to wait for the
current run to finish. The transcript marks it as a live follow-up.

### Highlight and copy text

- **Terminal-native:** press `ctrl+y` to release mouse capture, then drag to
  select and copy with your terminal. `esc` or `ctrl+y` returns to wheel
  scrolling. (`ui.mouseScroll` controls capture.)
- **In-app selection:** in select mode use `shift+↑` / `shift+↓` to highlight
  transcript entries, `a` to select all, and `ctrl+c` to copy to the OS
  clipboard. The transcript is frozen while selecting, so streaming output
  can't reflow underneath your selection.

### Todos and plans

Multi-step tasks call `update_plan`, which renders a live checklist in both
the terminal and the web dashboard. The plan is saved with checkpoints and is
carried across quota handoffs and resumes.

---

## Plugins, skills and image generation

### Skills

Skills are Markdown instruction packs with frontmatter:

```markdown
---
name: my-skill
description: When and how to use this skill
---

# Steps
...
```

Built-ins: `test-driven-change`, `debug-systematically`, `safe-refactor`,
`code-review`, `design-system`. Add your own in:

- `<comicode home>/skills/` (all projects)
- `<project>/.comicode/skills/` or `<project>/.agents/skills/` (this project)

The model sees skill names/descriptions and loads full text on demand with the
`use_skill` tool.

### Plugins

Plugins bundle skills, slash commands, tool descriptors and MCP server config
in a `plugin.json` (or `comicode-plugin.json`) manifest:

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "What it adds",
  "commands": [
    { "name": "review-pr", "description": "Review a PR", "promptTemplate": "Review {{args}}" }
  ],
  "skills": [{ "name": "style", "description": "House style", "body": "# Style rules…" }]
}
```

```bash
comicode plugin list
comicode plugin install ./path/to/plugin       # or a git/https URL
comicode plugin info <name>
comicode plugin remove <name>
```

Installed plugin skills join the agent's available skills, and plugin slash
commands (e.g. `/review-pr`) run inside the active task. MCP server entries are
stored in the manifest for future MCP client support.

### Image generation

When a task needs an actual image — logo, illustration, diagram, hero image —
the `generate_image` tool is available in full-tool modes (used by Design and
Marketing in team mode). ComiCode:

1. Finds an image-capable model among your connected APIs (Gemini image models,
   `gpt-image-1` / DALL·E-style OpenAI-compatible endpoints).
2. Generates from the prompt and saves files to `.comicode/images/`.
3. Returns the saved path to the model so it can reference the asset.

Image models are not mixed into the chat-model list, so normal coding stays
unchanged.

---

## Inspecting a website (pointing at what you mean)

The agent can open a web page itself and work on a specific part of it:

```text
you:  Open http://localhost:3000 and fix the header — I'll highlight it
agent: [calls open_web]
agent: The page is open with a highlight overlay. Click the header you mean,
       then I'll read your selection.
       [calls web_action with action "select"]
```

- **`open_web`** starts a visible browser, navigates to the URL, injects a
  highlight overlay, and returns a DOM summary plus a screenshot path.
- **`web_action`** can `click`, `fill`, `press`, `scroll`, `read`, `html`,
  `screenshot`, `list`, or **`select`**. With `select`, the agent waits for
  **you** to click an element or drag to select text in the opened page; it
  then receives the exact CSS selector, text and position.
- **`close_web`** closes the session when finished.

This is the web counterpart of terminal text selection: instead of highlighting
transcript text, you highlight the part of a *page* the agent should change.
The existing `verify_ui` tool still runs headless screenshot checks for CI.

**Install size:** no new dependency is added. This reuses `playwright-core`
(already in the project) and prefers an **already-installed system Edge or
Chrome**, so nothing is downloaded. Only if you have neither does the agent
tell you to run `npx playwright install chromium`.

---

## Keyboard shortcuts and slash commands

| Shortcut | Action |
| --- | --- |
| `enter` | Send prompt / accept suggestion |
| `tab` / `shift+tab` | Cycle agent modes |
| `ctrl+m` | Model picker |
| `ctrl+e` | Reasoning effort (`low` → `xhigh`) |
| `ctrl+b` | Providers |
| `ctrl+p` | Command palette |
| `ctrl+t` | Task history (`/history`) |
| `ctrl+j` | Jump between your questions |
| `ctrl+y` | Toggle text-selection mode / release mouse |
| `esc` | Pause after the current operation |
| PgUp / PgDn, wheel | Scroll transcript |

Useful slash commands: `/help`, `/mode` (opens the picker), `/history`,
`/model`, `/models`, `/connect`, `/providers`, `/status`, `/usage`, `/plan`,
`/diff`, `/undo`, `/skills`, `/copy`, `/allow-paid on|off`, `/new`.

---

## Token efficiency

ComiCode is engineered to spend far fewer tokens than a naive agent:

- **Reasoning effort** per profile (`low`/`medium`/`high`/`xhigh`) controls
  step count, context budget, history length, tool-output size and output cap.
- **Compaction** summarizes old history (redacted, capped) and re-reads only
  what is needed, instead of replaying the entire transcript.
- **Block-aware history pruning** keeps structure while dropping old turns.
- **File excerpts** are capped and cached by hash — unchanged files are not
  re-sent.
- **Tool outputs** are head/tail truncated; git diffs and search results have
  hard caps.
- **Capability-aware routing** picks free models first and the cheapest
  adequate model for each role.
- **Token-discipline hints** are injected at low/medium effort.

Use `/profile` or `comicode providers edit` to set effort; `low` is the
leanest profile.

---

## Any AI platform

Built-in: **Gemini, Groq, OpenRouter, OpenAI**. Everything else is a custom
endpoint — OpenAI-compatible, Gemini-compatible, custom auth headers, custom
model paths, local no-auth servers.

```bash
comicode providers presets
comicode providers add --provider custom --name "Custom gateway" \
  --base-url https://gateway.example/v1 --default-model my-model
```

Details: [docs/provider-adapters.md](docs/provider-adapters.md)

---

## Optional web dashboard (alternative view)

Not required — everything above works entirely in the terminal. If you want a
browser view of the same engine and tasks:

```bash
npm run web:build          # one-time build, reuses the root install
comicode serve             # starts API on :8787 and opens the dashboard
comicode serve --no-open   # API only
```

For hot reload: `npm run web:dev` alongside `comicode serve --no-open`.

It offers a workspace with the same streaming/stages/todos, a 3D-styled teams
view, provider quota bars and task history. If the API is down it falls back to
a demo mode (`?demo=1`). See [web/README.md](web/README.md).

---

## Command reference

| Command | What it does |
| --- | --- |
| `comicode` | Interactive terminal workspace |
| `comicode serve` | *(Optional)* Web dashboard alternative |
| `comicode run "<task>" [--mode team]` | Run one task |
| `comicode task "<task>"` | Alias for `run` |
| `comicode chat` | Multi-turn REPL |
| `comicode resume <id>` | Resume paused work |
| `comicode history` | Browse all saved tasks/transcripts |
| `comicode providers ...` | Add, edit, test, enable/disable profiles |
| `comicode models ...` | List, refresh, select, classify models |
| `comicode plugin list\|install\|info\|remove` | Manage plugins |
| `comicode usage` | Token usage and limits |
| `comicode settings ...` | Routing, agent and UI settings |
| `comicode doctor` | Diagnose Node, storage, credentials, providers |
| `comicode update [--check]` | Install the latest release |
| `comicode data ...` | Storage stats, cleanup, full data deletion |

Most commands accept `--json`. Run `comicode <command> --help` for flags.

---

## Your data and safety

Everything lives outside your repos:

| Platform | Location |
| --- | --- |
| Windows | `%APPDATA%\comicode` |
| macOS | `~/Library/Application Support/comicode` |
| Linux | `~/.config/comicode` |

That holds `comicode.db` (SQLite: tasks, history, settings, usage), encrypted
credentials, and logs. `comicode data delete-all` wipes it completely. API keys
go to your OS credential store — never plaintext in the database, never
exported, never sent anywhere except the provider you chose.

File writes, deletes, shell commands, secret reads and paid fallbacks ask for
approval ("always allow" persists a safe pattern). ComiCode blocks path
traversal, protects `.env`/key files, sanitizes command environments, redacts
secrets from errors/logs, and sends **no telemetry**.

---

## Development

```bash
npm install
npm run verify       # typecheck + lint + tests + build
```

For the dashboard: `npm run web:build` (uses the root install).

Tests use fake adapters and in-memory SQLite — no API keys needed.

Architecture: [docs/architecture.md](docs/architecture.md) ·
Contributing: [CONTRIBUTING.md](CONTRIBUTING.md)

## License

[MIT](LICENSE)
