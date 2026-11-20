import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CodingAgent, DEFAULT_AUTHORITY } from '../src/core/agent/agent.js';
import { EventBus } from '../src/core/events/bus.js';
import type { AgentEvent } from '../src/core/events/types.js';
import type { AdapterContext, ProviderAdapter } from '../src/core/providers/adapter.js';
import { ProviderError } from '../src/core/providers/errors.js';
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

function setup(fail: boolean) {
  const root = mkdtempSync(join(tmpdir(), 'comicode-events-test-'));
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
    projectName: 'events-test',
    userRequest: 'build me an ecommerce site',
    taskType: 'coding',
    currentProfileId: profile.id,
    currentModelId: 'fake-model',
  });
  const bus = new EventBus();
  const events: AgentEvent[] = [];
  bus.subscribe((event) => events.push(event));
  const adapterFactory = (_profile: ProviderProfile): ProviderAdapter => ({
    kind: _profile.providerId,
    supportsStreaming: true,
    async chat(_context: AdapterContext): Promise<ChatResponse> {
      if (fail) {
        throw new ProviderError({
          category: 'invalid_request',
          providerId: _profile.providerId,
          message: 'stage failed',
          status: 400,
        });
      }
      return {
        content: '',
        toolCalls: [
          {
            id: `c-${Date.now()}-${Math.random()}`,
            name: 'task_complete',
            arguments: { summary: 'STAGE_STATUS: stage done' },
          },
        ],
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
  const agent = new CodingAgent({
    store,
    taskId: task.id,
    mode: 'team',
    authority: DEFAULT_AUTHORITY,
    adapterFactory,
    contextFactory,
    eventBus: bus,
  });
  return { agent, events, task, store };
}

describe('orchestration events', () => {
  it('emits real task, agent and handoff events from a successful team', async () => {
    const { agent, events } = setup(false);
    await agent.run();
    const types = events.map((event) => event.type);
    expect(types).toContain('task.created');
    expect(types).toContain('task.assigned');
    expect(types).toContain('agent.started');
    expect(types).toContain('agent.handoff');
    expect(types).toContain('agent.completed');
    expect(events.filter((event) => event.type === 'agent.started').length).toBeGreaterThan(1);
  });

  it('emits agent.failed once and stops later stages on failure', async () => {
    const { agent, events } = setup(true);
    await agent.run();
    const failures = events.filter((event) => event.type === 'agent.failed');
    expect(failures.length).toBe(1);
    const firstStart = events.findIndex((event) => event.type === 'agent.started');
    const laterStarts = events.slice(firstStart + 1).filter((event) => event.type === 'agent.started');
    expect(laterStarts.length).toBe(0);
  });

  it('persists contracts in task metadata', async () => {
    const { agent, store, task } = setup(false);
    await agent.run();
    const contracts = store.getTask(task.id)?.metadata.taskContracts;
    expect(Array.isArray(contracts)).toBe(true);
    expect((contracts as unknown[]).length).toBeGreaterThan(1);
  });

  it('persists a bounded event snapshot for restart recovery', async () => {
    const { agent, store, task } = setup(false);
    await agent.run();
    const snapshot = store.getTask(task.id)?.metadata.agentEvents as AgentEvent[] | undefined;
    expect(Array.isArray(snapshot)).toBe(true);
    expect(snapshot!.length).toBeGreaterThan(1);
    expect(snapshot!.length).toBeLessThanOrEqual(500);
    expect(snapshot!.every((event) => typeof event.timestamp === 'string')).toBe(true);
  });
});
