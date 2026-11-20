# Multi-Agent Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-assistant TUI with a real event-driven multi-agent workspace: 14-agent registry, typed runtime events, task contracts, live activity feed, agent inspector and task board, all backed by the actual sequential team runtime.

**Architecture:** Add a typed `EventBus` and agent registry beside the existing `CodingAgent`. `runTeam` emits agent/task/tool events and creates one `TaskContract` per stage; nested stage agents do not emit, so the feed cannot duplicate activity. A new `MissionControl` TUI subscribes to the bus and renders sidebar/workspace/activity/inspector/board areas. Existing hooks, routing, budgets and resume remain intact.

**Tech Stack:** TypeScript strict, Node 22.13+, Ink 8, React 19, Vitest 5, no new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-19-multi-agent-workspace-design.md`

## Global Constraints

- Node 22.13+, TypeScript strict, ESM `.js` specifiers in `src`, no new npm packages.
- CLI is primary; web dashboard keeps working; no breaking changes to existing commands/settings/tasks.
- Never emit fabricated agent activity, progress percentages, or completion.
- Only `runTeam` emits stage events; nested stage agents receive `eventBus: null`.
- Team Lead emits coordinator events only and makes no model call.
- All event text is redacted with `redactSecrets` before emit; no secrets in inspector/UI.
- Sequential execution only; do not claim parallelism.

## Review Focus

1. A stage fails mid-run → `agent.failed` emitted once, contract moves to `failed`, later stages do not run. Test: Task 4.
2. Two agents appear active → impossible because execution is sequential; test asserts at most one `working` state. Task 6.
3. Event history > 500 → bounded, oldest dropped. Task 1.
4. Restart after quit → events snapshot/contracts in task metadata restore sidebar/board state. Task 8.
5. Narrow terminal (<92 cols) → sidebar collapses, workspace still usable. Task 5.

---

### Task 1: Typed event bus

**Files:** Create `src/core/events/types.ts`, `src/core/events/bus.ts`; Test `tests/events.test.ts`.

**Interfaces:**
- `export type AgentEventType = 'agent.started'|'agent.progress'|'agent.handoff'|'agent.completed'|'agent.failed'|'agent.waiting'|'agent.needs_input'|'task.created'|'task.assigned'|'task.completed'|'tool.started'|'tool.completed'|'tool.failed'`
- `export interface AgentEvent { type: AgentEventType; taskId: string; agentId?: string; timestamp: string; payload: Record<string, unknown> }`
- `export class EventBus` with `constructor(options?: { maxHistory?: number; onEmit?: (event: AgentEvent) => void })`, `subscribe(listener: (event: AgentEvent) => void): () => void`, `emit(event: Omit<AgentEvent,'timestamp'>): AgentEvent`, `history(limit?: number): AgentEvent[]`, `clear(): void`.

- [ ] **Step 1: Write failing tests** for subscribe/emit delivery, unsubscribe, bounded history at 500, and timestamp injection.
- [ ] **Step 2:** Run `npx vitest run tests/events.test.ts` — expect FAIL (module missing).
- [ ] **Step 3:** Implement the union and bus; `emit` adds `new Date().toISOString()`, pushes to history, trims to `maxHistory ?? 500`, calls listeners and `onEmit`.
- [ ] **Step 4:** Run test — expect PASS.
- [ ] **Step 5:** Commit `feat(events): typed agent event bus`.

---

### Task 2: Agent registry with 14 real roles

**Files:** Create `src/core/agent/registry.ts`; Modify `src/core/agent/teams.ts`, `src/core/agent/modes.ts`; Test `tests/agent-registry.test.ts`.

**Interfaces:**
- `export type AgentId = 'team_lead'|'planner'|'research'|'designer'|'frontend'|'backend'|'database'|'mobile'|'debugger'|'qa'|'security'|'reviewer'|'devops'|'docs'`
- `export interface AgentDefinition { id: AgentId; name: string; icon: string; description: string; responsibilities: string[]; roleId: TeamRoleId | null; mode: AgentMode | null; toolScope: 'all'|'read-only'|'frontend'|'backend'|'database'|'mobile' }`
- `export const AGENT_REGISTRY: AgentDefinition[]` (14 entries), `getAgentDefinition(id: AgentId): AgentDefinition`, `resolveAgentId(roleId: TeamRoleId): AgentId`.
- `TEAM_ROLES` gains `database` (`mode:'architect'`, taskType `reasoning`, tool scope database) and `mobile` (`mode:'design'`, taskType `vision`, tool scope mobile).

- [ ] **Step 1:** Write failing tests: registry has exactly 14 ids; `team_lead.mode === null`; aliases map `plan→planner`, `debug→debugger`; `database`/`mobile` resolve to real roles.
- [ ] **Step 2:** Run test — expect FAIL.
- [ ] **Step 3:** Implement registry and add two roles; keep legacy roles intact for compatibility.
- [ ] **Step 4:** Run test + existing `team-roles-dynamic.test.ts` — expect PASS.
- [ ] **Step 5:** Commit `feat(agents): 14-agent registry with database and mobile roles`.

---

### Task 3: Task contracts

**Files:** Create `src/core/agent/task-contract.ts`; Test `tests/task-contracts.test.ts`.

**Interfaces:**
- `export type ContractStatus = 'backlog'|'ready'|'in_progress'|'blocked'|'in_review'|'completed'|'failed'`
- `export interface TaskContract { id: string; objective: string; assignee: AgentId; status: ContractStatus; dependencies: string[]; priority: 'low'|'normal'|'high'; relevantFiles: string[]; expectedOutput: string; restrictions: string[]; completionCriteria: string[]; actualResult: string | null; error: string | null }`
- `export function createStageContracts(roles: TeamRoleId[], request: string): TaskContract[]` — one per role, dependencies = prior contracts' ids, `team_lead` not a contract.
- `export function closeContract(contract: TaskContract, result: string, ok: boolean): TaskContract`.

- [ ] **Step 1:** Write failing tests for dependency chain, statuses, and close behavior on success/failure.
- [ ] **Step 2:** Run test — expect FAIL.
- [ ] **Step 3:** Implement with deterministic ids (`contract-${index}-${roleId}`) and redaction of `request`/`result`.
- [ ] **Step 4:** Run test — expect PASS.
- [ ] **Step 5:** Commit `feat(tasks): structured task contracts`.

---

### Task 4: Orchestration emits real events

**Files:** Modify `src/core/agent/agent.ts`, `src/core/agent/types.ts`; Test `tests/orchestration-events.test.ts`.

**Interfaces:**
- `CodingAgentOptions.eventBus?: EventBus | null` (`null` disables emission).
- `runTeam` emits: `task.created` per contract, `task.assigned`, `agent.started`, `agent.progress` (stage notices), `tool.started/result` forwarded from stage hooks, `agent.handoff`, `agent.completed`/`agent.failed`, `task.completed`/`failed`.
- Stage agents receive `eventBus: null` and `hooks.onStage/onToolStart/onToolResult` forwarding to the parent bus.

- [ ] **Step 1:** Write failing tests with a fake adapter: on a successful two-stage team assert event order contains `task.created`, `agent.started`, `agent.handoff`, `agent.completed`; on a failing stage assert `agent.failed` once and no later `agent.started`.
- [ ] **Step 2:** Run test — expect FAIL.
- [ ] **Step 3:** Wire bus into `runTeam`; emit coordinator events from parent only; add one `TaskContract[]` to task metadata.
- [ ] **Step 4:** Run test + team suite — expect PASS.
- [ ] **Step 5:** Commit `feat(agents): real orchestration events and contracts`.

---

### Task 5: Mission-control layout shell

**Files:** Create `src/tui/screens/mission-control.tsx`; Modify `src/tui/app.tsx`; Test `tests/tui-mission-control.test.tsx`.

**Interfaces:**
- `export function MissionControl(props: { context: AppContext; active: boolean; eventBus: EventBus; agentMode: AgentMode; onAgentMode: (m: AgentMode)=>void }): React.ReactElement`
- Areas with keyboard focus: `sidebar | workspace | activity | inspector | board`; focus cycles with `tab`; view switch with `1..5`; panels collapse on `columns < 92`.

- [ ] **Step 1:** Write failing tests: renders five area labels on wide terminal; on 80 columns sidebar collapses; `tab` moves focus indicator.
- [ ] **Step 2:** Run test — expect FAIL.
- [ ] **Step 3:** Implement flex layout with `useLayout`, memoized subcomponents, and focus state. Wire app.tsx to render `MissionControl` instead of `Workspace` (keep old file for compatibility).
- [ ] **Step 4:** Run test + TUI regression tests — expect PASS.
- [ ] **Step 5:** Commit `feat(tui): mission-control multi-area shell`.

---

### Task 6: Sidebar, activity feed, inspector and task board views

**Files:** Create `src/tui/screens/{agent-sidebar,activity-panel,agent-inspector,task-board}.tsx`; Test `tests/tui-agent-views.test.tsx`.

**Interfaces:**
- `AgentSidebar({ agents, activeAgentId, selectedAgentId, onSelect, collapsed })`
- `ActivityPanel({ events, selectedAgentId })`
- `AgentInspector({ definition, state, contracts, events })`
- `TaskBoard({ contracts, onSelect })`
- `deriveAgentStates(events: AgentEvent[], contracts: TaskContract[]): Record<AgentId, AgentRuntimeState>` in `registry.ts`.

- [ ] **Step 1:** Write failing tests: bus event `agent.started` sets exactly one agent to `working`; `agent.handoff` emits a real `X → Y` line; inspector shows model/provider masked (no key string); board renders contract statuses from real contracts.
- [ ] **Step 2:** Run test — expect FAIL.
- [ ] **Step 3:** Implement the four views and state derivation; no mock data.
- [ ] **Step 4:** Run test — expect PASS.
- [ ] **Step 5:** Commit `feat(tui): agent sidebar, activity feed, inspector and task board`.

---

### Task 7: Keyboard and slash commands

**Files:** Modify `src/tui/commands/registry.ts`, `src/tui/screens/mission-control.tsx`; Test `tests/tui-commands.test.tsx`.

**Interfaces:** commands `/agents`, `/agent <id>`, `/plan`, `/tasks`, `/activity`, `/review`, `/test`, `/models`, `/providers`, `/settings`; popup slash menu renders near composer; escape closes.

- [ ] **Step 1:** Write failing tests for `/agent backend` selecting the backend agent and `/agents` opening the selector popup.
- [ ] **Step 2:** Run test — expect FAIL.
- [ ] **Step 3:** Register commands; add popup component with search; wire focus/escape.
- [ ] **Step 4:** Run test — expect PASS.
- [ ] **Step 5:** Commit `feat(tui): agent commands and popup slash menu`.

---

### Task 8: Persistence, performance and docs

**Files:** Modify `agent.ts`, `registry.ts`, README; Test `tests/workspace-persistence.test.ts`.

- [ ] **Step 1:** Write failing test: after a run, task metadata contains event snapshot, contracts and agent states; a new agent loaded with that task restores them and emits no duplicate history.
- [ ] **Step 2:** Run test — expect FAIL.
- [ ] **Step 3:** Persist trimmed snapshot (max 500 events) and contracts in task metadata; restore on construction; bound history and memoize views; document shortcuts and views in README.
- [ ] **Step 4:** Run test + full targeted suite — expect PASS.
- [ ] **Step 5:** Commit `docs + persistence: recoverable multi-agent workspace`.

---

## Self-review

Spec sections map to Tasks 1–8. Review Focus tests are in Tasks 1, 4, 5, 8; at-most-one-working is in Task 6; narrow terminal in Task 5. Every task has a failing test and commit. Type names are consistent across tasks. No new dependencies.
