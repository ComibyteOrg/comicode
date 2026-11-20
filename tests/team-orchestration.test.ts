import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CodingAgent, DEFAULT_AUTHORITY } from '../src/core/agent/agent.js';
import { TEAM_ROLES, type TeamRunState } from '../src/core/agent/teams.js';
import type { AgentMode } from '../src/core/agent/modes.js';
import type { TeamStageEvent } from '../src/core/agent/types.js';
import type { AdapterContext, ProviderAdapter } from '../src/core/providers/adapter.js';
import { openStore } from '../src/core/db/store.js';
import type { ChatResponse, DiscoveredModel, ProviderProfile } from '../src/core/types.js';

const cleanup: Array<() => void> = [];
afterEach(() => {
  while (cleanup.length > 0) {
    try {
      cleanup.pop()?.();
    } catch {
      // best effort
    }
  }
});

function setup(request: string, mode: AgentMode, summaries: string[]) {
  const root = mkdtempSync(join(tmpdir(), 'comicode-team-test-'));
  cleanup.push(() => rmSync(root, { recursive: true, force: true, maxRetries: 3 }));
  const store = openStore(':memory:');
  cleanup.push(() => store.close());
  const profile = store.createProfile({
    providerId: 'openai',
    name: 'Fake',
    baseUrl: 'https://example.test/v1',
    authType: 'bearer',
    defaultModel: 'fake-model',
  });
  const discovered: DiscoveredModel = {
    modelId: 'fake-model',
    displayName: 'Fake Model',
    supportsTools: true,
    supportsStreaming: true,
    contextWindow: 128_000,
    maxOutputTokens: 8192,
  };
  store.upsertModels('openai', [discovered]);
  const task = store.createTask({
    projectPath: root,
    projectName: 'team-test',
    userRequest: request,
    taskType: 'coding',
    currentProfileId: profile.id,
    currentModelId: 'fake-model',
  });
  const stages: TeamStageEvent[] = [];
  const notices: string[] = [];
  let call = 0;
  const adapterFactory = (_profile: ProviderProfile): ProviderAdapter => ({
    kind: _profile.providerId,
    supportsStreaming: true,
    async chat(_context: AdapterContext): Promise<ChatResponse> {
      const summary = summaries[Math.min(call++, summaries.length - 1)] ?? 'STAGE_STATUS: done';
      return {
        content: '',
        toolCalls: [{ id: `c${call}`, name: 'task_complete', arguments: { summary } }],
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        finishReason: 'tool_calls',
      };
    },
    async listModels(): Promise<DiscoveredModel[]> {
      return [discovered];
    },
    async testConnection() {
      return { ok: true, latencyMs: 1, message: 'fake', modelCount: 1 };
    },
  });
  const contextFactory = async (p: ProviderProfile): Promise<AdapterContext> => ({
    profile: p,
    apiKey: 'test-key',
  });
  const makeAgent = (taskId = task.id, runMode = mode) =>
    new CodingAgent({
      store,
      taskId,
      mode: runMode,
      authority: DEFAULT_AUTHORITY,
      adapterFactory,
      contextFactory,
      hooks: {
        onStage: (event) => stages.push(event),
        onNotice: (message) => notices.push(message),
      },
    });
  return { store, task, stages, notices, makeAgent };
}

describe('dynamic team orchestration', () => {
  it('does not assemble a team for a short greeting', async () => {
    const { makeAgent, stages, notices } = setup('hi', 'auto', ['STAGE_STATUS: done']);
    await makeAgent().run();
    expect(stages).toHaveLength(0);
    expect(notices.join(' ')).not.toMatch(/Auto-selected \d+-agent team/i);
  });

  it('runs a debug prompt in debug mode without a team', async () => {
    const { makeAgent, stages, notices } = setup('fix this crash', 'auto', ['STAGE_STATUS: fixed']);
    await makeAgent().run();
    expect(notices.join(' ')).toMatch(/debug specialist/i);
    expect(stages).toHaveLength(0);
  });

  it('revisits a role when a stage reports NEEDS_REVISIT, capped at 2', async () => {
    const { makeAgent, stages } = setup('build me an ecommerce site', 'team', [
      'STAGE_STATUS: planned\nNEEDS_REVISIT: frontend',
      'STAGE_STATUS: done',
    ]);
    const result = await makeAgent().run();
    expect(result.status).toBe('completed');
    const frontendVisits = stages.filter(
      (event) => event.roleId === 'frontend' && event.status === 'start',
    );
    expect(frontendVisits.length).toBeGreaterThanOrEqual(2);
    expect(frontendVisits.length).toBeLessThanOrEqual(3);
  });

  it('resumes a saved role queue at its cursor', async () => {
    const { store, task, stages, makeAgent } = setup('build me an ecommerce site', 'team', [
      'STAGE_STATUS: done',
    ]);
    const state: TeamRunState = {
      roles: ['plan', 'frontend', 'backend'],
      cursor: 2,
      revisits: {},
      stepsUsed: 0,
      tokensUsed: 0,
    };
    store.updateTask(task.id, { metadata: { teamRun: state } });
    await makeAgent().run();
    expect(stages.find((event) => event.status === 'start')?.label).toBe(
      TEAM_ROLES.backend!.label,
    );
  });
});
