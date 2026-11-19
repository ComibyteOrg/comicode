# CLI premium redesign, reliable highlighting, model-first routing, dynamic teams, and credit control

Date: 2026-11-19
Status: draft for approval
Repo: `C:\Projects\React Projects\Comicode` (ComiCode, TypeScript/Ink terminal AI agent)

## Intent and why

The user is building ComiCode so developers can use several free AI APIs without
running out of credit mid-task. The terminal is the **primary** product; the web
dashboard is an optional alternative view and must stay secondary.

The user reported five problems in this pass:

1. The terminal UI looks plain/template-like compared with opencode, Kilo Code
   and similar advanced CLI agents.
2. Text highlighting still does not work reliably.
3. When a provider is exhausted, routing prefers another model on the same
   provider over the **exact same model** on another connected provider.
4. Subagents are static and forward-only; the user wants a team that changes by
   task (e.g. build an ecommerce site → plan → frontend → backend → security,
   possibly revisiting roles) and auto-selects a debugger for debugging prompts.
5. Credit/token use is a first-class concern, especially in team mode.

## Goals

- A genuinely premium-feeling terminal interface that still works in narrow terminals.
- Reliable, precise text selection that survives streaming output.
- Cross-provider routing that tries the exact model on other APIs before different models.
- Prompt-driven, revisitable subagent teams with an automatic debug role.
- Team runs that spend closer to one well-managed run than N independent runs.
- No new npm dependencies; no increase in install size or data usage.

## Non-goals

- Replacing the CLI with the web dashboard.
- Adding a 3D/WebGL renderer to the terminal (impossible in Ink) or new icon/font packages.
- Building a full MCP client, plugin marketplace UI, or multi-machine orchestration.
- Paid models used silently.

## Anti-goals (what would make this a failure)

- A beautiful UI that breaks keyboard workflows or selection.
- A team that burns 5–11× the tokens of a single agent.
- Routing that switches to a weaker/different model while the same model is available on another connected API.
- Highlighting that only works when the agent is idle.

## Constraints

- Ink v8 + React 19, ESM, Node 22+, TypeScript strict, no new runtime deps.
- Layout is flex-box only; no absolute positioning except overlay modals; measured via `useLayout` (`columns`/`rows`, `compact = columns < 92`).
- `incrementalRendering: false`, `alternateScreen: false`, `maxFps: 30` must stay so native scrollback/selection remain available.
- Mouse capture (SGR 1006) is opt-in via `ui.mouseScroll`; selection mode must release it.
- Provider-switch consent gate and free/paid gating must be preserved.
- All existing commands, settings, tasks and the web dashboard keep working.

## Approaches considered and decisions

### A. Terminal layout

| Option | Trade-off |
| --- | --- |
| Full cockpit: permanent teams/transcript/plan panes | Most "advanced"; requires wide terminals (~110+ cols), full viewport/measurement rework, higher regression risk |
| Polished single pane: rebuild visual system only | Lowest risk, but does not feel structurally different |
| **Hybrid (chosen)** | Polished single pane by default; collapsible agents/plan side panel toggled with one key, automatically shown on wide terminals |

**Decision (user):** hybrid. Default is the polished single pane. Side panel appears automatically when `columns >= 112`, can be toggled with a key (suggested `tab` when not cycling mode, or a dedicated binding such as `ctrl+shift+a`), and collapses on narrow terminals. Transcript width/height and scrollbar geometry must be derived from the main pane, not `columns - 8`.

### B. Highlighting

| Option | Trade-off |
| --- | --- |
| Native terminal drag only | Zero app code, but broken while streaming and with mouse capture on |
| Whole-entry selection only | Small fix, not precise enough for the user |
| **Characters + whole entries (chosen)** | Precise word-level selection plus fast whole-message selection; requires inverse-video rendering per span and careful focus arbitration |

**Decision (user):** characters + whole messages.

Root causes found in current code:
- `PromptInput focus={active && !dimmed}` (`workspace.tsx:1170`) stays active in selection mode, so `a` and `shift+↑/↓` also edit the prompt — the selection handler at `workspace.tsx:1043` and the input compete.
- Toast says "drag to highlight" but there is no drag implementation; native drag is blocked when `ui.mouseScroll` enables SGR capture.
- `isSuppressedInput()` (`mouse.ts`) swallows keys for 120 ms after any mouse event.
- `copyToClipboard` (`core/clipboard.ts`) can fail silently on Windows.

**Design:**
- Central focus state: in selection mode the composer must not receive keys (`focus={active && !dimmed && !selectionMode}` and `isActive` guards made mutually exclusive).
- Keep `frozenEntries` snapshot and spinner stop while selecting.
- Whole entries: `shift+↑/↓`, `a` (select all), `esc` clears selection then exits mode.
- Character-level: `shift+←/→` (and `shift+home/end`) move a caret within the focused entry; render selected spans with `backgroundColor`/`color` inversion using `Text` segments. Copy returns exactly the selected characters. Mixing entry-level and character-level selection: character caret takes precedence when set; clearing it returns to entry-level.
- Replace the misleading toast with the actual key list.
- Clipboard failure fallback: write selection to `<project>/.comicode/selection.txt` and notify the path.
- Keep `alternateScreen: false` and release mouse tracking in selection mode.

### C. Cross-provider model-first routing

| Option | Trade-off |
| --- | --- |
| Only change the rank bonus | Small, but same-provider +100,000 still dominates; does not fix the ordering |
| **Insert an explicit exact-model candidate pass (chosen)** | Guarantees same model on other APIs is tried first; needs synthetic models for undiscovered IDs and a cap so the chain is not flooded |
| Replace provider preference entirely with model preference | Simpler but discards existing provider priority, consent and free-first behavior |

**Findings:** `engine.ts:453–459` adds +100,000 for same provider and only grants the `sameModel` +2,000 bonus when `profile.providerId === sameProviderId`. There is no cross-provider exact-model lookup (`findModel` requires `model.providerId === profile.providerId`). Current failover order after exhausting a key pool is: same-provider *other models* → other providers.

**Design:**
- In `buildRoutingOutcome`, before the same-provider/other-model pass, add a pass that enumerates `currentModelId` on every eligible enabled profile (other providers included), creating a `syntheticModel` entry where the ID was never discovered. Respect `excludeKeys`, `excludedProfileIds`, active limits, free/paid policy and requirements.
- Make the `sameModel` rank bonus provider-independent so these candidates survive sorting; keep the +1,000,000 explicit-selection bonus above them.
- Ensure `maxFallbacks + 1` chain length can hold at least one exact-model candidate per connected provider (widen only as needed, e.g. `max(maxFallbacks + 1, distinctProviders)` capped at a sane ceiling).
- Provider-switch consent still applies when crossing providers.
- Apply the same preference in team-stage model selection so a new stage also prefers the exact model available across APIs.

### D. Dynamic subagent teams

| Option | Trade-off |
| --- | --- |
| Deterministic intent rules only | Zero extra tokens, predictable, but rigid for vague prompts |
| LLM planner every run | Flexible, but one extra model call per run |
| **Hybrid (chosen)** | Deterministic for common intents; LLM planner only for vague/org-wide requests |

**Findings:** `teams.ts:212–271` uses static `TEAM_PIPELINES` arrays and keyword scoring; `agent.ts` `runTeam` is a linear `for` loop with no revisit; no `debug`, `frontend`, `backend` roles; `STAGE_STATUS:` lines are emitted by roles but never parsed.

**Design:**
- Extend roles with `frontend`, `backend`, `debug` (mapped to `design`/`build`/`debug` modes as appropriate). Keep existing 11 roles.
- Replace static pipeline selection with a role queue. A deterministic intent resolver handles common prompts (`build website/ecommerce` → plan → frontend → backend → security → [frontend fix] → review; `debug`/`error`/`crash` → debug; `security audit` → security → review; etc.) with explicit revisit rules.
- For vague or org-wide prompts (`full organization`, `whole product`, unclear intent), use a single cheap planner pass that returns an ordered role list with possible repeats. Cap the list.
- Parse `STAGE_STATUS:` from each stage's final output; feed it into the next handoff instead of the raw summary. Support a `NEEDS_REVISIT: <role>` marker so a later stage can send work back; enforce a max revisit count and max total stages to prevent loops.
- Emit stage events for every visit (including revisits) so the TUI pipeline rail shows the real order.
- **Normal modes also auto-select a specialist (user decision).** In `auto`/`build` mode, a single-focus prompt picks one specialist role (e.g. `debug`/`error`/`crash` → the `debug` role in debug mode; `review` → reviewer; `security` → security auditor) with no team overhead. A multi-part prompt (build an ecommerce site, full product, explicit "use a team") auto-assembles the revisitable team even without `--mode team`. Explicit `team` mode always assembles it. This changes agent dispatch in `agent.ts` (mode classification + team trigger), not just `teams.ts`.

### E. Credit and token control

**Findings:** each stage creates a new `CodingAgent` with fresh context and default effort re-derived from the newly selected model; handoffs accumulate in the thread and are re-read as history (roughly quadratic growth); `maxSteps` applies per stage; per-stage planner/reviewer/tester cycles can repeat. No pre-run estimate exists.

**Design:**
- Give the whole team one shared budget: total steps and a token/character ceiling, with per-stage caps. Decrement as stages run; stop cleanly when exhausted.
- Compact the task between stages (reuse `compactTask`) so the next stage sees a summary + recent messages instead of the entire accumulated thread. Keep the shared task thread for user visibility.
- Keep only the latest handoff note plus the original request in each stage prompt; do not embed all prior notes.
- Suppress per-stage planner/reviewer/tester cycles inside team stages; run at most one final review at the end.
- Default team stages to the `low`/`medium` effort profile unless the user explicitly asks for depth; re-apply the chosen profile to every stage.
- Show a preflight estimate in the CLI/TUI before a team run (number of stages, budget, estimated tokens using `BuiltContext.estimatedTokens`), and show live token/credit totals in the header.
- On hard exhaustion (no model has credit), pause with saved checkpoints. On soft budget exhaustion, compact and continue with the cheapest adequate model.

## Settled by the reviewer pass (my calls, not user decisions)

- **Budget units:** the shared team budget counts estimated prompt tokens (`BuiltContext.estimatedTokens`) plus actual recorded usage; it is an internal default derived from the chosen effort profile, not a new persisted settings surface. Planner passes draw from the same pool.
- **"Credit"** means the existing `costEstimate` rows plus quota/limit signals from `providers/errors.ts`. There is no provider balance API in this repo and adding one would conflict with the no-new-dependency/no-extra-data constraint.
- **Exact model** means literal `modelId` equality after trimming/lowercasing. A canonical alias/family layer is out of scope for this pass.
- **Resume:** the role queue, cursor and revisit counts are persisted in task metadata/checkpoint state so a paused team resumes where it stopped instead of replaying stages.
- **Planner fallback:** when no planner profile is configured, auto-select a cheap model via the router rather than leaving the planner dead; the LLM planner is only used for vague/org-wide prompts.
- **Preflight estimate** is informational; it does not block scripted runs. Existing approval hooks still gate paid models.
- **Acceptance target:** a team run at the same effort should use ≤2× the estimated tokens of a single-agent run on the same task, verified with a test that counts stages, compactions and handoff growth.

## What the builder decides

- Exact shortcut key for the side panel (must not collide with mode cycling, `ctrl+y`, or command palette).
- Visual details (glyphs, accent usage, pane widths) within the hybrid layout, as long as narrow terminals degrade cleanly.
- Whether the LLM planner uses the existing `Collaborator` class or a dedicated tool-free pass; reuse existing credential/routing paths either way.
- Storage location for the clipboard fallback file (suggested `.comicode/selection.txt`).

## Files likely touched

`src/tui/theme.ts`, `src/tui/app.tsx`, `src/tui/components.tsx`, `src/tui/screens/workspace.tsx`, `src/tui/shortcuts/manager.ts`, `src/core/clipboard.ts`, `src/core/routing/engine.ts`, `src/core/agent/agent.ts`, `src/core/agent/teams.ts`, `src/core/agent/types.ts`, `src/core/agent/context.ts`, `src/core/agent/compaction.ts`, `src/core/agent/collaboration.ts`, `src/core/settings.ts`, tests under `tests/`, and `README.md`.

## Approval

This document must be approved before implementation begins. After approval, the next step is a written implementation plan.
