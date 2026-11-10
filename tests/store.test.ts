import { afterEach, describe, expect, it } from 'vitest';
import { openStore, type Store } from '../src/core/db/store.js';
import { DEFAULT_SETTINGS } from '../src/core/settings.js';
import type { DiscoveredModel } from '../src/core/types.js';

const stores: Store[] = [];

function makeStore(): Store {
  const store = openStore(':memory:');
  stores.push(store);
  return store;
}

afterEach(() => {
  while (stores.length > 0) {
    const store = stores.pop();
    try {
      store?.db.close();
    } catch {
      // Already closed.
    }
  }
});

const model = (modelId: string, extra: Partial<DiscoveredModel> = {}): DiscoveredModel => ({
  modelId,
  displayName: modelId,
  supportsTools: true,
  supportsStreaming: true,
  contextWindow: 128_000,
  ...extra,
});

function profileInput(store: Store, name: string, providerId: 'gemini' | 'custom' = 'gemini') {
  return store.createProfile({
    providerId,
    name,
    baseUrl: providerId === 'gemini' ? 'https://example.test/v1beta' : 'https://custom.test/v1',
    authType: providerId === 'gemini' ? 'api-key' : 'bearer',
    defaultModel: 'model-a',
    accessClassification: 'user-free',
    config: providerId === 'custom' ? { apiStyle: 'openai-compatible' } : {},
  });
}

describe('settings persistence', () => {
  it('starts from defaults and merges updates without losing nested values', () => {
    const store = makeStore();
    const initial = store.getSettings();
    expect(initial.routing.allowPaid).toBe(false);
    expect(initial.routing.preferFree).toBe(true);
    expect(initial.agent.maxSteps).toBe(DEFAULT_SETTINGS.agent.maxSteps);

    const updated = store.updateSettings((settings) => {
      settings.routing.allowPaid = true;
      settings.agent.maxSteps = 12;
      return settings;
    });
    expect(updated.routing.allowPaid).toBe(true);
    expect(updated.agent.maxSteps).toBe(12);
    expect(updated.routing.preferFree).toBe(true);

    // A new Store instance over the same DB must see the saved values.
    const reloaded = store.getSettings();
    expect(reloaded.routing.allowPaid).toBe(true);
    expect(reloaded.agent.maxSteps).toBe(12);
  });

  it('rejects invalid settings through the schema', () => {
    const store = makeStore();
    expect(() => store.saveSettings({ ...DEFAULT_SETTINGS, theme: 'neon' as never })).toThrow();
  });
});

describe('provider profile persistence', () => {
  it('creates, looks up, updates, and selects profiles', () => {
    const store = makeStore();
    const first = profileInput(store, 'Primary');
    const second = profileInput(store, 'Backup');
    expect(store.listProfiles()).toHaveLength(2);
    expect(store.findProfile('gemini', 'primary')?.id).toBe(first.id);

    store.updateProfile(first.id, { enabled: false, defaultModel: 'model-b' });
    expect(store.getProfile(first.id)?.enabled).toBe(false);
    expect(store.getProfile(first.id)?.defaultModel).toBe('model-b');

    store.setSelectedProfileId(second.id);
    store.setSelectedModelId('gemini:model-b');
    expect(store.getSelectedProfileId()).toBe(second.id);
    expect(store.getSelectedModelId()).toBe('gemini:model-b');

    store.deleteProfile(second.id);
    expect(store.getSelectedProfileId()).toBeNull();
    expect(store.listProfiles()).toHaveLength(1);
  });

  it('scopes custom endpoint catalogs per profile while sharing standard catalogs', () => {
    const store = makeStore();
    const customA = profileInput(store, 'Custom A', 'custom');
    const customB = profileInput(store, 'Custom B', 'custom');

    store.upsertModels('custom', [model('shared-model')], customA.id);
    store.upsertModels('custom', [model('shared-model')], customB.id);
    const customModels = store.listModels('custom');
    expect(customModels).toHaveLength(2);
    expect(new Set(customModels.map((entry) => entry.profileId))).toEqual(
      new Set([customA.id, customB.id]),
    );
    expect(customModels.every((entry) => entry.modelId === 'shared-model')).toBe(true);

    store.upsertModels('gemini', [model('shared-gemini')]);
    store.upsertModels('gemini', [model('shared-gemini')]);
    const geminiModels = store.listModels('gemini');
    expect(geminiModels).toHaveLength(1);
    expect(geminiModels[0]?.profileId).toBeNull();

    const customOnly = store.listModels('custom', customA.id);
    expect(customOnly).toHaveLength(1);
    expect(customOnly[0]?.profileId).toBe(customA.id);
  });
});

describe('limits', () => {
  it('keeps quotas active until their reset and expires old entries', () => {
    const store = makeStore();
    const profile = profileInput(store, 'Primary');

    store.saveLimit({
      profileId: profile.id,
      modelId: 'model-a',
      category: 'daily_quota',
      message: 'quota exhausted',
    });
    const active = store.listLimits(true);
    expect(active).toHaveLength(1);
    expect(active[0]?.category).toBe('daily_quota');
    expect(active[0]?.resetAt).toBeNull();

    // A limit whose provider-supplied reset already passed is inactive.
    store.saveLimit({
      profileId: profile.id,
      modelId: 'model-b',
      category: 'rate_limit',
      resetAt: new Date(Date.now() - 60_000).toISOString(),
    });
    expect(store.listLimits(true)).toHaveLength(1);
    const removed = store.clearExpiredLimits();
    expect(removed).toBe(1);
    expect(store.listLimits()).toHaveLength(1);

    store.clearLimit(profile.id, 'model-a');
    expect(store.listLimits(true)).toHaveLength(0);
  });

  it('supports profile-wide limits via the wildcard model', () => {
    const store = makeStore();
    const profile = profileInput(store, 'Primary');
    store.saveLimit({ profileId: profile.id, category: 'billing_restriction' });
    const limit = store.getLimit(profile.id, '*');
    expect(limit?.active).toBe(true);
    expect(limit?.category).toBe('billing_restriction');
  });
});

describe('tasks, messages, and checkpoints', () => {
  it('persists a task transcript and resume checkpoint', () => {
    const store = makeStore();
    const profile = profileInput(store, 'Primary');
    const task = store.createTask({
      projectPath: process.cwd(),
      projectName: 'comicode-test',
      userRequest: 'fix the tests',
      currentProfileId: profile.id,
      currentModelId: 'model-a',
    });

    store.appendMessage(task.id, { role: 'user', content: 'fix the tests' });
    store.appendMessage(task.id, {
      role: 'assistant',
      content: 'On it.',
      toolCalls: [{ id: 'call-1', name: 'read_file', arguments: { path: 'src/a.ts' } }],
    });
    store.appendMessage(task.id, {
      role: 'tool',
      toolCallId: 'call-1',
      name: 'read_file',
      content: 'file contents',
    });

    const messages = store.loadMessages(task.id);
    expect(messages.map((entry) => entry.role)).toEqual(['user', 'assistant', 'tool']);
    const assistant = messages[1];
    expect(assistant?.role).toBe('assistant');
    if (assistant?.role === 'assistant') {
      expect(assistant.toolCalls?.[0]?.name).toBe('read_file');
    }

    store.addAttempt(task.id, {
      profileId: profile.id,
      modelId: 'model-a',
      category: 'daily_quota',
      at: new Date().toISOString(),
    });
    expect(store.getTask(task.id)?.attempts[0]?.category).toBe('daily_quota');

    const checkpoint = store.createCheckpoint(task.id, {
      task: store.getTask(task.id)!,
      messages: [],
      summary: 'progress',
      contextCache: {},
      recentToolOutputs: [],
      savedAt: new Date().toISOString(),
    });
    expect(store.latestCheckpoint(task.id)?.id).toBe(checkpoint.id);

    store.updateTask(task.id, { status: 'completed', phase: 'done', summary: 'done' });
    expect(store.getTask(task.id)?.status).toBe('completed');

    store.deleteTask(task.id);
    expect(store.getTask(task.id)).toBeNull();
    expect(store.loadMessages(task.id)).toHaveLength(0);
  });

  it('reports usage aggregates from recorded events', () => {
    const store = makeStore();
    const profile = profileInput(store, 'Primary');
    store.recordUsage({
      taskId: null,
      profileId: profile.id,
      providerId: 'gemini',
      modelId: 'model-a',
      inputTokens: 100,
      outputTokens: 50,
      costEstimate: 0.001,
      source: 'provider',
    });
    store.recordUsage({
      taskId: null,
      profileId: profile.id,
      providerId: 'gemini',
      modelId: 'model-a',
      inputTokens: 20,
      outputTokens: 10,
      costEstimate: 0.0002,
      source: 'estimated',
    });

    const totals = store.usageTotals();
    expect(totals.inputTokens).toBe(120);
    expect(totals.outputTokens).toBe(60);
    expect(totals.events).toBe(2);
    expect(totals.cost).toBeCloseTo(0.0012, 6);

    const byModel = store.usageByModel();
    expect(byModel[0]?.modelId).toBe('model-a');
    expect(byModel[0]?.events).toBe(2);
  });
});
