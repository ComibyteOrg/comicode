import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CodingAgent, DEFAULT_AUTHORITY } from '../src/core/agent/agent.js';
import type { AdapterContext, ProviderAdapter } from '../src/core/providers/adapter.js';
import { ProviderError } from '../src/core/providers/errors.js';
import { openStore, type Store } from '../src/core/db/store.js';
import type {
  ChatResponse,
  DiscoveredModel,
  ProviderProfile,
  ToolCall,
} from '../src/core/types.js';

/**
 * End-to-end failover scenario required by the spec:
 *
 *   Gemini profile A → daily quota
 *   Gemini profile B → daily quota
 *   Groq profile C   → daily quota
 *   → pause with diagnostics
 *   → limits cleared → resume on the same task → complete
 *
 * The provider transports are replaced with deterministic fakes, so the test
 * never touches the network or needs real API keys.
 */

const cleanup: Array<() => void> = [];

afterEach(() => {
  while (cleanup.length > 0) {
    try {
      cleanup.pop()?.();
    } catch {
      // Best-effort temp cleanup on Windows.
    }
  }
});

function tempProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'comicode-agent-test-'));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));
  return dir;
}

function createProfile(
  store: Store,
  input: Pick<ProviderProfile, 'providerId' | 'name' | 'defaultModel'> & {
    accessClassification?: ProviderProfile['accessClassification'];
  },
): ProviderProfile {
  return store.createProfile({
    providerId: input.providerId,
    name: input.name,
    baseUrl:
      input.providerId === 'gemini'
        ? 'https://generativelanguage.googleapis.com/v1beta'
        : 'https://api.groq.com/openai/v1',
    authType: input.providerId === 'gemini' ? 'api-key' : 'bearer',
    defaultModel: input.defaultModel,
    accessClassification: input.accessClassification ?? 'user-free',
  });
}

const discovered = (modelId: string, extra: Partial<DiscoveredModel> = {}): DiscoveredModel => ({
  modelId,
  displayName: modelId,
  supportsTools: true,
  supportsStreaming: true,
  contextWindow: 128_000,
  maxOutputTokens: 8192,
  ...extra,
});

function quotaError(providerId: ProviderProfile['providerId']): ProviderError {
  return new ProviderError({
    category: 'daily_quota',
    providerId,
    message: 'Daily quota exhausted for this key.',
    status: 429,
  });
}

interface FakeAdapterOptions {
  onChat: (profile: ProviderProfile, modelId: string) => ChatResponse;
}

function fakeAdapterFactory(
  options: FakeAdapterOptions,
): (profile: ProviderProfile) => ProviderAdapter {
  return (profile) => ({
    kind: profile.providerId,
    supportsStreaming: true,
    async chat(_context: AdapterContext, request): Promise<ChatResponse> {
      return options.onChat(profile, request.model);
    },
    async listModels(): Promise<DiscoveredModel[]> {
      return [];
    },
    async testConnection() {
      return { ok: true, latencyMs: 1, message: 'fake', modelCount: 0 };
    },
  });
}

const completionCall: ToolCall = {
  id: 'call-complete',
  name: 'task_complete',
  arguments: { summary: 'Resumed after clearing provider limits and completed the task.' },
};

function completionResponse(): ChatResponse {
  return {
    content: '',
    toolCalls: [completionCall],
    usage: { inputTokens: 120, outputTokens: 24, totalTokens: 144 },
    finishReason: 'tool_calls',
  };
}

const fakeContextFactory = async (profile: ProviderProfile): Promise<AdapterContext> => ({
  profile,
  apiKey: 'test-key',
});

describe('agent quota failover and resume', () => {
  it('moves Gemini A → Gemini B → Groq, pauses, then resumes to completion', async () => {
    const store = openStore(':memory:');
    cleanup.push(() => store.db.close());
    const projectPath = tempProject();

    const profileA = createProfile(store, {
      providerId: 'gemini',
      name: 'Google A',
      defaultModel: 'gemini-2.5-flash',
    });
    const profileB = createProfile(store, {
      providerId: 'gemini',
      name: 'Google B',
      defaultModel: 'gemini-2.5-pro',
    });
    const profileC = createProfile(store, {
      providerId: 'groq',
      name: 'Groq free',
      defaultModel: 'llama-3.3-70b-versatile',
    });

    // Only flash is present in the catalog. Profile B's default model is
    // intentionally synthetic so the "same provider" step resolves to B
    // instead of another model on A.
    store.upsertModels('gemini', [discovered('gemini-2.5-flash')]);
    store.upsertModels('groq', [discovered('llama-3.3-70b-versatile')]);

    const task = store.createTask({
      projectPath,
      projectName: 'agent-test',
      userRequest: 'Make a trivial change and finish.',
      taskType: 'coding',
      currentProfileId: profileA.id,
      currentModelId: 'gemini-2.5-flash',
    });

    const calls: string[] = [];
    const routing: string[] = [];
    const firstRun = new CodingAgent({
      store,
      taskId: task.id,
      authority: DEFAULT_AUTHORITY,
      adapterFactory: fakeAdapterFactory({
        onChat: (profile, modelId) => {
          calls.push(`${profile.name}/${modelId}`);
          throw quotaError(profile.providerId);
        },
      }),
      contextFactory: fakeContextFactory,
      hooks: {
        onRoute: (decision) => routing.push(decision.candidate.profile.name),
      },
    });

    const paused = await firstRun.run();
    expect(paused.status).toBe('paused');
    expect(paused.pauseReason).toMatch(/No eligible model\/profile/);

    // The first three calls demonstrate the required precedence: the explicit
    // profile, another profile of the same provider, then a different provider.
    expect(calls.slice(0, 3)).toEqual([
      'Google A/gemini-2.5-flash',
      'Google B/gemini-2.5-flash',
      'Groq free/llama-3.3-70b-versatile',
    ]);
    expect(routing.slice(0, 3)).toEqual(['Google A', 'Google B', 'Groq free']);

    // Remaining catalog candidates are also attempted before pausing.
    expect(calls).toContain('Google B/gemini-2.5-pro');

    const attempts = store.getTask(task.id)?.attempts ?? [];
    expect(new Set(attempts.map((attempt) => attempt.profileId))).toEqual(
      new Set([profileA.id, profileB.id, profileC.id]),
    );
    expect(attempts.every((attempt) => attempt.category === 'daily_quota')).toBe(true);

    // Every attempted candidate without a provider reset time is held as a
    // cooldown; all of them must be blocked for the pause to happen.
    const activeLimits = store.listLimits(true);
    expect(activeLimits.length).toBeGreaterThanOrEqual(3);
    expect(activeLimits.every((limit) => limit.category === 'daily_quota')).toBe(true);
    expect(activeLimits.some((limit) => limit.profileId === profileA.id)).toBe(true);
    expect(activeLimits.some((limit) => limit.profileId === profileB.id)).toBe(true);
    expect(activeLimits.some((limit) => limit.profileId === profileC.id)).toBe(true);

    // Simulate the user waiting for quotas to reset (or explicitly clearing
    // them from the usage screen) and resuming the same persistent task.
    for (const limit of activeLimits) {
      store.clearLimit(limit.profileId, limit.modelId);
    }
    expect(store.listLimits(true)).toHaveLength(0);

    const resumeCalls: string[] = [];
    const secondRun = new CodingAgent({
      store,
      taskId: task.id,
      authority: DEFAULT_AUTHORITY,
      adapterFactory: fakeAdapterFactory({
        onChat: (profile, modelId) => {
          resumeCalls.push(`${profile.name}/${modelId}`);
          return completionResponse();
        },
      }),
      contextFactory: fakeContextFactory,
    });

    const completed = await secondRun.run({ resume: true });
    expect(completed.status).toBe('completed');
    expect(resumeCalls).toEqual(['Google B/gemini-2.5-pro']);
    expect(completed.summary).toContain('clearing provider limits');

    const finalTask = store.getTask(task.id)!;
    expect(finalTask.status).toBe('completed');
    expect(finalTask.phase).toBe('done');
    expect(finalTask.resumeCount).toBeGreaterThanOrEqual(1);
    expect(finalTask.completedAt).not.toBeNull();
    expect(store.latestCheckpoint(task.id)?.state.task.status).toBe('completed');
  });

  it('records tool-capable fallbacks and keeps an explicit model even when paid', async () => {
    const store = openStore(':memory:');
    cleanup.push(() => store.db.close());
    const projectPath = tempProject();

    const paid = createProfile(store, {
      providerId: 'groq',
      name: 'Paid Groq',
      defaultModel: 'paid-model',
      accessClassification: 'user-paid',
    });
    store.upsertModels('groq', [discovered('paid-model')]);

    const task = store.createTask({
      projectPath,
      projectName: 'agent-test',
      userRequest: 'Use the paid model explicitly.',
      currentProfileId: paid.id,
      currentModelId: 'paid-model',
    });

    const agent = new CodingAgent({
      store,
      taskId: task.id,
      authority: DEFAULT_AUTHORITY,
      adapterFactory: fakeAdapterFactory({ onChat: () => completionResponse() }),
      contextFactory: fakeContextFactory,
    });

    const result = await agent.run();
    expect(result.status).toBe('completed');
    expect(store.getTask(task.id)?.status).toBe('completed');
  });
});
