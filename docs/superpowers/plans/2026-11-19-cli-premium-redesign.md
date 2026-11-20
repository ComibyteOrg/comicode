# CLI Premium Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the terminal the premium primary interface with reliable character-level highlighting, model-first cross-provider routing, prompt-driven revisitable subagent teams with automatic specialist selection, and a shared credit budget.

**Architecture:** Keep the existing `CodingAgent` loop as the single execution engine. Routing gains an exact-model candidate pass in `engine.ts`. Team orchestration moves from fixed arrays to a persisted role queue with revisits, driven by a deterministic resolver plus an optional cheap planner. The TUI stays Ink flex-box: a polished single pane with a collapsible side panel, and a selection model that owns focus while active. No new dependencies.

**Tech Stack:** TypeScript strict, Node 22.13+, Ink 8, React 19, Vitest 5, existing SQLite store, no new npm packages.

**Spec:** `docs/superpowers/specs/2026-11-19-cli-premium-redesign-design.md`

## Global Constraints

- Node.js **22.13+**; TypeScript strict (`noUncheckedIndexedAccess`); ESM `.js` import specifiers in `src`.
- **No new npm dependencies and no extra install size.** Reuse `playwright-core`, `zod`, `ink`, `react`.
- The terminal is the **primary** interface; the web dashboard stays an optional alternative and must keep working.
- Preserve all existing commands, settings, task/resume behavior, provider-switch consent, free-first routing and paid gating.
- Ink render options stay: `alternateScreen: false`, `incrementalRendering: false`, `exitOnCtrlC: false`, `maxFps: 30`.
- Must work in narrow terminals: `compact` when `columns < 92`; side panel collapses below 112 columns.
- No telemetry; secrets stay redacted; clipboard fallback must not write secrets outside `.comicode/`.

## Review Focus

These are the inputs/conditions most likely to break in real use. Each has a test in the owning task.

1. A model ID exists on another provider but was never discovered there → exact-model candidate is still produced via `syntheticModel`. Test: Task 1.
2. A team stage returns `NEEDS_REVISIT: frontend` → the named role runs again, with a hard revisit cap. Test: Task 3.
3. All candidates are quota-exhausted mid-team → the run pauses with the role queue persisted and resumes at the same cursor. Test: Task 4.
4. Selection mode is active while the agent streams → `a` and `shift+←/→` change the selection, not the composer, and the copied text is exactly the highlighted span. Test: Task 5.
5. A narrow terminal with the side panel enabled → panel collapses, transcript still renders and scrolls. Test: Task 6.

---

### Task 1: Exact-model cross-provider routing

**Files:**
- Modify: `src/core/routing/engine.ts`
- Test: `tests/routing-exact-model.test.ts` (create)

**Interfaces:**
- Consumes: `RoutingRequest`, `RankedCandidate`, `candidateKey`, `syntheticModel`, `findModel`, `buildRoutingOutcome`, `selectRoute` (all in `engine.ts`).
- Produces: `export function findExactModelCandidates(request: RoutingRequest, modelId: string): RankedCandidate[]` — one eligible candidate per connected provider exposing `modelId`, using `syntheticModel` when the ID is undiscovered; respects `excludeKeys`, `excludedProfileIds`, active limits, requirements and paid gating. `buildRoutingOutcome` places these candidates at the head of `chain`, and `rank()` grants the `sameModel` bonus regardless of provider.

- [ ] **Step 1: Write failing tests**

```ts
it('tries the exact model on another provider before same-provider alternatives', () => {
  // two profiles: nvidia (quota-limited for model X), kilo (has model X), nvidia (model Y)
  const outcome = buildRoutingOutcome(requestWith({ currentModelId: 'X', excludeKeys: [key('nvidia','X')] }));
  expect(outcome.chain[0]!.model.modelId).toBe('X');
  expect(outcome.chain[0]!.profile.providerId).toBe('kilo');
});

it('produces a synthetic exact-model candidate for an undiscovered model id', () => {
  const outcome = buildRoutingOutcome(requestWith({ currentModelId: 'deepseek-v4.1-flash' }));
  expect(outcome.chain.some((c) => c.model.modelId === 'deepseek-v4.1-flash' && c.model.metadata.source === 'routing-synthetic')).toBe(true);
});

it('does not resurrect excluded providers or paid models when allowPaid is false', () => {
  const outcome = buildRoutingOutcome(requestWith({ excludedProfileIds: ['kilo'], allowPaid: false }));
  expect(outcome.chain.every((c) => c.profile.id !== 'kilo')).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/routing-exact-model.test.ts`
Expected: FAIL — `findExactModelCandidates` is not exported / chain starts with same-provider alternative.

- [ ] **Step 3: Implement in `src/core/routing/engine.ts`**

Add `findExactModelCandidates(request, modelId)` after `findModel`. Normalize IDs with `trim().toLowerCase()`. Enumerate `request.profiles` (skip disabled, excluded, actively limited), resolve the model with `findModel` or `syntheticModel(profile, modelId)`, apply `meetsRequirements`, free/paid access filtering and `excludeKeys`. In `buildRoutingOutcome`, spread these candidates before the explicit/same-provider passes and dedupe by `candidateKey`. In `rank()`, remove the `&& sameProviderId` condition from the `sameModel` bonus. Widen the chain cap to `Math.min(24, Math.max(maxFallbacks + 1, new Set(request.profiles.map(p => p.providerId)).size))`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/routing-exact-model.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Run full suite and commit**

Run: `npm run verify`
Expected: typecheck, lint, all tests, build pass.
Commit: `git add src/core/routing/engine.ts tests/routing-exact-model.test.ts && git commit -m "feat(routing): try exact model on other providers first"`

---

### Task 2: Team role model and intent resolver

**Files:**
- Modify: `src/core/agent/teams.ts`
- Test: `tests/team-roles-dynamic.test.ts` (create)

**Interfaces:**
- Consumes: `TeamRole`, `TEAM_ROLES`, `AgentMode`, `buildStagePrompt`, `buildHandoffNote`.
- Produces:
  - `TeamRoleId` extended with `'plan' | 'frontend' | 'backend' | 'debug'`; `TEAM_ROLES.plan` uses the existing `plan` mode and `reasoning` task type.
  - `export interface TeamPlan { roles: TeamRoleId[]; source: 'rules' | 'planner'; revisitLimit: number; }`
  - `export interface TeamRunState { roles: TeamRoleId[]; cursor: number; revisits: Record<string, number>; stepsUsed: number; tokensUsed: number; }`
  - `export function resolveTeamPlan(text: string, mode: AgentMode): TeamPlan` — deterministic rules for common intents; `source: 'planner'` only for vague/org-wide prompts (planner execution belongs to Task 3).
  - `export function parseStageDirective(text: string): { status: string | null; revisit: TeamRoleId | null }` — parses `STAGE_STATUS:` and `NEEDS_REVISIT:` lines.
  - `export function buildStagePrompt(role: TeamRole, originalRequest: string, latestHandoff: string | null): string` — replaces the `handoffs: string[]` parameter; embeds only the latest note.
  - `export function selectTeamRoles(text: string, mode: AgentMode): TeamRole[]` — retained as `resolveTeamPlan(text, mode).roles.map(id => TEAM_ROLES[id])` for compatibility.

- [ ] **Step 1: Write failing tests**

```ts
it('plans frontend then backend then security for an ecommerce build', () => {
  expect(resolveTeamPlan('build me an ecommerce site', 'auto').roles).toEqual([
    'plan', 'frontend', 'backend', 'security', 'review',
  ]);
});

it('maps a debugging prompt to the debug specialist', () => {
  expect(resolveTeamPlan('fix this crash in the login flow', 'auto').roles).toEqual(['debug']);
});

it('parses revisit directives from a stage result', () => {
  expect(parseStageDirective('STAGE_STATUS: schema done\nNEEDS_REVISIT: frontend')).toEqual({
    status: 'schema done', revisit: 'frontend',
  });
});

it('embeds only the latest handoff in a stage prompt', () => {
  const prompt = buildStagePrompt(TEAM_ROLES.backend!, 'req', 'latest note');
  expect(prompt).toContain('latest note');
  expect(prompt).not.toContain('older note');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/team-roles-dynamic.test.ts`
Expected: FAIL — new exports missing.

- [ ] **Step 3: Implement in `src/core/agent/teams.ts`**

Add canonical roles `plan` (mode `plan`, taskType `reasoning`), `frontend` (mode `design`, taskType `vision`), `backend` (mode `build`, taskType `coding`), `debug` (mode `debug`, taskType `reasoning`), each with `STAGE_STATUS` instructions. Replace `TEAM_PIPELINES`/`selectTeamRoles` internals with `resolveTeamPlan`: ordered keyword intents for build/website/ecommerce/debug/security/test/docs/explain/marketing/devops; `source: 'planner'` for org-wide or <2 matched intents; `revisitLimit: 2`. Implement `parseStageDirective` with anchored regexes, case-insensitive, clipped to 300 chars per value. Change `buildStagePrompt` to the 3-arg signature and pass `latestHandoff` as a single block.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/team-roles-dynamic.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

Run: `npm run verify`
Commit: `git add src/core/agent/teams.ts tests/team-roles-dynamic.test.ts && git commit -m "feat(teams): add dynamic role resolver and revisit directives"`

---

### Task 3: Queue-driven team execution and automatic specialist dispatch

**Files:**
- Modify: `src/core/agent/agent.ts`, `src/core/agent/types.ts`
- Test: `tests/team-orchestration.test.ts` (create)

**Interfaces:**
- Consumes: `resolveTeamPlan`, `TeamPlan`, `TeamRunState`, `parseStageDirective`, `buildStagePrompt`, `buildHandoffNote`, `TEAM_ROLES`, `Router.select`, `AgentHooks.onStage`.
- Produces: `private async runTeam(options: AgentRunOptions): Promise<AgentResult>` now iterates a work queue from `task.metadata.teamRun`; `CodingAgent.mode` becomes mutable (`private mode: AgentMode`) and a new `private teamPlanOverride: TeamPlan | null` field is added. `CodingAgent.run()` triggers the team when `this.mode === 'team'`, when an auto/build prompt resolves to >1 roles, or when a persisted `teamRun` exists. Single-focus auto prompts set `this.mode` to the specialist's mode and run the normal loop. `AgentRunOptions` gains `skipCollaboration?: boolean`.

- [ ] **Step 1: Write failing tests** (local helper `makeAgent(options) -> { agent, notices, stages, firstResult }` captures `onNotice` and `onStage`)

```ts
it('runs a debug prompt in debug mode without a team', async () => {
  const { agent, notices, stages } = makeAgent({ mode: 'auto', request: 'fix this crash' });
  await agent.run();
  expect(notices.join(' ')).toMatch(/debug specialist/i);
  expect(stages).toHaveLength(0);
});

it('revisits a role when a stage reports NEEDS_REVISIT, capped at 2', async () => {
  const { agent, stages } = makeAgent({ mode: 'team', request: 'build an ecommerce site', fakeResponses: ['NEEDS_REVISIT: frontend', 'done'] });
  await agent.run();
  expect(stages.map((e) => e.roleId)).toContain('frontend');
  expect(stages.filter((e) => e.roleId === 'frontend').length).toBeLessThanOrEqual(3);
});

it('persists the queue cursor and resumes at the same stage', async () => {
  const first = makeAgent({ mode: 'team', request: 'build an ecommerce site' });
  const firstResult = await first.agent.run({ maxSteps: 1 });
  const resumed = makeAgent({ taskId: firstResult.taskId, resume: true });
  await resumed.agent.run();
  expect(resumed.stages[0]!.label).toBe(first.stages.at(-1)!.label);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/team-orchestration.test.ts`
Expected: FAIL — no automatic specialist dispatch / no revisit.

- [ ] **Step 3: Implement in `src/core/agent/agent.ts` and `types.ts`**

In the constructor, when `requestedMode` is `auto` or `build`, call `resolveTeamPlan(task.userRequest ?? task.summary ?? '', requestedMode)`. If it has >1 roles, store `this.teamPlanOverride` and keep mode `team`; if exactly 1 role with a distinct mode, set `this.mode` to that role's mode and emit an `onNotice` naming the specialist. In `run()`, trigger `runTeam` for `this.mode === 'team' || this.teamPlanOverride !== null`. Replace the linear `for` loop with a queue seeded from `task.metadata.teamRun ?? resolveTeamPlan(...).roles`; on each stage, parse the final summary with `parseStageDirective`, push `revisit` to the front of the queue while `state.revisits[role] < plan.revisitLimit`, persist `state` via `store.updateTask`, and emit `onStage` for every visit. Pass `skipCollaboration: true` to stage agents. Keep the existing consent/handoff/model-selection paths.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/team-orchestration.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

Run: `npm run verify`
Commit: `git add src/core/agent/agent.ts src/core/agent/types.ts tests/team-orchestration.test.ts && git commit -m "feat(agent): dynamic team queue and auto specialist dispatch"`

---

### Task 4: Shared credit budget, stage compaction and preflight estimate

**Files:**
- Modify: `src/core/agent/agent.ts`, `src/core/agent/types.ts`, `src/cli/shared.ts`
- Test: `tests/team-budget.test.ts` (create)

**Interfaces:**
- Consumes: `TeamRunState`, `compactTask(store, taskId)`, `BuiltContext.estimatedTokens`, `AgentHooks.onStage`, `AgentRunOptions.skipCollaboration`.
- Produces: `AgentHooks.onEstimate?: (info: { stages: number; estimatedTokens: number; tokenBudget: number; stepBudget: number }) => void`; team stages share `state.stepsUsed`/`state.tokensUsed`, compact the task between stages, and stop with a paused result when the budget is exhausted. `skipCollaboration` suppresses planner/reviewer/tester passes inside a stage.

- [ ] **Step 1: Write failing tests**

```ts
it('compacts the task between team stages', async () => {
  const agent = makeAgent({ mode: 'team', request: 'build an ecommerce site' });
  await agent.run();
  expect(compactSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
});

it('stops the team at the shared step budget', async () => {
  const agent = makeAgent({ mode: 'team', request: 'full organization', budget: { steps: 3 } });
  await agent.run();
  expect(agent.stagesForTest().length).toBeLessThanOrEqual(3);
  expect(agent.lastResultForTest()!.status).toBe('paused');
});

it('emits a preflight estimate before the first stage', async () => {
  await makeAgent({ mode: 'team', request: 'build a site' }).run();
  expect(estimateEvents[0]!.stages).toBeGreaterThan(0);
  expect(estimateEvents[0]!.estimatedTokens).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/team-budget.test.ts`
Expected: FAIL — no estimate hook, no compaction, budget ignored.

- [ ] **Step 3: Implement**

Add `onEstimate` to `AgentHooks` in `types.ts`. In `runTeam`: compute `stages = queue.length`, `estimatedTokens = stages * 6_000` capped by effort budget, `tokenBudget = effort.contextBudgetRatio * 120_000 * stages` scaled down to the ≤2× target, `stepBudget = max(6, settings.agent.maxSteps * 2)`; emit once before the loop. Decrement `state.stepsUsed` from each stage result and `state.tokensUsed` from `result.usage`; pause when either exceeds budget. Call `compactTask(this.store, this.task.id)` after each completed stage (not after the last). In `run()`, when `options.skipCollaboration` is true, skip `runPlannerIfEnabled`, `testIfEnabled`, `reviewIfEnabled` and the verification nudge. In `cli/shared.ts`, print the estimate with existing `dim()` helper when `hooks.onEstimate` fires and `json` is false.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/team-budget.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

Run: `npm run verify`
Commit: `git add src/core/agent/agent.ts src/core/agent/types.ts src/cli/shared.ts tests/team-budget.test.ts && git commit -m "feat(teams): shared budget, stage compaction and estimate"`

---

### Task 5: Reliable character-level highlighting

**Files:**
- Modify: `src/tui/screens/workspace.tsx`, `src/tui/components.tsx`, `src/core/clipboard.ts`
- Test: `tests/tui-highlight.test.tsx` (create)

**Interfaces:**
- Consumes: `selection`, `frozenEntries`, `selectionMode`, `PromptInput`, `copyToClipboard`, `isSuppressedInput`.
- Produces: `copyTextOrFile(text: string, cwd: string): Promise<{ ok: boolean; path?: string }>` in `clipboard.ts`; character caret state `charSelection: { entryId: number; start: number; end: number } | null` in `Workspace`; selection keys `shift+←/→/home/end` and copied text equal to the selected substring.

- [ ] **Step 1: Write failing tests** (local helpers: `enterSelectionMode()` sends `ctrl+y`, `inputText()` returns the text after the last `❯` in `frame()`, `readClipboardOrFallback()` reads `.comicode/selection.txt` when the OS clipboard is empty)

```ts
it('does not send selection keys to the composer while selecting', async () => {
  await enterSelectionMode();
  await send('a'); // select all
  expect(inputText()).toBe('');
  expect(frame()).toContain('▸');
});

it('copies exactly the character span selected with shift+arrow', async () => {
  await enterSelectionMode();
  await send(`${ESC}[1;2D`); // shift+left
  await send(`${ESC}[1;2C`); // shift+right
  expect(await readClipboardOrFallback()).toContain('highlight me');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tui-highlight.test.tsx`
Expected: FAIL — selection keys land in the prompt / no character span.

- [ ] **Step 3: Implement**

In `workspace.tsx`: `PromptInput focus={active && !dimmed && !selectionMode}`; keep the existing selection handler `isActive` condition. Add `charSelection` state; on `shift+←/→` and `shift+home/end` in selection mode, set/extend `start`/`end` within `selection.focus`, clamp to entry text length, and scroll to that entry. In `EntryCard`, accept `charRange?: { start: number; end: number }` and render the body as three `Text` spans (before/selected/after) with `backgroundColor: theme.accent`, `color: theme.black` on the selected span. In `copy`, if `charSelection` exists copy only that substring, else copy the selected entries as today. Replace the toast text in `app.tsx` with the real keys. In `clipboard.ts`, add `copyTextOrFile`: try `copyToClipboard`, on failure write `<cwd>/.comicode/selection.txt` (mkdir recursive) and return `{ ok: true, path }`; return `{ ok: false }` only if both fail.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/tui-highlight.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

Run: `npm run verify`
Commit: `git add src/tui/screens/workspace.tsx src/tui/components.tsx src/tui/app.tsx src/core/clipboard.ts tests/tui-highlight.test.tsx && git commit -m "fix(tui): character-level highlighting and focus arbitration"`

---

### Task 6: Hybrid premium terminal layout

**Files:**
- Modify: `src/tui/app.tsx`, `src/tui/theme.ts`, `src/tui/components.tsx`, `src/tui/screens/workspace.tsx`, `src/tui/shortcuts/manager.ts`
- Create: `src/tui/screens/side-panel.tsx`
- Test: `tests/tui-layout.test.tsx` (create)

**Interfaces:**
- Consumes: `useLayout`, `theme`, `stages`, `plan`, `route`, `usage`, `agentMode`, `AgentStatus`.
- Produces: `export function SidePanel(props: { stages: TeamStageEvent[]; plan: TaskPlan | null; route: string | null; usage: { inputTokens: number; outputTokens: number }; agentMode: AgentMode; onClose: () => void }): React.ReactElement`; `Workspace` gains props `sidePanel?: boolean` and `onToggleSidePanel?: () => void`; app state `sidePanelVisible` defaults to `columns >= 112`. A new shortcut id `panel` with default binding `ctrl+shift+a` is added to `src/tui/shortcuts/manager.ts` and handled in `app.tsx` before the dialog guard; the test imports that binding as `PANEL_KEY`.

- [ ] **Step 1: Write failing tests**

```ts
it('shows the side panel on a wide terminal and hides it on a narrow one', async () => {
  const wide = await renderAppWithColumns(120);
  expect(frame(wide)).toContain('TEAMS');
  const narrow = await renderAppWithColumns(80);
  expect(frame(narrow)).not.toContain('TEAMS');
});

it('toggles the side panel with the panel key', async () => {
  renderAppWithColumns(120);
  await send(PANEL_KEY);
  expect(frame()).not.toContain('TEAMS');
  await send(PANEL_KEY);
  expect(frame()).toContain('TEAMS');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tui-layout.test.tsx`
Expected: FAIL — no side panel.

- [ ] **Step 3: Implement**

Create `side-panel.tsx` with a `Box width={26}` containing: active team stage rail (`▸/✓/✗` + label + model), a compact todo list from `plan.steps`, route line, token counters and the agent mode. In `shortcuts/manager.ts`, add `panel` with default `ctrl+shift+a`. In `app.tsx`, add `sidePanelVisible` state initialized from `columns >= 112`, handle `shortcutMatches('panel', ...)` before the dialog guard, and pass `sidePanel`/`onToggleSidePanel` to `Workspace`. In `workspace.tsx`, compute `sideWidth = sidePanel ? 28 : 0`, `mainWidth = Math.max(30, columns - sideWidth - 6)`, use `mainWidth` for `bodyWidth` and `rows - 20` for `lineBudget`; render `<SidePanel .../>` as a sibling of the transcript column inside the existing row `Box`. Add theme tokens `panelAlt` and `accentSoft` to `ThemeTokens` and all 13 themes (use `surfaceAlt`/`accentDim` values where appropriate). Rebuild header/footer in `components.tsx` as a single status strip: brand, mode, route, stage, tokens, status pill; keep it truncated on `compact`. Use consistent `margin`/`padding` spacing and role glyphs already in `theme.glyph`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/tui-layout.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

Run: `npm run verify`
Commit: `git add src/tui tests/tui-layout.test.tsx && git commit -m "feat(tui): hybrid cockpit layout with collapsible side panel"`

---

### Task 7: Documentation and final verification

**Files:**
- Modify: `README.md`, commit the design doc and this plan.

**Interfaces:**
- Consumes: all tasks above.
- Produces: README sections matching the shipped behavior (new keys, team behavior, routing order, credit controls, highlighting keys).

- [ ] **Step 1: Update README**

Replace the current TUI shortcut table with the actual final keys, add a "Choosing the right agent" subsection describing auto-specialist vs auto-team, update the routing explanation to state exact-model-on-other-providers first, and list the highlighting keys. Keep the CLI primary and web dashboard secondary.

- [ ] **Step 2: Run final verification**

Run: `npm run verify`
Expected: typecheck, lint, all tests, build pass; no new dependencies in `package.json`; `git status --short` clean after commit.

- [ ] **Step 3: Commit and push**

```bash
git add README.md docs/superpowers/specs/2026-11-19-cli-premium-redesign-design.md docs/superpowers/plans/2026-11-19-cli-premium-redesign.md
git commit -m "docs: update README for premium CLI redesign"
git push origin main
```

---

## Self-review notes

- Spec coverage: TUI hybrid (Task 6), highlighting (Task 5), cross-provider exact model (Task 1), dynamic teams + debug + revisit (Tasks 2–3), credit control and estimate (Task 4), no new deps (global constraints + Task 7 verification).
- Review Focus tests are pinned in Tasks 1, 3, 4, 5, 6.
- Type names are consistent: `TeamPlan`, `TeamRunState`, `findExactModelCandidates`, `resolveTeamPlan`, `parseStageDirective`, `copyTextOrFile`, `SidePanel`, `onEstimate`, `skipCollaboration`.
- Every task ends with an independently runnable test file and a commit.
