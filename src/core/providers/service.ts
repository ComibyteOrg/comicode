import type { DiscoveredModel, ProviderKind, ProviderProfile } from '../types.js';
import type { TestConnectionResult } from './adapter.js';
import type { Store } from '../db/store.js';
import { getCredentialStore } from '../security/credentials.js';
import { registerSecret, redactSecrets } from '../security/redact.js';
import { logger } from '../logger.js';
import { createAdapter } from './registry.js';
import { enrichDiscoveredModel, knownModelsForProvider } from './catalog.js';
import { ProviderError, classifyThrown } from './errors.js';
import { readEndpointConfig } from './profile-config.js';
import { getProviderDefinition } from './definitions.js';
import type { AdapterContext } from './adapter.js';

export function credentialIdForProfile(profileId: string): string {
  return `provider:${profileId}`;
}

export interface ResolvedCredential {
  apiKey: string;
  source: 'environment' | 'credential-store' | 'none';
  keyIndex: number;
  keyCount: number;
}

/**
 * A profile credential may hold a pool of API keys so the agent can rotate
 * to the next key when one hits a quota or auth limit. Stored value is either
 * a plain key (legacy/single) or a JSON array of keys.
 */
export function parseKeyPool(stored: string | null): string[] {
  if (!stored) return [];
  const trimmed = stored.trim();
  if (trimmed.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed
          .filter((entry): entry is string => typeof entry === 'string')
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0);
      }
    } catch {
      // fall through to single-key treatment
    }
  }
  return trimmed ? [stored] : [];
}

/** Serialize keys for storage: plain string for one key, JSON array for many. */
export function keysToSecret(keys: string[]): string {
  const clean = keys.map((key) => key.trim()).filter((key) => key.length > 0);
  return clean.length > 1 ? JSON.stringify(clean) : (clean[0] ?? '');
}

/** Parse user input that may contain several keys separated by commas/space. */
export function parseKeyInput(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export async function resolveProfileCredential(
  profile: ProviderProfile,
  keyIndex = 0,
): Promise<ResolvedCredential> {
  const config = readEndpointConfig(profile);
  const envName = profile.apiKeyEnv?.trim();
  if (envName) {
    const value = process.env[envName]?.trim() ?? '';
    if (value) {
      registerSecret(value);
      return { apiKey: value, source: 'environment', keyIndex: 0, keyCount: 1 };
    }
    if (config.allowNoAuth)
      return { apiKey: '', source: 'none', keyIndex: 0, keyCount: 1 };
    throw new ProviderError({
      providerId: profile.providerId,
      category: 'invalid_api_key',
      retryable: false,
      message: `Environment variable ${envName} is not set for profile "${profile.name}".`,
    });
  }

  const stored = await getCredentialStore().getSecret(credentialIdForProfile(profile.id));
  const pool = parseKeyPool(stored);
  if (pool.length > 0) {
    const index = Math.min(Math.max(0, keyIndex), pool.length - 1);
    const apiKey = pool[index]!;
    registerSecret(apiKey);
    return { apiKey, source: 'credential-store', keyIndex: index, keyCount: pool.length };
  }
  if (config.allowNoAuth)
    return { apiKey: '', source: 'none', keyIndex: 0, keyCount: 1 };
  throw new ProviderError({
    providerId: profile.providerId,
    category: 'invalid_api_key',
    retryable: false,
    message: `No API key is configured for profile "${profile.name}". Connect it with "comicode auth set".`,
  });
}

export async function createProfileContext(
  profile: ProviderProfile,
  keyIndex = 0,
): Promise<AdapterContext> {
  const credential = await resolveProfileCredential(profile, keyIndex);
  return {
    profile,
    apiKey: credential.apiKey,
    baseUrl: profile.baseUrl || getProviderDefinition(profile.providerId).defaultBaseUrl,
    keyIndex: credential.keyIndex,
    keyCount: credential.keyCount,
  };
}

export interface RefreshResult {
  models: DiscoveredModel[];
  discovered: number;
  latencyMs: number;
}

/**
 * Refresh a profile's model list. Custom endpoint models are scoped to the
 * profile so several custom platforms can coexist without catalog collisions.
 */
export async function refreshProfileModels(
  store: Store,
  profile: ProviderProfile,
  options: { signal?: AbortSignal } = {},
): Promise<RefreshResult> {
  const started = Date.now();
  const context = await createProfileContext(profile);
  context.signal = options.signal;
  const adapter = createAdapter(profile);
  try {
    const discovered = await adapter.listModels(context);
    const enriched = discovered.map((model) => enrichDiscoveredModel(profile.providerId, model));
    const scopedProfileId = profile.providerId === 'custom' ? profile.id : null;
    store.upsertModels(profile.providerId, enriched, scopedProfileId);
    const latencyMs = Date.now() - started;
    store.updateProfile(profile.id, {
      modelsRefreshedAt: new Date().toISOString(),
      lastCheckedAt: new Date().toISOString(),
      lastSuccessAt: new Date().toISOString(),
      lastError: null,
    });
    store.recordHealth({ profileId: profile.id, ok: true, latencyMs });
    store.clearLimit(profile.id, '*');
    return { models: enriched, discovered: enriched.length, latencyMs };
  } catch (error) {
    const classified = classifyThrown(error, profile.providerId);
    store.updateProfile(profile.id, {
      lastCheckedAt: new Date().toISOString(),
      lastError: classified.message,
      lastErrorAt: new Date().toISOString(),
    });
    store.recordHealth({
      profileId: profile.id,
      ok: false,
      latencyMs: Date.now() - started,
      category: classified.category,
      message: classified.message,
    });
    throw classified;
  }
}

export async function testProfileConnection(
  store: Store,
  profile: ProviderProfile,
  options: { persistStatus?: boolean } = {},
): Promise<TestConnectionResult> {
  const started = Date.now();
  try {
    const context = await createProfileContext(profile);
    const adapter = createAdapter(profile);
    const result = await adapter.testConnection(context);
    const latency = result.latencyMs || Date.now() - started;
    if (options.persistStatus !== false) {
      store.recordHealth({
        profileId: profile.id,
        ok: result.ok,
        latencyMs: latency,
        category: result.category ?? null,
        message: result.message,
      });
      if (result.ok) {
        store.recordProfileSuccess(profile.id);
        store.updateProfile(profile.id, { lastError: null, lastErrorAt: null });
      } else {
        const safe = redactSecrets(result.message);
        store.recordProfileError(profile.id, safe);
      }
    }
    return { ...result, message: redactSecrets(result.message) };
  } catch (error) {
    const classified = classifyThrown(error, profile.providerId);
    if (options.persistStatus !== false) {
      store.recordHealth({
        profileId: profile.id,
        ok: false,
        latencyMs: Date.now() - started,
        category: classified.category,
        message: classified.message,
      });
      store.recordProfileError(profile.id, classified.message);
    }
    return {
      ok: false,
      latencyMs: Date.now() - started,
      modelCount: null,
      message: classified.message,
      category: classified.category,
    };
  }
}

/** Seed curated metadata for providers that have at least one profile. */
export function seedKnownCatalog(store: Store): void {
  const providerIds = new Set<ProviderKind>(
    store.listProfiles().map((profile) => profile.providerId),
  );
  for (const providerId of providerIds) {
    for (const model of knownModelsForProvider(providerId)) {
      store.seedModel(providerId, model);
    }
  }
}

export async function addManualModel(
  store: Store,
  profile: ProviderProfile,
  modelId: string,
): Promise<void> {
  const trimmed = modelId.trim();
  if (!trimmed) throw new Error('Model ID is required.');
  const discovered: DiscoveredModel = {
    modelId: trimmed,
    displayName: trimmed,
    supportsTools: true,
    supportsStreaming: true,
    metadata: { manual: true },
  };
  const enriched = enrichDiscoveredModel(profile.providerId, discovered);
  const scopedProfileId = profile.providerId === 'custom' ? profile.id : null;
  store.upsertModels(profile.providerId, [enriched], scopedProfileId);
  store.updateProfile(profile.id, { lastCheckedAt: new Date().toISOString() });
  logger.info(`Added manual model ${trimmed} for profile ${profile.name}.`);
}

export async function removeProfile(store: Store, profileId: string): Promise<void> {
  const profile = store.getProfile(profileId);
  if (!profile) return;
  if (profile.providerId === 'custom') {
    for (const model of store.listModels(profile.providerId, profile.id)) {
      if (model.profileId === profile.id) store.deleteModel(model.id);
    }
  }
  await getCredentialStore().deleteSecret(credentialIdForProfile(profileId));
  store.deleteProfile(profileId);
}

export interface ExportProfile {
  providerId: ProviderKind;
  name: string;
  baseUrl: string;
  authType: 'api-key' | 'bearer';
  defaultModel: string | null;
  apiKeyEnv: string | null;
  enabled: boolean;
  accessClassification: ProviderProfile['accessClassification'];
  config: Record<string, unknown>;
}

export interface ProviderExport {
  version: 1;
  exportedAt: string;
  generator: string;
  profiles: ExportProfile[];
}

export function exportProviders(store: Store): ProviderExport {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    generator: 'comicode',
    profiles: store.listProfiles().map((profile) => ({
      providerId: profile.providerId,
      name: profile.name,
      baseUrl: profile.baseUrl,
      authType: profile.authType,
      defaultModel: profile.defaultModel,
      apiKeyEnv: profile.apiKeyEnv,
      enabled: profile.enabled,
      accessClassification: profile.accessClassification,
      config: profile.config,
    })),
  };
}

export interface ImportSummary {
  created: number;
  updated: number;
  skipped: number;
  warnings: string[];
}

/** Import non-secret profile configuration. Credentials must be added separately. */
export function importProviders(store: Store, raw: unknown): ImportSummary {
  const summary: ImportSummary = { created: 0, updated: 0, skipped: 0, warnings: [] };
  const record =
    raw && typeof raw === 'object'
      ? (raw as Record<string, unknown>)
      : ({} as Record<string, unknown>);
  if (record.version !== 1)
    summary.warnings.push('Unknown export version; attempting best-effort import.');
  const profiles = Array.isArray(record.profiles) ? record.profiles : [];
  for (const entry of profiles) {
    if (!entry || typeof entry !== 'object') {
      summary.skipped += 1;
      continue;
    }
    const item = entry as Record<string, unknown>;
    const providerId = String(item.providerId ?? 'custom') as ProviderKind;
    const name = String(item.name ?? '').trim();
    if (!name) {
      summary.skipped += 1;
      summary.warnings.push('Skipped a profile without a name.');
      continue;
    }
    if ('apiKey' in item || 'api_key' in item) {
      summary.warnings.push(`Ignored embedded API key for profile "${name}".`);
    }
    const config =
      item.config && typeof item.config === 'object'
        ? (item.config as Record<string, unknown>)
        : {};
    const existing = store.findProfile(providerId, name);
    const baseUrl = String(item.baseUrl ?? getProviderDefinition(providerId).defaultBaseUrl);
    const authType = item.authType === 'api-key' ? 'api-key' : 'bearer';
    if (existing) {
      store.updateProfile(existing.id, {
        baseUrl,
        authType,
        defaultModel: item.defaultModel ? String(item.defaultModel) : existing.defaultModel,
        apiKeyEnv: item.apiKeyEnv ? String(item.apiKeyEnv) : existing.apiKeyEnv,
        enabled: item.enabled === false ? false : existing.enabled,
        accessClassification:
          typeof item.accessClassification === 'string'
            ? (item.accessClassification as ProviderProfile['accessClassification'])
            : existing.accessClassification,
        config,
      });
      summary.updated += 1;
    } else {
      store.createProfile({
        providerId,
        name,
        baseUrl,
        authType,
        defaultModel: item.defaultModel ? String(item.defaultModel) : null,
        apiKeyEnv: item.apiKeyEnv ? String(item.apiKeyEnv) : null,
        enabled: item.enabled !== false,
        accessClassification:
          typeof item.accessClassification === 'string'
            ? (item.accessClassification as ProviderProfile['accessClassification'])
            : 'unknown',
        config,
      });
      summary.created += 1;
    }
  }
  seedKnownCatalog(store);
  return summary;
}
