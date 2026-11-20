# Multi-agent software workspace redesign — design

Date: 2026-11-19
Status: draft for approval

## Intent

Turn ComiCode's terminal interface from a single-assistant chat into a
**visible software engineering team**. The user must always know who is
working, what they are doing, why they were assigned, who is next, what is
complete and what still needs attention. Every activity indicator must come
from a real runtime event — no decorative agents, no fabricated progress, no
claimed parallel execution unless agents truly run concurrently.

The terminal remains the primary product; the web dashboard is an optional
alternative and must keep working.

## Current architecture (audited)

- TUI: Ink 8 / React 19, single `workspace` screen plus modal dialogs,
  `Header → Workspace → Footer`, live theme proxy, 13 palettes, `useLayout`,
  F6 side panel showing team stages/plan/route/usage.
- Runtime: `CodingAgent` loop with modes, persisted role queue, revisits,
  shared step/token budget, stage compaction, key/provider failover.
- Hooks today: `onText`, `onToolStart/Result`, `onPlan`, `onStage`, `onNotice`,
  `onUsage`, `onEstimate`, `onPaused`, `onTaskComplete`.
- `TEAM_ROLES` has 15 static roles; no per-agent model/provider/permission
  config, no typed event bus, no task board, no dependencies or assignees.
- `runTeam` is a sequential `while` loop — parallel execution is not real.

## Goals

- 14-agent sidebar with status, active indicator, task count, collapse/expand
  and inspectable details.
- Main workspace with clearly separated user / Team Lead / specialist / tool /
  system messages.
- Live activity feed driven by typed runtime events, including real handoffs.
- Agent inspector with role, status, model, provider (masked), tools,
  permissions, assigned/completed tasks, recent history, last error.
- Task board with backlog/ready/in-progress/blocked/in-review/completed/failed,
  assignee, dependencies, priority, expected vs actual result.
- Keyboard-first navigation, searchable agent selector, popup slash menu,
  context-sensitive shortcuts, escape-to-close.
- Responsive to terminal size; bounded event history; efficient rendering.

## Non-goals / anti-goals

- No parallel agent execution in this pass (sequential, honest events).
- No fabricated progress, agent activity, or completion without real results.
- No new npm dependencies; no API keys or secrets in the UI.
- No replacing the web dashboard or rewriting unrelated subsystems.

## Constraints

- Node 22.13+, TypeScript strict, Ink 8, React 19, no new runtime deps.
- Preserve all existing commands, settings, task/resume, routing and budget
  behavior.
- Every UI agent state must map to a runtime event or persisted task state.

## Approaches considered

| Option | Trade-off |
| --- | --- |
| UI on existing coarse hooks | Fast, but cannot honestly show agent-level lifecycle — rejected |
| **Typed event bus + registry, sequential execution (chosen)** | Real agent lifecycle events, registry, task contracts and inspector; honest and testable; no parallel conflicts |
| Full parallel engine now | High risk: file conflicts, quota fan-out, dependency scheduling before the event contract exists |

**Decision (user):** typed event bus + registry, sequential execution. Deterministic coordinator with an optional cheap planner for vague prompts.

## Design

### 1. Event contract (`src/core/events/`)

`AgentEvent` discriminated union: `agent.started`, `agent.progress`,
`agent.handoff`, `agent.completed`, `agent.failed`, `agent.waiting`,
`agent.needs_input`, `task.created`, `task.assigned`, `task.completed`,
`tool.started`, `tool.completed`, `tool.failed`.

`EventBus`: `subscribe(listener)`, `emit(event)`, bounded history (e.g. 500
events), optional `onPersist` that stores a trimmed snapshot in task metadata
for restart recovery. Events carry `taskId`, `agentId`, `timestamp`, and a
typed payload. All text fields are redacted before emit.

`CodingAgent` and `runTeam` emit these events alongside existing hooks; hooks
remain for backward compatibility.

### 2. Agent registry (`src/core/agent/registry.ts`)

`AgentDefinition`: id, name, role label, icon, description, responsibilities,
default mode, tool permissions, allowed file globs, model selection policy,
status. Fourteen definitions: team_lead, planner, research, designer, frontend,
backend, database, mobile, debugger, qa, security, reviewer, devops, docs.
Marketing remains available but is not in the initial sidebar.

`AgentRuntimeState`: status (idle/working/waiting/completed/failed/needs_input),
assigned task count, completed task count, current task id, current model/
provider (masked), last error. State is derived from events + task metadata.

### 3. Task contracts and board (`src/core/agent/task-contract.ts`)

`TaskContract`: id, objective, context, relevant files, dependencies,
expected output, restrictions, completion criteria, assignee, priority, status.
Statuses: backlog, ready, in_progress, blocked, in_review, completed, failed.

The Team Lead creates contracts from the deterministic roster, records
dependencies, assigns agents, and closes them only when the stage result is
verified. Persist contracts in task metadata.

### 4. Orchestration wiring

`runTeam` emits `task.created`, `task.assigned`, `agent.started`,
`agent.progress`, `tool.*`, `agent.handoff`, `agent.completed`/`failed`,
`task.completed`. Team Lead is the coordinator (`agent.waiting` for idle
specialists). Vague prompts use one cheap planner pass to propose a role list,
falling back to deterministic rules per the ledger. Sequential only.

### 5. TUI rebuild

- Areas: sidebar (14 agents), main workspace, activity panel, inspector,
  task board. Keyboard focus cycles with tab; views selected with number keys
  or a command palette. Collapse panels with their toggle keys.
- Activity feed shows only bus events, with real handoff lines
  `Frontend → QA` and tool/file lines from `tool.*` events.
- Inspector and task board are real views backed by registry state and
  contracts, not mock data.
- Slash menu remains a popup near the composer with `/agents`, `/agent x`,
  `/plan`, `/tasks`, `/activity`, `/review`, `/test`, `/models`,
  `/providers`, `/settings`.
- Design tokens: dark charcoal, restrained cyan/violet accents, precise
  spacing, thin separators, no gradients or rounded-card overload.

### 6. Performance and persistence

Bounded event history, memoized layout, incremental state slices, lazy views,
no extra background processes, cancellation via existing AbortController,
provider failures via existing failover. Persist events snapshot, contracts
and agent runtime state in task metadata for restart recovery.

## Settled by the reviewer pass

- **Agent roster:** `database` and `mobile` are real runtime roles, added to
  `TEAM_ROLES` with modes (`architect`/`build` and `design`/`build`), task types
  and tool scopes. The registry aliases `plan→planner`, `design→designer`,
  `debug→debugger`, `review→reviewer` and adds `team_lead` as coordinator.
  Existing roles (`product`, `architecture`, `engineering`, `marketing`) remain
  for backward compatibility but are not in the initial 14-agent sidebar.
- **State storage:** execution state, contracts and event snapshot are
  per-task in `TaskRecord.metadata`; the registry definitions are global.
  Inspector task counts are scoped to the active task, with lifetime totals
  read from the store's usage/task tables.
- **Team Lead:** emits coordinator events (`task.created`, `task.assigned`,
  handoffs) but never consumes a model call or step budget. Only stage agents
  emit `agent.started`/`agent.completed` — no duplicate events.
- **Planner:** reuse the existing `Collaborator.plan()` when a planner profile
  is configured; otherwise deterministic rules. No new LLM call path in this
  pass, preserving the credit goal.
- **Task contracts:** one contract per team stage; dependencies come from
  pipeline order plus explicit revisits; "actual result" is the parsed
  `STAGE_STATUS` or the stage summary; "verified" means the stage returned
  `completed` with its checks — no fabricated verification step.

## Files likely touched

New: `src/core/events/{types,bus}.ts`, `src/core/agent/registry.ts`,
`src/core/agent/task-contract.ts`, `src/tui/screens/{workspace-v2,agent-sidebar,activity-panel,agent-inspector,task-board}.tsx`, tests for each.
Modified: `agent.ts`, `teams.ts`, `agent/types.ts`, `tui/app.tsx`,
`tui/components.tsx`, `tui/theme.ts`, `tui/commands/registry.ts`, README.

## Acceptance

- Every sidebar status traces to a real event; no fabricated activity.
- Inspector and task board show persisted registry/contract data.
- Existing CLI/TUI commands, routing, budgets and resume still pass tests.
- `npm run verify` green apart from documented environment-only timeouts.

## Approval

Building starts only after this design is approved. Next step is the written implementation plan.
