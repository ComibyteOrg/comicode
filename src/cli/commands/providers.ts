import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Command } from 'commander';
import type { AccessClassification, ProviderKind, ProviderProfile } from '../../core/types.js';
import { getCredentialStore } from '../../core/security/credentials.js';
import { registerSecret } from '../../core/security/redact.js';
import {
  credentialIdForProfile,
  exportProviders,
  importProviders,
  keysToSecret,
  parseKeyInput,
  refreshProfileModels,
  removeProfile,
  testProfileConnection,
} from '../../core/providers/service.js';
import {
  getProviderDefinition,
  PROVIDER_ORDER,
  PROVIDER_PRESETS,
  providerDisplayName,
} from '../../core/providers/definitions.js';
import {
  EndpointConfigSchema,
  endpointConfigForStorage,
  readEndpointConfig,
} from '../../core/providers/profile-config.js';
import { classifyThrown } from '../../core/providers/errors.js';
import { ACCESS_CLASSIFICATIONS } from '../../core/settings.js';
import { maskSecret } from '../../core/security/masking.js';
import {
  bold,
  danger,
  dim,
  formatDateTime,
  formatRelative,
  jsonOut,
  printKeyValue,
  printSection,
  printTable,
  success,
  truncate,
  warning,
} from '../output.js';
import { isInteractive, promptChoice, promptConfirm, promptSecret, promptText } from '../prompt.js';
import { profileLabel, resolveProfile, withStore } from '../shared.js';

interface EndpointFlags {
  provider?: string;
  preset?: string;
  name?: string;
  baseUrl?: string;
  apiKey?: string;
  apiKeyEnv?: string;
  defaultModel?: string;
  apiStyle?: string;
  authHeader?: string;
  authPrefix?: string;
  chatPath?: string;
  modelsPath?: string;
  maxTokensParam?: string;
  contextWindow?: string;
  extraHeader?: string[];
  access?: string;
  priority?: string;
  auth?: boolean;
  discovery?: boolean;
  streaming?: boolean;
  testChat?: boolean;
  enabled?: boolean;
  disabled?: boolean;
  test?: boolean;
  refresh?: boolean;
}

function parseProviderKind(value: string): ProviderKind {
  if ((PROVIDER_ORDER as string[]).includes(value)) return value as ProviderKind;
  throw new Error(
    `Unknown provider "${value}". Choose one of: ${PROVIDER_ORDER.join(', ')}. Use "custom" with --base-url for any OpenAI-compatible or Gemini-compatible platform.`,
  );
}

function parseAccess(value: string | undefined): AccessClassification | null {
  if (!value) return null;
  if (!(ACCESS_CLASSIFICATIONS as string[]).includes(value)) {
    throw new Error(
      `Unknown access classification "${value}". Choose one of: ${ACCESS_CLASSIFICATIONS.join(', ')}.`,
    );
  }
  return value as AccessClassification;
}

function parseExtraHeaders(values: string[] | undefined): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const raw of values ?? []) {
    const index = raw.indexOf(':');
    if (index <= 0) throw new Error(`Invalid header "${raw}". Use "Name: Value".`);
    const name = raw.slice(0, index).trim();
    const value = raw.slice(index + 1).trim();
    if (!/^[A-Za-z0-9-]+$/.test(name)) throw new Error(`Invalid header name "${name}".`);
    if (/authorization|api[-_]?key|cookie/i.test(name)) {
      throw new Error(
        `Header "${name}" is credential-like. Configure the API key separately so it is stored securely.`,
      );
    }
    headers[name] = value;
  }
  return headers;
}

function buildEndpointConfig(
  flags: EndpointFlags,
  existing?: ProviderProfile,
): Record<string, unknown> {
  const base = readEndpointConfig(existing ?? ({ config: {} } as ProviderProfile));
  const config: Record<string, unknown> = { ...base };
  if (flags.apiStyle) {
    if (flags.apiStyle !== 'openai-compatible' && flags.apiStyle !== 'gemini') {
      throw new Error('--api-style must be "openai-compatible" or "gemini".');
    }
    config.apiStyle = flags.apiStyle;
  }
  if (flags.auth === false) config.allowNoAuth = true;
  if (flags.auth === true) config.allowNoAuth = false;
  if (flags.authHeader) config.authHeader = flags.authHeader;
  if (flags.authPrefix !== undefined) config.authPrefix = flags.authPrefix;
  if (flags.chatPath) config.chatPath = flags.chatPath;
  if (flags.modelsPath) config.modelsPath = flags.modelsPath;
  if (flags.maxTokensParam) {
    if (flags.maxTokensParam !== 'max_tokens' && flags.maxTokensParam !== 'max_completion_tokens') {
      throw new Error('--max-tokens-param must be max_tokens or max_completion_tokens.');
    }
    config.maxTokensParam = flags.maxTokensParam;
  }
  if (flags.discovery === false) config.supportsModelDiscovery = false;
  if (flags.discovery === true) config.supportsModelDiscovery = true;
  if (flags.streaming === false) config.supportsStreaming = false;
  if (flags.streaming === true) config.supportsStreaming = true;
  if (flags.testChat) config.testWithChat = true;
  if (flags.contextWindow) {
    const value = Number(flags.contextWindow);
    if (!Number.isInteger(value) || value <= 0)
      throw new Error('--context-window must be a positive integer.');
    config.contextWindowOverride = value;
  }
  if (flags.priority) {
    const value = Number(flags.priority);
    if (!Number.isFinite(value)) throw new Error('--priority must be a number.');
    config.priority = value;
  }
  const extra = parseExtraHeaders(flags.extraHeader);
  if (Object.keys(extra).length) {
    config.extraHeaders = { ...(base.extraHeaders ?? {}), ...extra };
  }
  if (flags.preset) config.preset = flags.preset;
  return endpointConfigForStorage(config);
}

function validateBaseUrl(value: string): void {
  if (!value.trim()) throw new Error('A base URL is required.');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(
      `Invalid base URL "${value}". Include the scheme, for example https://api.example.com/v1`,
    );
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('The base URL must use http:// or https://.');
  }
}

function uniqueName(existing: ProviderProfile[], base: string, ignoreId?: string): string {
  const names = new Set(
    existing
      .filter((profile) => profile.id !== ignoreId)
      .map((profile) => profile.name.toLowerCase()),
  );
  if (!names.has(base.toLowerCase())) return base;
  for (let index = 2; index < 100; index += 1) {
    const candidate = `${base} ${index}`;
    if (!names.has(candidate.toLowerCase())) return candidate;
  }
  throw new Error('Could not generate a unique profile name.');
}

async function maybeStoreKey(
  profile: ProviderProfile,
  key: string | null,
  envName: string | null,
): Promise<'stored' | 'env' | 'none'> {
  if (envName) return 'env';
  if (!key) return 'none';
  const keys = parseKeyInput(key);
  if (keys.length === 0) return 'none';
  for (const entry of keys) registerSecret(entry);
  await getCredentialStore().setSecret(
    credentialIdForProfile(profile.id),
    keysToSecret(keys),
  );
  return 'stored';
}

function printProfileSummary(profile: ProviderProfile, keyState: 'stored' | 'env' | 'none'): void {
  const config = readEndpointConfig(profile);
  printKeyValue([
    ['Name', profile.name],
    ['Provider', providerDisplayName(profile.providerId)],
    ['Base URL', profile.baseUrl || dim('(none)')],
    ['API style', profile.providerId === 'gemini' ? 'gemini' : config.apiStyle],
    [
      'Auth',
      keyState === 'env'
        ? `environment (${profile.apiKeyEnv})`
        : keyState === 'stored'
          ? 'stored securely'
          : 'none',
    ],
    ['Default model', profile.defaultModel ?? dim('(none)')],
    ['Enabled', profile.enabled ? success('yes') : warning('no')],
    ['Access', profile.accessClassification],
    ['Discovery', config.supportsModelDiscovery ? 'enabled' : 'disabled'],
    ['Streaming', config.supportsStreaming ? 'enabled' : 'disabled'],
  ]);
}

async function interactiveProviderDraft(existing: ProviderProfile | null): Promise<{
  providerId: ProviderKind;
  name: string;
  baseUrl: string;
  defaultModel: string | null;
  access: AccessClassification;
  apiStyle?: string;
  noAuth: boolean;
  keyMode: 'secret' | 'env' | 'none';
  apiKeyEnv: string | null;
  key: string | null;
  discovery: boolean;
  streaming: boolean;
  preset: string | null;
  authHeader?: string;
  authPrefix?: string;
}> {
  let providerId = existing?.providerId ?? 'custom';
  let preset: string | null = existing ? readEndpointConfig(existing).preset : null;
  let baseUrl = existing?.baseUrl ?? '';
  let apiStyle: string | undefined = existing ? readEndpointConfig(existing).apiStyle : undefined;
  let authHeader: string | undefined;
  let authPrefix: string | undefined;
  let defaultModel = existing?.defaultModel ?? null;
  let discovery = existing ? readEndpointConfig(existing).supportsModelDiscovery : true;
  let streaming = existing ? readEndpointConfig(existing).supportsStreaming : true;

  if (!existing) {
    const mode = await promptChoice('How do you want to connect a provider?', [
      {
        value: 'builtin',
        label: 'Built-in provider',
        hint: 'Gemini, Groq, OpenRouter, OpenAI',
      },
      {
        value: 'preset',
        label: 'Custom platform preset',
        hint: 'DeepSeek, Mistral, xAI, Together, Ollama, Azure, ...',
      },
      {
        value: 'custom',
        label: 'Any other API',
        hint: 'OpenAI-compatible or Gemini-compatible with your base URL',
      },
    ]);
    if (mode === 'builtin') {
      providerId = await promptChoice<ProviderKind>(
        'Provider',
        PROVIDER_ORDER.filter((kind) => kind !== 'custom').map((kind) => ({
          value: kind,
          label: getProviderDefinition(kind).name,
          hint: getProviderDefinition(kind).defaultBaseUrl,
        })),
      );
    } else if (mode === 'preset') {
      const choice = await promptChoice(
        'Preset',
        PROVIDER_PRESETS.map((entry) => ({
          value: entry.id,
          label: entry.label,
          hint: entry.baseUrl,
        })),
      );
      const found = PROVIDER_PRESETS.find((entry) => entry.id === choice);
      if (found) {
        providerId = 'custom';
        preset = found.id;
        baseUrl = found.baseUrl;
        apiStyle = found.apiStyle;
        authHeader = found.authHeader;
        authPrefix = found.authPrefix;
        defaultModel = found.exampleModel;
      }
    } else {
      providerId = 'custom';
    }
  }

  const definition = getProviderDefinition(providerId);
  const name = await promptText('Profile name', {
    defaultValue:
      existing?.name ??
      (preset ? PROVIDER_PRESETS.find((p) => p.id === preset)?.label : definition.name),
    required: true,
  });
  baseUrl = await promptText('Base URL', {
    defaultValue: baseUrl || definition.defaultBaseUrl,
    required: true,
    validate: (value) => {
      try {
        validateBaseUrl(value);
        return null;
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    },
  });
  if (providerId === 'custom') {
    apiStyle = await promptChoice(
      'API protocol',
      [
        { value: 'openai-compatible', label: 'OpenAI-compatible', hint: '/chat/completions' },
        { value: 'gemini', label: 'Gemini-compatible', hint: '/models/{model}:generateContent' },
      ],
      { defaultIndex: apiStyle === 'gemini' ? 1 : 0 },
    );
    if (apiStyle === 'gemini') {
      authHeader = undefined;
      authPrefix = undefined;
    }
  }
  defaultModel =
    (await promptText('Default model (optional)', {
      defaultValue: defaultModel ?? '',
      allowEmpty: true,
    })) || null;
  const access = (await promptChoice<AccessClassification>(
    'How should ComiCode classify this profile for routing?',
    [
      { value: 'unknown', label: 'Unknown', hint: 'allowed, but not preferred' },
      { value: 'user-free', label: 'Free for me', hint: 'local server or free credits' },
      { value: 'user-paid', label: 'Paid for me', hint: 'blocked unless allowPaid is on' },
      { value: 'unavailable', label: 'Unavailable', hint: 'disable routing use' },
    ],
    { defaultIndex: 0 },
  )) as AccessClassification;

  let keyMode: 'secret' | 'env' | 'none' = 'secret';
  let apiKeyEnv: string | null = existing?.apiKeyEnv ?? null;
  if (providerId === 'custom') {
    if (definition.authType === 'api-key' && apiStyle === 'gemini') {
      keyMode = 'secret';
    } else {
      keyMode = await promptChoice<'secret' | 'env' | 'none'>('Authentication', [
        { value: 'secret', label: 'Store an API key securely', hint: 'OS credential store' },
        {
          value: 'env',
          label: 'Read an environment variable',
          hint: 'keeps the key out of the database',
        },
        { value: 'none', label: 'No authentication', hint: 'local servers only' },
      ]);
    }
    if (keyMode === 'env') {
      apiKeyEnv = await promptText('Environment variable name', {
        defaultValue: apiKeyEnv ?? '',
        required: true,
      });
    }
  } else if (apiStyle !== 'gemini') {
    keyMode = await promptChoice<'secret' | 'env'>('Authentication', [
      { value: 'secret', label: 'Store an API key securely' },
      { value: 'env', label: 'Read an environment variable' },
    ]);
    if (keyMode === 'env') {
      apiKeyEnv = await promptText('Environment variable name', {
        defaultValue: apiKeyEnv ?? '',
        required: true,
      });
    }
  }
  if (providerId !== 'custom' || definition.authType === 'api-key') {
    keyMode = 'secret';
  }

  const key =
    keyMode === 'secret'
      ? await promptSecret(
          existing
            ? 'New API key(s), comma-separated for multiple (blank keeps existing)'
            : 'API key(s), comma-separated for multiple (input is hidden)',
        ).catch(() => '')
      : null;

  discovery = await promptConfirm('Use the endpoint model list for discovery?', discovery);
  streaming = await promptConfirm('Stream responses when supported?', streaming);

  return {
    providerId,
    name,
    baseUrl,
    defaultModel,
    access,
    apiStyle,
    noAuth: keyMode === 'none',
    keyMode,
    apiKeyEnv: keyMode === 'env' ? apiKeyEnv : null,
    key: key && key.trim() ? key.trim() : null,
    discovery,
    streaming,
    preset,
    authHeader,
    authPrefix,
  };
}

async function addProvider(flags: EndpointFlags): Promise<void> {
  const providerId = flags.provider ? parseProviderKind(flags.provider) : null;
  const preset = flags.preset ? PROVIDER_PRESETS.find((entry) => entry.id === flags.preset) : null;
  if (flags.preset && !preset) {
    throw new Error(
      `Unknown preset "${flags.preset}". Available presets: ${PROVIDER_PRESETS.map((entry) => entry.id).join(', ')}.`,
    );
  }

  const interactive = isInteractive() && (!providerId || !flags.baseUrl || !flags.name);
  const draft = interactive ? await interactiveProviderDraft(null) : null;

  const resolvedProvider: ProviderKind =
    draft?.providerId ?? providerId ?? (preset ? 'custom' : 'custom');
  const definition = getProviderDefinition(resolvedProvider);
  const baseUrl = draft?.baseUrl ?? flags.baseUrl ?? preset?.baseUrl ?? definition.defaultBaseUrl;
  validateBaseUrl(baseUrl);

  const baseName = draft?.name ?? flags.name ?? preset?.label ?? definition.name;

  const existing = await withStore(({ store }) => store.listProfiles());
  const name = uniqueName(existing, baseName);

  const config = buildEndpointConfig(
    {
      ...flags,
      preset: draft?.preset ?? flags.preset,
      apiStyle: draft?.apiStyle ?? flags.apiStyle,
      authHeader: draft?.authHeader ?? flags.authHeader,
      authPrefix: draft?.authPrefix ?? flags.authPrefix,
      auth: draft?.noAuth ? false : flags.auth,
      discovery: draft ? draft.discovery : flags.discovery,
      streaming: draft ? draft.streaming : flags.streaming,
    },
    undefined,
  );
  if (preset?.apiStyle) config.apiStyle = preset.apiStyle;
  if (preset?.authHeader) config.authHeader = preset.authHeader;
  if (preset?.authPrefix !== undefined) config.authPrefix = preset.authPrefix;

  const keyMode =
    draft?.keyMode ??
    (flags.apiKeyEnv ? 'env' : flags.apiKey ? 'secret' : flags.auth === false ? 'none' : 'secret');
  if (keyMode === 'none') config.allowNoAuth = true;
  if (draft && !draft.noAuth) delete config.allowNoAuth;
  const access =
    draft?.access ?? parseAccess(flags.access) ?? (keyMode === 'none' ? 'user-free' : 'unknown');

  const result = await withStore(async ({ store }) => {
    const profile = store.createProfile({
      providerId: resolvedProvider,
      name,
      baseUrl,
      authType: preset?.authHeader === 'api-key' ? 'api-key' : definition.authType,
      defaultModel: draft?.defaultModel ?? flags.defaultModel ?? null,
      apiKeyEnv: draft?.apiKeyEnv ?? flags.apiKeyEnv ?? null,
      accessClassification: access,
      config,
      enabled: flags.enabled !== false && !flags.disabled,
    });
    let key = draft?.key ?? flags.apiKey ?? null;
    if (!key && keyMode === 'secret' && isInteractive() && !draft) {
      key = await promptSecret('API key(s), comma-separated for multiple (input is hidden)').catch(
        () => '',
      );
    }
    const keyState = await maybeStoreKey(
      profile,
      key && key.trim() ? key.trim() : null,
      profile.apiKeyEnv,
    );
    if (keyState === 'none' && resolvedProvider !== 'custom' && definition.authType === 'bearer') {
      console.log(
        warning(
          `No API key is configured. Set one with "comicode auth set ${profile.name}" or an environment variable before using this profile.`,
        ),
      );
    }
    if (
      keyState === 'none' &&
      resolvedProvider === 'custom' &&
      !readEndpointConfig(profile).allowNoAuth
    ) {
      console.log(
        warning(
          `No API key is configured. If this endpoint is local, edit the profile with --no-auth.`,
        ),
      );
    }
    return { profile, keyState };
  });

  console.log('');
  console.log(`${success('✔')} Profile "${result.profile.name}" created.`);
  printProfileSummary(result.profile, result.keyState);

  if (flags.test || flags.refresh) {
    await withStore(async ({ store }) => {
      const fresh = store.getProfile(result.profile.id);
      if (!fresh) return;
      const test = await testProfileConnection(store, fresh);
      console.log('');
      console.log(
        test.ok
          ? `${success('✔')} ${test.message} ${dim(`(${test.latencyMs}ms)`)}`
          : `${danger('✖')} ${test.message}`,
      );
      if (test.ok && readEndpointConfig(fresh).supportsModelDiscovery) {
        try {
          const refreshed = await refreshProfileModels(store, fresh);
          console.log(
            `${success('✔')} Discovered ${refreshed.discovered} model${refreshed.discovered === 1 ? '' : 's'}.`,
          );
          if (!fresh.defaultModel) {
            const models = store
              .listModels(fresh.providerId, fresh.providerId === 'custom' ? fresh.id : undefined)
              .filter((model) => model.profileId === null || model.profileId === fresh.id)
              .sort((a, b) => b.codingSuitability - a.codingSuitability);
            const best = models[0];
            if (best) {
              store.updateProfile(fresh.id, { defaultModel: best.modelId });
              console.log(dim(`Default model set to ${best.modelId}.`));
            }
          }
        } catch (error) {
          const classified = classifyThrown(error, fresh.providerId);
          console.log(
            `${danger('✖')} Model refresh failed (${classified.category}): ${classified.message}`,
          );
        }
      }
    });
  }

  const profiles = await withStore(({ store }) => store.listProfiles());
  if (profiles.length === 1) {
    await withStore(({ store }) => store.setSelectedProfileId(result.profile.id));
  }
}

function applyFlagPatch(flags: EndpointFlags, existing: ProviderProfile): Partial<ProviderProfile> {
  const patch: Partial<ProviderProfile> = {};
  if (flags.name) patch.name = flags.name;
  if (flags.baseUrl) {
    validateBaseUrl(flags.baseUrl);
    patch.baseUrl = flags.baseUrl;
  }
  if (flags.defaultModel !== undefined) patch.defaultModel = flags.defaultModel || null;
  if (flags.apiKeyEnv !== undefined) patch.apiKeyEnv = flags.apiKeyEnv || null;
  if (flags.enabled !== undefined) patch.enabled = flags.enabled;
  const access = parseAccess(flags.access);
  if (access) patch.accessClassification = access;
  const config = buildEndpointConfig(flags, existing);
  if (Object.keys(config).length) patch.config = config;
  return patch;
}

async function editProvider(reference: string | undefined, flags: EndpointFlags): Promise<void> {
  await withStore(async ({ store }) => {
    const profile = resolveProfile(store, reference);
    const hasFlags = Object.keys(flags).some((key) => {
      const value = (flags as Record<string, unknown>)[key];
      return value !== undefined && value !== false;
    });
    if (!hasFlags && isInteractive()) {
      const draft = await interactiveProviderDraft(profile);
      const update: Partial<ProviderProfile> = {
        name: uniqueName(store.listProfiles(), draft.name, profile.id),
        baseUrl: draft.baseUrl,
        defaultModel: draft.defaultModel,
        apiKeyEnv: draft.apiKeyEnv,
        accessClassification: draft.access,
        config: buildEndpointConfig(
          {
            apiStyle: draft.apiStyle,
            authHeader: draft.authHeader,
            authPrefix: draft.authPrefix,
            preset: draft.preset ?? undefined,
            auth: draft.noAuth ? false : undefined,
            discovery: draft.discovery,
            streaming: draft.streaming,
          },
          profile,
        ),
      };
      const updated = store.updateProfile(profile.id, update);
      const keyState = await maybeStoreKey(updated, draft.key, updated.apiKeyEnv);
      console.log(`${success('✔')} Updated ${updated.name}.`);
      printProfileSummary(updated, keyState);
      return;
    }
    const patch = applyFlagPatch(flags, profile);
    if (Object.keys(patch).length === 0) {
      console.log(
        dim(
          'No changes requested. Use flags such as --name, --base-url, --default-model, --api-key-env, --access, --no-auth.',
        ),
      );
      return;
    }
    if (patch.name) patch.name = uniqueName(store.listProfiles(), patch.name, profile.id);
    const updated = store.updateProfile(profile.id, patch);
    let key = flags.apiKey ?? null;
    if (
      !key &&
      isInteractive() &&
      flags.apiKeyEnv === undefined &&
      Object.keys(flags).length === 0
    ) {
      key = await promptSecret('New API key (leave blank to keep existing)').catch(() => '');
    }
    const keyState = await maybeStoreKey(updated, key, updated.apiKeyEnv);
    console.log(`${success('✔')} Updated ${updated.name}.`);
    printProfileSummary(updated, keyState);
  });
}

function listProviders(options: { json?: boolean }): Promise<void> {
  return withStore(({ store }) => {
    const profiles = store.listProfiles();
    const storedIds = new Set(getCredentialStore().listSecretIds());
    const authLabel = (profile: ProviderProfile): string => {
      if (profile.apiKeyEnv) return `env:${profile.apiKeyEnv}`;
      if (readEndpointConfig(profile).allowNoAuth) return 'none';
      return storedIds.has(credentialIdForProfile(profile.id)) ? 'stored' : 'missing';
    };
    if (options.json) {
      jsonOut(
        profiles.map((profile) => ({
          ...profile,
          models: store
            .listModels(
              profile.providerId,
              profile.providerId === 'custom' ? profile.id : undefined,
            )
            .filter((model) => model.profileId === null || model.profileId === profile.id).length,
          activeLimits: store.listLimits(true).filter((limit) => limit.profileId === profile.id),
        })),
      );
      return;
    }
    printTitleSafe('Provider profiles', `${profiles.length} connected`);
    printTable(
      ['NAME', 'PROVIDER', 'DEFAULT MODEL', 'AUTH', 'ACCESS', 'STATUS', 'LAST OK'],
      profiles.map((profile) => [
        profile.name,
        providerDisplayName(profile.providerId),
        profile.defaultModel ?? '—',
        authLabel(profile),
        profile.accessClassification,
        profile.enabled ? success('enabled') : warning('disabled'),
        formatRelative(profile.lastSuccessAt),
      ]),
    );
    if (profiles.length === 0) {
      console.log('');
      console.log(`Add one with ${bold('comicode providers add')} or any custom platform with`);
      console.log(
        dim(
          '  comicode providers add --provider custom --base-url https://api.example.com/v1 --name "My platform" --api-key ...',
        ),
      );
    }
  });
}

function printTitleSafe(title: string, subtitle?: string): void {
  console.log('');
  console.log(`${bold('COMICODE')}  ${dim(subtitle ?? '')}`);
  console.log(bold(title));
}

async function showProvider(reference: string): Promise<void> {
  await withStore(({ store }) => {
    const profile = resolveProfile(store, reference);
    const config = readEndpointConfig(profile);
    printSection(profile.name);
    printKeyValue([
      ['ID', profile.id],
      ['Provider', providerDisplayName(profile.providerId)],
      ['Base URL', profile.baseUrl],
      ['API style', profile.providerId === 'gemini' ? 'gemini' : config.apiStyle],
      ['API key env', profile.apiKeyEnv ?? dim('(none)')],
      ['Default model', profile.defaultModel ?? dim('(none)')],
      ['Enabled', profile.enabled ? success('yes') : warning('no')],
      ['Access classification', profile.accessClassification],
      ['Last success', formatDateTime(profile.lastSuccessAt)],
      ['Last check', formatDateTime(profile.lastCheckedAt)],
      ['Last error', profile.lastError ? danger(profile.lastError) : dim('(none)')],
      ['Models discovered at', formatDateTime(profile.modelsRefreshedAt)],
      ['Chat path', config.chatPath],
      ['Models path', config.modelsPath],
      ['Auth header', config.authHeader],
      ['No auth', config.allowNoAuth ? 'yes' : 'no'],
      ['Discovery', config.supportsModelDiscovery ? 'yes' : 'no'],
      ['Streaming', config.supportsStreaming ? 'yes' : 'no'],
      ['Priority', String(config.priority ?? 100)],
    ]);
    const limits = store.listLimits(true).filter((limit) => limit.profileId === profile.id);
    if (limits.length) {
      printSection('Active limits');
      printTable(
        ['MODEL', 'CATEGORY', 'RESET', 'MESSAGE'],
        limits.map((limit) => [
          limit.modelId,
          limit.category,
          formatDateTime(limit.resetAt ?? limit.retryAfterAt),
          truncate(limit.message ?? '—', 60),
        ]),
      );
    }
    const health = store.listHealth(profile.id, 5);
    if (health.length) {
      printSection('Recent health');
      printTable(
        ['WHEN', 'OK', 'LATENCY', 'CATEGORY', 'MESSAGE'],
        health.map((entry) => [
          formatRelative(entry.createdAt),
          entry.ok ? success('yes') : danger('no'),
          entry.latencyMs === null ? '—' : `${entry.latencyMs}ms`,
          entry.category ?? '—',
          truncate(entry.message ?? '—', 50),
        ]),
      );
    }
    const models = store
      .listModels(profile.providerId, profile.providerId === 'custom' ? profile.id : undefined)
      .filter((model) => model.profileId === null || model.profileId === profile.id);
    printSection(`Models (${models.length})`);
    for (const model of models.slice(0, 25)) {
      console.log(
        `  ${model.modelId}${model.available ? '' : dim(' (stale)')} ${dim(`[${model.access}]`)}`,
      );
    }
    if (models.length > 25) console.log(dim(`  … ${models.length - 25} more`));
  });
}

async function removeProvider(reference: string, options: { yes?: boolean }): Promise<void> {
  await withStore(async ({ store }) => {
    const profile = resolveProfile(store, reference);
    if (!options.yes && isInteractive()) {
      const confirmed = await promptConfirm(
        `Delete profile "${profile.name}" and its stored credential? This cannot be undone.`,
        false,
      );
      if (!confirmed) {
        console.log(dim('Cancelled.'));
        return;
      }
    } else if (!options.yes) {
      throw new Error('Deleting a profile requires --yes in non-interactive mode.');
    }
    await removeProfile(store, profile.id);
    console.log(`${success('✔')} Deleted ${profile.name}.`);
  });
}

function presets(options: { json?: boolean }): void {
  if (options.json) {
    jsonOut(PROVIDER_PRESETS);
    return;
  }
  printSection('Custom platform presets');
  printTable(
    ['PRESET', 'BASE URL', 'PROTOCOL', 'KEY', 'EXAMPLE MODEL'],
    PROVIDER_PRESETS.map((preset) => [
      preset.id,
      preset.baseUrl,
      preset.apiStyle,
      preset.requiresKey ? 'required' : 'optional',
      preset.exampleModel,
    ]),
  );
  console.log('');
  console.log(
    dim(
      'Presets are shortcuts, not restrictions. Any OpenAI-compatible or Gemini-compatible endpoint works:',
    ),
  );
  console.log(
    dim(
      '  comicode providers add --provider custom --name "My API" --base-url https://host/v1 --api-key ...',
    ),
  );
}

async function testProvider(
  reference: string | undefined,
  options: { json?: boolean },
): Promise<number> {
  return withStore(async ({ store }) => {
    const profile = resolveProfile(store, reference);
    console.log(dim(`Testing ${profileLabel(profile)} …`));
    const result = await testProfileConnection(store, profile);
    if (options.json) {
      jsonOut({ profile: profile.id, ...result });
    } else if (result.ok) {
      console.log(
        `${success('✔')} ${result.message} ${dim(`(${result.latencyMs}ms${result.modelCount !== null ? `, ${result.modelCount} models` : ''})`)}`,
      );
    } else {
      console.log(`${danger('✖')} ${result.message}`);
      console.log(dim(`Category: ${result.category ?? 'unknown'}`));
    }
    return result.ok ? 0 : 1;
  });
}

async function refreshModels(
  reference: string | undefined,
  options: { json?: boolean },
): Promise<number> {
  return withStore(async ({ store }) => {
    const profile = resolveProfile(store, reference);
    console.log(dim(`Refreshing models for ${profileLabel(profile)} …`));
    try {
      const result = await refreshProfileModels(store, profile);
      const models = store
        .listModels(profile.providerId, profile.providerId === 'custom' ? profile.id : undefined)
        .filter((model) => model.profileId === null || model.profileId === profile.id);
      if (options.json) {
        jsonOut({ profile: profile.id, ...result, models });
      } else {
        console.log(
          `${success('✔')} Discovered ${result.discovered} model${result.discovered === 1 ? '' : 's'} in ${result.latencyMs}ms.`,
        );
        if (!profile.defaultModel) {
          const best = models
            .filter((model) => model.available)
            .sort((a, b) => b.codingSuitability - a.codingSuitability)[0];
          if (best) {
            store.updateProfile(profile.id, { defaultModel: best.modelId });
            console.log(dim(`Default model set to ${best.modelId}.`));
          }
        }
      }
      return 0;
    } catch (error) {
      const classified = classifyThrown(error, profile.providerId);
      if (options.json) jsonOut({ profile: profile.id, ok: false, ...classified.toJSON() });
      else console.log(`${danger('✖')} ${classified.message} (${classified.category})`);
      return 1;
    }
  });
}

async function exportProfiles(file: string | undefined): Promise<void> {
  await withStore(({ store }) => {
    const payload = exportProviders(store);
    const text = `${JSON.stringify(payload, null, 2)}\n`;
    if (file) {
      const path = resolve(process.cwd(), file);
      writeFileSync(path, text, 'utf8');
      console.log(`${success('✔')} Exported ${payload.profiles.length} profiles to ${path}.`);
      console.log(dim('Credentials are never included. Re-add API keys after importing.'));
    } else {
      process.stdout.write(text);
    }
  });
}

async function importProfiles(file: string): Promise<void> {
  const path = resolve(process.cwd(), file);
  if (!existsSync(path)) throw new Error(`File not found: ${path}`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch (error) {
    throw new Error(
      `Invalid JSON in ${file}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  await withStore(({ store }) => {
    const summary = importProviders(store, parsed);
    console.log(
      `${success('✔')} Imported profiles: ${summary.created} created, ${summary.updated} updated, ${summary.skipped} skipped.`,
    );
    for (const item of summary.warnings) console.log(`${warning('!')} ${item}`);
    if (summary.created + summary.updated > 0) {
      console.log(dim('Set API keys with "comicode auth set <profile>".'));
    }
  });
}

export function registerProviderCommands(program: Command): void {
  const providers = program
    .command('providers')
    .alias('provider')
    .description('Manage provider profiles, including custom base URLs')
    .option('--json', 'machine-readable output')
    .action(async (options) => {
      await listProviders(options);
    });

  providers
    .command('list')
    .alias('ls')
    .description('List connected provider profiles')
    .option('--json', 'machine-readable output')
    .action(async (options) => {
      await listProviders(options);
    });

  providers
    .command('add')
    .description('Add a provider profile (interactive by default)')
    .option('--provider <kind>', 'gemini, groq, openrouter, openai, or custom')
    .option('--preset <id>', 'custom platform preset (see "providers presets")')
    .option('--name <name>', 'profile name')
    .option('--base-url <url>', 'API base URL (any compatible platform)')
    .option(
      '--api-key <key>',
      'API key (prefer interactive input or --api-key-env to avoid shell history)',
    )
    .option('--api-key-env <name>', 'read the API key from this environment variable')
    .option('--default-model <model>', 'default model id')
    .option('--api-style <style>', 'openai-compatible or gemini (custom endpoints)')
    .option('--auth-header <header>', 'credential header name (default Authorization)')
    .option('--auth-prefix <prefix>', 'credential header prefix (default "Bearer ")')
    .option('--chat-path <path>', 'chat completions path')
    .option('--models-path <path>', 'model list path')
    .option('--max-tokens-param <name>', 'max_tokens or max_completion_tokens')
    .option('--context-window <tokens>', 'context window override')
    .option(
      '--extra-header <header>',
      'additional header "Name: Value" (repeatable)',
      (value, previous: string[] = []) => [...previous, value],
    )
    .option('--access <classification>', ACCESS_CLASSIFICATIONS.join('|'))
    .option('--priority <number>', 'routing priority, lower is preferred')
    .option('--no-auth', 'endpoint does not require an API key (local servers)')
    .option('--no-discovery', 'disable the model list endpoint')
    .option('--no-streaming', 'disable streaming')
    .option('--test-chat', 'allow a tiny live chat request when discovery is disabled')
    .option('--disabled', 'create the profile disabled')
    .option('--test', 'test the connection after adding')
    .option('--refresh', 'refresh models after adding')
    .action(async (options: EndpointFlags) => {
      await addProvider(options);
    });

  providers
    .command('edit [profile]')
    .description('Edit a provider profile')
    .option('--name <name>')
    .option('--base-url <url>')
    .option('--api-key <key>')
    .option('--api-key-env <name>')
    .option('--default-model <model>')
    .option('--api-style <style>')
    .option('--auth-header <header>')
    .option('--auth-prefix <prefix>')
    .option('--chat-path <path>')
    .option('--models-path <path>')
    .option('--max-tokens-param <name>')
    .option('--context-window <tokens>')
    .option(
      '--extra-header <header>',
      'additional header "Name: Value" (repeatable)',
      (value, previous: string[] = []) => [...previous, value],
    )
    .option('--access <classification>')
    .option('--priority <number>')
    .option('--no-auth')
    .option('--no-discovery')
    .option('--no-streaming')
    .option('--test-chat')
    .option('--enable', 'enable the profile')
    .option('--disable', 'disable the profile')
    .action(
      async (
        reference: string | undefined,
        options: EndpointFlags & { enable?: boolean; disable?: boolean },
      ) => {
        if (options.enable) options.enabled = true;
        if (options.disable) options.enabled = false;
        await editProvider(reference, options);
      },
    );

  providers
    .command('show [profile]')
    .description('Show profile details, health, limits, and models')
    .action(async (reference: string | undefined) => {
      await showProvider(reference ?? '');
    });

  providers
    .command('remove [profile]')
    .alias('delete')
    .description('Remove a provider profile and its stored credential')
    .option('--yes', 'do not prompt for confirmation')
    .action(async (reference: string | undefined, options: { yes?: boolean }) => {
      await removeProvider(reference ?? '', options);
    });

  providers
    .command('enable [profile]')
    .description('Enable a provider profile')
    .action(async (reference: string | undefined) => {
      await withStore(({ store }) => {
        const profile = resolveProfile(store, reference);
        store.updateProfile(profile.id, { enabled: true });
        console.log(`${success('✔')} Enabled ${profile.name}.`);
      });
    });

  providers
    .command('disable [profile]')
    .description('Disable a provider profile')
    .action(async (reference: string | undefined) => {
      await withStore(({ store }) => {
        const profile = resolveProfile(store, reference);
        store.updateProfile(profile.id, { enabled: false });
        console.log(`${success('✔')} Disabled ${profile.name}.`);
      });
    });

  providers
    .command('test [profile]')
    .description('Test a provider connection')
    .option('--json', 'machine-readable output')
    .action(async (reference: string | undefined, options: { json?: boolean }) => {
      const code = await testProvider(reference, options);
      if (code !== 0) process.exitCode = code;
    });

  providers
    .command('refresh [profile]')
    .alias('models')
    .description('Refresh models from a provider')
    .option('--json', 'machine-readable output')
    .action(async (reference: string | undefined, options: { json?: boolean }) => {
      const code = await refreshModels(reference, options);
      if (code !== 0) process.exitCode = code;
    });

  providers
    .command('presets')
    .description('List custom platform presets')
    .option('--json', 'machine-readable output')
    .action((options) => presets(options));

  providers
    .command('export [file]')
    .description('Export non-secret profile configuration (never credentials)')
    .action(async (file: string | undefined) => {
      await exportProfiles(file);
    });

  providers
    .command('import <file>')
    .description('Import non-secret profile configuration')
    .action(async (file: string) => {
      await importProfiles(file);
    });
}

// Kept for code paths that need the masked idea of a key without exposing it.
export function describeKey(key: string): string {
  return maskSecret(key);
}

export { EndpointConfigSchema, addProvider };
