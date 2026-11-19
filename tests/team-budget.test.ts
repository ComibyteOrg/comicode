import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/core/agent/compaction.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/core/agent/compaction.js')>();
  return { ...actual, compactTask: vi.fn((store, id) => actual.compactTask(store, id)) };
});

import { compactTask } from '../src/core/agent/compaction.js';
import { CodingAgent, DEFAULT_AUTHORITY } from '../src/core/agent/agent.js';
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
  vi.clearAllMocks();
});

function setup(maxSteps?: number) {
  const root = mkdtempSync(join(tmpdir(), 'comicode-budget-test-'));
  cleanup.push(() => rmSync(root, { recursive: true, force: true, maxRetries: 3 }));
  const store = openStore(':memory:');
  cleanup.push(() => store.close());
  if (maxSteps !== undefined) {
    store.updateSettings((current) => ({
      ...current,
      agent: { ...current.agent, maxSteps },
    }));
  }
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
    projectName: 'budget-test',
    userRequest: 'build me an ecommerce site',
    taskType: 'coding',
    currentProfileId: profile.id,
    currentModelId: 'fake-model',
  });
  const estimates: Array<{ stages: number; estimatedTokens: number }> = [];
  const stages: TeamStageEvent[] = [];
  const adapterFactory = (_profile: ProviderProfile): ProviderAdapter => ({
    kind: _profile.providerId,
    supportsStreaming: true,
    async chat(_context: AdapterContext): Promise<ChatResponse> {
      return {
        content: '',
        toolCalls: [
          {
            id: `c-${Date.now()}-${Math.random()}`,
            name: 'task_complete',
            arguments: { summary: 'STAGE_STATUS: done' },
          },
        ],
        usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
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
  const agent = new CodingAgent({
    store,
    taskId: task.id,
    mode: 'team',
    authority: DEFAULT_AUTHORITY,
    adapterFactory,
    contextFactory,
    hooks: {
      onEstimate: (info) => estimates.push(info),
      onStage: (event) => stages.push(event),
    },
  });
  return { store, task, estimates, stages, agent };
}

describe('team credit budget', () => {
  it('emits a preflight estimate before the first stage', async () => {
    const { agent, estimates } = setup();
    await agent.run();
    expect(estimates.length).toBe(1);
    expect(estimates[0]!.stages).toBeGreaterThan(0);
    expect(estimates[0]!.estimatedTokens).toBeGreaterThan(0);
  });

  it('compacts the task between stages', async () => {
    const { agent } = setup();
    await agent.run();
    expect(vi.mocked(compactTask).mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it('stops at the shared step budget and pauses', async () => {
    const { agent, stages } = setup(1);
    const result = await agent.run();
    expect(result.status).toBe('paused');
    const starts = stages.filter((event) => event.status === 'start');
    expect(starts.length).toBeLessThanOrEqual(2);
  });
});
