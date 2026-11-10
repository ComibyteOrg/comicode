import { describe, expect, it } from 'vitest';
import type { ModelInfo, ProviderLimit, ProviderProfile, TaskType } from '../src/core/types.js';
import { DEFAULT_SETTINGS, type RoutingPolicy } from '../src/core/settings.js';
import {
  buildRoutingOutcome,
  candidateKey,
  requirementsForTask,
} from '../src/core/routing/engine.js';

function profile(
  input: Partial<ProviderProfile> & Pick<ProviderProfile, 'id' | 'providerId' | 'name'>,
): ProviderProfile {
  return {
    baseUrl: 'https://example.test/v1',
    authType: 'bearer',
    defaultModel: null,
    apiKeyEnv: null,
    enabled: true,
    accessClassification: 'unknown',
    config: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    lastSuccessAt: null,
    lastError: null,
    lastErrorAt: null,
    lastCheckedAt: null,
    modelsRefreshedAt: null,
    ...input,
  };
}

function model(owner: ProviderProfile, modelId: string, input: Partial<ModelInfo> = {}): ModelInfo {
  return {
    id: `${owner.providerId}:${modelId}`,
    providerId: owner.providerId,
    profileId: owner.providerId === 'custom' ? owner.id : null,
    modelId,
    displayName: modelId,
    contextWindow: 128_000,
    maxOutputTokens: 8192,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    codingSuitability: 3,
    reasoningSuitability: 3,
    inputPricePerMillion: null,
    outputPricePerMillion: null,
    access: 'unknown',
    accessSource: 'test',
    accessNotes: null,
    available: true,
    lastCheckedAt: null,
    userClassification: null,
    metadata: {},
    ...input,
  };
}

function limit(
  profileId: string,
  modelId: string,
  input: Partial<ProviderLimit> = {},
): ProviderLimit {
  return {
    profileId,
    modelId,
    category: 'daily_quota',
    message: 'quota exhausted',
    retryAfterAt: null,
    resetAt: null,
    attempts: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
    active: true,
    ...input,
  };
}

function policy(input: Partial<RoutingPolicy> = {}): RoutingPolicy {
  return { ...DEFAULT_SETTINGS.routing, ...input };
}

function route(input: {
  profiles: ProviderProfile[];
  models: ModelInfo[];
  limits?: ProviderLimit[];
  currentProfileId?: string | null;
  currentModelId?: string | null;
  excludeKeys?: string[];
  policy?: Partial<RoutingPolicy>;
  taskType?: TaskType;
}) {
  return buildRoutingOutcome({
    taskType: input.taskType ?? 'coding',
    profiles: input.profiles,
    models: input.models,
    limits: input.limits ?? [],
    policy: policy(input.policy),
    currentProfileId: input.currentProfileId,
    currentModelId: input.currentModelId,
    excludeKeys: input.excludeKeys,
  });
}

describe('routing engine', () => {
  const googleA = profile({
    id: 'profile-a',
    providerId: 'gemini',
    name: 'Google A',
    defaultModel: 'gemini-2.5-flash',
    accessClassification: 'user-free',
  });
  const googleB = profile({
    id: 'profile-b',
    providerId: 'gemini',
    name: 'Google B',
    defaultModel: 'gemini-2.5-pro',
    accessClassification: 'user-free',
  });
  const groq = profile({
    id: 'profile-c',
    providerId: 'groq',
    name: 'Groq',
    defaultModel: 'llama-3.3-70b-versatile',
    accessClassification: 'user-free',
  });
  const geminiFlash = model(googleA, 'gemini-2.5-flash', { codingSuitability: 4 });
  const geminiPro = model(googleA, 'gemini-2.5-pro', { codingSuitability: 5 });
  const llama = model(groq, 'llama-3.3-70b-versatile', { codingSuitability: 4 });

  it('starts with the explicitly selected model', () => {
    const outcome = route({
      profiles: [googleA, googleB, groq],
      models: [geminiFlash, geminiPro, llama],
      currentProfileId: googleA.id,
      currentModelId: 'gemini-2.5-flash',
    });
    expect(outcome.decision?.candidate.model.modelId).toBe('gemini-2.5-flash');
    expect(outcome.chain[0]?.explicit).toBe(true);
  });

  it('tries another profile of the same provider before moving across providers', () => {
    const outcome = route({
      profiles: [googleA, googleB, groq],
      models: [geminiFlash, geminiPro, llama],
      currentProfileId: googleA.id,
      currentModelId: 'gemini-2.5-flash',
      excludeKeys: [candidateKey(googleA.id, 'gemini-2.5-flash')],
    });
    expect(outcome.decision?.candidate.profile.id).toBe(googleB.id);
    expect(outcome.decision?.reason).toContain('Same-provider');
    const crossIndex = outcome.chain.findIndex((entry) => entry.profile.id === groq.id);
    const sameIndex = outcome.chain.findIndex((entry) => entry.profile.id === googleB.id);
    expect(sameIndex).toBeGreaterThanOrEqual(0);
    expect(crossIndex).toBeGreaterThan(sameIndex);
  });

  it('honors an active provider limit and falls through to the next profile', () => {
    const outcome = route({
      profiles: [googleA, googleB, groq],
      models: [geminiFlash, geminiPro, llama],
      currentProfileId: googleA.id,
      currentModelId: 'gemini-2.5-flash',
      limits: [limit(googleA.id, 'gemini-2.5-flash')],
    });
    expect(outcome.decision?.candidate.profile.id).toBe(googleB.id);
    expect(outcome.blocked.some((entry) => entry.profileId === googleA.id)).toBe(true);
  });

  it('blocks paid fallbacks by default but honors an explicit paid selection', () => {
    const paidModel = model(groq, 'paid-model', { access: 'paid' });
    const paidProfile = profile({
      id: 'paid-profile',
      providerId: 'groq',
      name: 'Paid Groq',
      defaultModel: 'paid-model',
      accessClassification: 'paid',
    });
    const blocked = route({ profiles: [paidProfile], models: [paidModel] });
    expect(blocked.decision).toBeNull();
    expect(blocked.blocked.some((entry) => /Paid model blocked/.test(entry.reason))).toBe(true);

    const explicit = route({
      profiles: [paidProfile],
      models: [paidModel],
      currentProfileId: paidProfile.id,
      currentModelId: 'paid-model',
    });
    expect(explicit.decision?.candidate.model.modelId).toBe('paid-model');
    expect(explicit.chain[0]?.explicit).toBe(true);
  });

  it('blocks unknown access when the policy forbids it', () => {
    const unknownModel = model(groq, 'mystery');
    const unknownProfile = profile({
      id: 'unknown-profile',
      providerId: 'groq',
      name: 'Mystery',
      defaultModel: 'mystery',
    });
    const outcome = route({
      profiles: [unknownProfile],
      models: [unknownModel],
      policy: { allowUnknownAccess: false },
    });
    expect(outcome.decision).toBeNull();
    expect(outcome.blocked.some((entry) => /Unknown pricing/.test(entry.reason))).toBe(true);
  });

  it('requires tool support for coding tasks', () => {
    const noTools = model(groq, 'text-only', { supportsTools: false });
    const noToolsProfile = profile({
      id: 'no-tools',
      providerId: 'groq',
      name: 'No tools',
      defaultModel: 'text-only',
      accessClassification: 'user-free',
    });
    const outcome = route({ profiles: [noToolsProfile], models: [noTools] });
    expect(outcome.decision).toBeNull();
    expect(outcome.blocked.some((entry) => /tool calling/.test(entry.reason))).toBe(true);
  });

  it('reports a clear reason when no profiles are connected', () => {
    const outcome = route({ profiles: [], models: [] });
    expect(outcome.decision).toBeNull();
    expect(outcome.blocked[0]?.reason).toMatch(/No provider profiles/);
  });

  it('describes task requirements consistently', () => {
    expect(requirementsForTask('coding').tools).toBe(true);
    expect(requirementsForTask('vision').vision).toBe(true);
    expect(requirementsForTask('reasoning').vision).toBe(false);
  });
});
