import { describe, expect, it } from 'vitest';
import type { ModelInfo, ProviderProfile } from '../src/core/types.js';
import { DEFAULT_SETTINGS } from '../src/core/settings.js';
import { buildRoutingOutcome } from '../src/core/routing/engine.js';

function profile(id: string, providerId: ProviderProfile['providerId'], defaultModel: string | null = null): ProviderProfile {
  return {
    id,
    providerId,
    name: id,
    baseUrl: 'https://example.test/v1',
    authType: 'bearer',
    defaultModel,
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
  };
}

function model(owner: ProviderProfile, modelId: string, access: ModelInfo['access'] = 'unknown'): ModelInfo {
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
    access,
    accessSource: 'test',
    accessNotes: null,
    available: true,
    lastCheckedAt: null,
    userClassification: null,
    metadata: {},
  };
}

function route(input: {
  profiles: ProviderProfile[];
  models: ModelInfo[];
  currentProfileId?: string;
  currentModelId?: string;
  excludeKeys?: string[];
  excludedProfileIds?: string[];
  allowPaid?: boolean;
}) {
  return buildRoutingOutcome({
    taskType: 'coding',
    profiles: input.profiles,
    models: input.models,
    limits: [],
    policy: { ...DEFAULT_SETTINGS.routing, allowPaid: input.allowPaid ?? false },
    currentProfileId: input.currentProfileId ?? null,
    currentModelId: input.currentModelId ?? null,
    excludeKeys: input.excludeKeys,
    excludedProfileIds: input.excludedProfileIds,
    requirements: { tools: true },
  });
}

describe('exact model across providers', () => {
  const nvidia = profile('oa-a', 'openai', 'X');
  const kilo = profile('or-a', 'openrouter', 'X');
  const other = model(nvidia, 'Y');

  it('tries the exact model on another provider before same-provider alternatives', () => {
    const outcome = route({
      profiles: [nvidia, kilo],
      models: [model(nvidia, 'X'), model(kilo, 'X'), other],
      currentProfileId: nvidia.id,
      currentModelId: 'X',
      excludeKeys: ['oa-a::X'],
    });
    expect(outcome.chain[0]!.model.modelId).toBe('X');
    expect(outcome.chain[0]!.profile.providerId).toBe('openrouter');
  });

  it('produces a synthetic candidate for a model id not discovered on that provider', () => {
    const outcome = route({
      profiles: [nvidia, kilo],
      models: [],
      currentModelId: 'deepseek-v4.1-flash',
    });
    expect(
      outcome.chain.some(
        (candidate) =>
          candidate.model.modelId === 'deepseek-v4.1-flash' &&
          candidate.model.metadata.synthetic === true,
      ),
    ).toBe(true);
  });

  it('does not resurrect excluded providers or paid models when allowPaid is false', () => {
    const paid = profile('paid-a', 'openai');
    const outcome = route({
      profiles: [nvidia, kilo, paid],
      models: [model(nvidia, 'X'), model(kilo, 'X'), model(paid, 'X', 'paid')],
      currentModelId: 'X',
      excludedProfileIds: [kilo.id],
      allowPaid: false,
    });
    expect(outcome.chain.every((candidate) => candidate.profile.id !== kilo.id)).toBe(true);
    expect(outcome.chain.every((candidate) => candidate.access !== 'paid')).toBe(true);
  });
});
