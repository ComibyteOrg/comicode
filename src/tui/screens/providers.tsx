import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { AppContext } from '../../core/app.js';
import type { AccessClassification, ProviderKind, ProviderProfile } from '../../core/types.js';
import {
  getProviderDefinition,
  PROVIDER_ORDER,
  PROVIDER_PRESETS,
  providerDisplayName,
} from '../../core/providers/definitions.js';
import {
  credentialIdForProfile,
  keysToSecret,
  parseKeyInput,
  refreshProfileModels,
  removeProfile,
  testProfileConnection,
} from '../../core/providers/service.js';
import {
  endpointConfigForStorage,
  readEndpointConfig,
} from '../../core/providers/profile-config.js';
import { getCredentialStore } from '../../core/security/credentials.js';
import { registerSecret } from '../../core/security/redact.js';
import { maskSecret } from '../../core/security/masking.js';
import { formatRelative } from '../../cli/output.js';
import {
  Empty,
  Hint,
  KeyValue,
  PanelScreen,
  PromptInput,
  Spinner,
  clip,
  isEnter,
  useLayout,
  type AgentStatus,
} from '../components.js';
import { ModalWindow } from '../dialogs/modal.js';
import { glyph, theme } from '../theme.js';

type WizardStep =
  | 'kind'
  | 'name'
  | 'baseUrl'
  | 'defaultModel'
  | 'apiKey'
  | 'apiKeyEnv'
  | 'access'
  | 'effort'
  | 'confirm';

interface Draft {
  providerId: ProviderKind;
  preset: string | null;
  apiStyle: 'openai-compatible' | 'gemini';
  name: string;
  baseUrl: string;
  defaultModel: string;
  apiKey: string;
  apiKeyEnv: string;
  access: AccessClassification;
  effort: string;
  requiresKey: boolean;
  config: Record<string, unknown>;
  editingId: string | null;
}

type Mode =
  | { kind: 'list' }
  | { kind: 'details'; profileId: string }
  | { kind: 'wizard'; draft: Draft; step: WizardStep }
  | { kind: 'busy'; label: string };

interface KindOption {
  key: string;
  label: string;
  detail: string;
  providerId: ProviderKind;
  preset: string | null;
  apiStyle: 'openai-compatible' | 'gemini';
  baseUrl: string;
  requiresKey: boolean;
  badge?: string;
  config: Record<string, unknown>;
}

/** Presets that cost nothing to try or run locally. */
const FREE_PRESET_IDS = new Set([
  'cerebras',
  'ollama',
  'lmstudio',
  'vllm',
  'litellm',
  'github-models',
  'huggingface',
  'nvidia-nim',
  'modelscope',
  'gitee-ai',
  'siliconflow',
  'zhipu',
  'cloudflare-workers-ai',
]);
const FREE_BUILTIN_IDS = new Set<ProviderKind>(['gemini', 'groq', 'openrouter']);

function kindOptions(): KindOption[] {
  const builtins = PROVIDER_ORDER.filter((kind) => kind !== 'custom').map((kind) => {
    const definition = getProviderDefinition(kind);
    return {
      key: `builtin:${kind}`,
      label: definition.name,
      detail: definition.description,
      providerId: kind,
      preset: null,
      apiStyle: kind === 'gemini' ? 'gemini' : 'openai-compatible',
      baseUrl: definition.defaultBaseUrl,
      requiresKey: true,
      badge: FREE_BUILTIN_IDS.has(kind) ? 'free tier' : undefined,
      config: {},
    } satisfies KindOption;
  });
  const presets = PROVIDER_PRESETS.map((preset) => ({
    key: `preset:${preset.id}`,
    label: preset.label,
    detail: preset.notes,
    providerId: 'custom' as ProviderKind,
    preset: preset.id,
    apiStyle: preset.apiStyle,
    baseUrl: preset.baseUrl,
    requiresKey: preset.requiresKey,
    badge: preset.requiresKey
      ? FREE_PRESET_IDS.has(preset.id)
        ? 'free tier'
        : undefined
      : 'local · free',
    config: {
      preset: preset.id,
      apiStyle: preset.apiStyle,
      ...(preset.authHeader ? { authHeader: preset.authHeader } : {}),
      ...(preset.authPrefix !== undefined ? { authPrefix: preset.authPrefix } : {}),
    },
  }));
  return [
    ...builtins,
    ...presets,
    {
      key: 'custom:openai',
      label: 'OpenAI-compatible endpoint',
      detail: 'Any server with /chat/completions and /models — your own base URL',
      providerId: 'custom',
      preset: null,
      apiStyle: 'openai-compatible',
      baseUrl: '',
      requiresKey: false,
      badge: 'custom',
      config: { apiStyle: 'openai-compatible' },
    },
    {
      key: 'custom:gemini',
      label: 'Gemini-compatible endpoint',
      detail: 'Any server with generateContent — your own base URL',
      providerId: 'custom',
      preset: null,
      apiStyle: 'gemini',
      baseUrl: '',
      requiresKey: true,
      badge: 'custom',
      config: { apiStyle: 'gemini', authHeader: 'x-goog-api-key', authPrefix: '' },
    },
  ];
}

const ACCESS_OPTIONS: AccessClassification[] = ['unknown', 'user-free', 'user-paid', 'unavailable'];

const EFFORT_OPTIONS = ['low', 'medium', 'default', 'high', 'xhigh'] as const;
const EFFORT_DESCRIPTIONS: Record<string, string> = {
  low: 'fewest tokens — tight context, few steps, small tool output',
  medium: 'lean — smaller context budget and fewer agent steps',
  default: 'balanced — uses the global agent settings',
  high: 'deeper — larger context, more steps, bigger tool outputs',
  xhigh: 'maximum depth — largest context and step budget',
};

const TEXT_STEPS: WizardStep[] = ['name', 'baseUrl', 'defaultModel', 'apiKey', 'apiKeyEnv'];

function stepLabel(step: WizardStep): string {
  switch (step) {
    case 'name':
      return 'Profile name';
    case 'baseUrl':
      return 'Base URL';
    case 'defaultModel':
      return 'Default model (optional)';
    case 'apiKey':
      return 'API key(s), comma-separated for multiple (blank keeps current)';
    case 'apiKeyEnv':
      return 'Read the key from an environment variable (optional)';
    case 'effort':
      return 'Reasoning effort';
    default:
      return step;
  }
}

function draftFromProfile(profile: ProviderProfile): Draft {
  const config = readEndpointConfig(profile);
  return {
    providerId: profile.providerId,
    preset: config.preset ?? null,
    apiStyle: profile.providerId === 'gemini' ? 'gemini' : config.apiStyle,
    name: profile.name,
    baseUrl: profile.baseUrl,
    defaultModel: profile.defaultModel ?? '',
    apiKey: '',
    apiKeyEnv: profile.apiKeyEnv ?? '',
    access: profile.accessClassification,
    effort: typeof profile.config?.effort === 'string' ? profile.config.effort : 'default',
    requiresKey: !config.allowNoAuth,
    config: profile.config,
    editingId: profile.id,
  };
}

function draftFromKind(option: KindOption): Draft {
  return {
    providerId: option.providerId,
    preset: option.preset,
    apiStyle: option.apiStyle,
    name: option.preset
      ? (PROVIDER_PRESETS.find((entry) => entry.id === option.preset)?.label ?? option.label)
      : option.label.replace(/^Any /, 'Custom ').replace(/ endpoint$/, ''),
    baseUrl: option.baseUrl,
    defaultModel: option.preset
      ? (PROVIDER_PRESETS.find((entry) => entry.id === option.preset)?.exampleModel ?? '')
      : '',
    apiKey: '',
    apiKeyEnv: '',
    access: 'unknown',
    effort: 'default',
    requiresKey: option.requiresKey,
    config: option.config,
    editingId: null,
  };
}

function validateBaseUrl(value: string): string | null {
  if (!value.trim()) return 'A base URL is required.';
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'Use http:// or https://.';
    return null;
  } catch {
    return 'Enter a full URL, for example https://api.example.com/v1.';
  }
}

function lastCheckSucceeded(profile: ProviderProfile): boolean {
  return Boolean(
    profile.lastSuccessAt && (!profile.lastErrorAt || profile.lastSuccessAt >= profile.lastErrorAt),
  );
}

interface ProvidersProps {
  context: AppContext;
  active: boolean;
  notify: (message: string) => void;
  refreshData: () => void;
  onStatusChange: (status: AgentStatus) => void;
  onCycleScreen: (direction: 1 | -1) => void;
  onBack: () => void;
  /** Render inside a centered modal dialog instead of a full screen. */
  embedded?: boolean;
  /** When provided, "add provider" delegates to the shared connect flow. */
  onRequestConnect?: () => void;
}

function ProvidersFrame({
  embedded,
  title,
  subtitle,
  footer,
  children,
}: {
  embedded: boolean;
  title: string;
  subtitle?: string;
  footer?: string[];
  children: React.ReactNode;
}): React.ReactElement {
  if (embedded) {
    return (
      <ModalWindow
        title={title}
        subtitle={subtitle}
        width={84}
        height={34}
        footer={footer ?? ['↑/↓ move', 'enter select', 'esc back']}
      >
        {children}
      </ModalWindow>
    );
  }
  return (
    <PanelScreen title={title} subtitle={subtitle}>
      {children}
    </PanelScreen>
  );
}

export function ProvidersScreen({
  context,
  active,
  notify,
  refreshData,
  onStatusChange: _onStatusChange,
  onCycleScreen,
  onBack,
  embedded = false,
  onRequestConnect,
}: ProvidersProps): React.ReactElement {
  const { rows, columns } = useLayout();
  const navHint = embedded ? '' : ' ←/→ or tab screens';
  const backHint = embedded ? 'esc close' : 'esc back to workspace';
  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  const [selected, setSelected] = useState(0);
  const [kindIndex, setKindIndex] = useState(0);
  const [accessIndex, setAccessIndex] = useState(0);
  const [effortIndex, setEffortIndex] = useState(2);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (mode.kind !== 'busy') return;
    const timer = setInterval(() => setFrame((value) => value + 1), 120);
    return () => clearInterval(timer);
  }, [mode.kind]);

  const kinds = useMemo(kindOptions, []);
  const profiles = context.store.listProfiles();
  const storedIds = new Set(getCredentialStore().listSecretIds());
  const current = profiles[Math.min(selected, Math.max(0, profiles.length - 1))] ?? null;

  const startAdd = (): void => {
    if (onRequestConnect) {
      onRequestConnect();
      return;
    }
    setKindIndex(0);
    setError(null);
    setMode({ kind: 'wizard', draft: draftFromKind(kinds[0]!), step: 'kind' });
  };

  const startEdit = (profile: ProviderProfile): void => {
    const draft = draftFromProfile(profile);
    setAccessIndex(Math.max(0, ACCESS_OPTIONS.indexOf(draft.access)));
    setError(null);
    setMode({ kind: 'wizard', draft, step: 'name' });
  };

  const advance = (step: WizardStep): WizardStep => {
    const order: WizardStep[] = [
      'name',
      'baseUrl',
      'defaultModel',
      'apiKey',
      'apiKeyEnv',
      'access',
      'effort',
      'confirm',
    ];
    const index = order.indexOf(step);
    return order[Math.min(index + 1, order.length - 1)] ?? 'confirm';
  };

  const saveDraft = useCallback(
    async (draft: Draft): Promise<void> => {
      setError(null);
      setMode({ kind: 'busy', label: draft.editingId ? 'Saving profile…' : 'Creating profile…' });
      try {
        const definition = getProviderDefinition(draft.providerId);
        if (!draft.name.trim()) throw new Error('A profile name is required.');
        const urlError = validateBaseUrl(draft.baseUrl);
        if (urlError) throw new Error(urlError);
        const config = endpointConfigForStorage({
          ...draft.config,
          apiStyle: draft.apiStyle,
          preset: draft.preset,
          allowNoAuth: !draft.apiKey.trim() && !draft.apiKeyEnv.trim() ? !draft.requiresKey : false,
          effort: draft.effort,
        });
        const authType: 'api-key' | 'bearer' =
          draft.providerId === 'gemini' || config.authHeader === 'x-goog-api-key'
            ? 'api-key'
            : definition.authType;
        let profile: ProviderProfile;
        if (draft.editingId) {
          profile = context.store.updateProfile(draft.editingId, {
            name: draft.name.trim(),
            baseUrl: draft.baseUrl.trim(),
            authType,
            defaultModel: draft.defaultModel.trim() || null,
            apiKeyEnv: draft.apiKeyEnv.trim() || null,
            accessClassification: draft.access,
            config,
          });
        } else {
          profile = context.store.createProfile({
            providerId: draft.providerId,
            name: draft.name.trim(),
            baseUrl: draft.baseUrl.trim(),
            authType,
            defaultModel: draft.defaultModel.trim() || null,
            apiKeyEnv: draft.apiKeyEnv.trim() || null,
            accessClassification: draft.access,
            config,
            enabled: true,
          });
        }
        const credentialId = credentialIdForProfile(profile.id);
        const apiKeys = parseKeyInput(draft.apiKey);
        if (apiKeys.length > 0) {
          for (const entry of apiKeys) registerSecret(entry);
          await getCredentialStore().setSecret(credentialId, keysToSecret(apiKeys));
        }
        if (draft.apiKeyEnv.trim()) {
          await getCredentialStore().deleteSecret(credentialId);
        }
        // A new/updated credential invalidates old quota/auth cooldowns.
        context.store.clearLimitsForProfile(profile.id);
        if (!context.store.getSelectedProfileId()) context.store.setSelectedProfileId(profile.id);
        setSelected(
          Math.max(
            0,
            context.store.listProfiles().findIndex((entry) => entry.id === profile.id),
          ),
        );
        setMode({ kind: 'details', profileId: profile.id });
        notify(`${draft.editingId ? 'Updated' : 'Added'} ${profile.name}.`);
        refreshData();
      } catch (saveError) {
        setError(saveError instanceof Error ? saveError.message : String(saveError));
        setMode({ kind: 'wizard', draft, step: 'confirm' });
      }
    },
    [context, notify, refreshData],
  );

  const runTest = useCallback(
    async (profile: ProviderProfile): Promise<void> => {
      setMode({ kind: 'busy', label: `Testing ${profile.name}…` });
      setError(null);
      try {
        const result = await testProfileConnection(context.store, profile);
        notify(
          result.ok
            ? `${profile.name}: ${result.message} (${result.latencyMs}ms)`
            : `${profile.name} failed: ${result.message}`,
        );
        setMode({ kind: 'details', profileId: profile.id });
        refreshData();
      } catch (testError) {
        setError(testError instanceof Error ? testError.message : String(testError));
        setMode({ kind: 'details', profileId: profile.id });
      }
    },
    [context, notify, refreshData],
  );

  const runRefresh = useCallback(
    async (profile: ProviderProfile): Promise<void> => {
      setMode({ kind: 'busy', label: `Refreshing models for ${profile.name}…` });
      setError(null);
      try {
        const result = await refreshProfileModels(context.store, profile);
        notify(`Discovered ${result.discovered} models for ${profile.name}.`);
        const fresh = context.store.getProfile(profile.id);
        if (fresh && !fresh.defaultModel) {
          const models = context.store
            .listModels(fresh.providerId, fresh.providerId === 'custom' ? fresh.id : undefined)
            .filter((model) => model.available)
            .sort((a, b) => b.codingSuitability - a.codingSuitability);
          const best = models[0];
          if (best) context.store.updateProfile(fresh.id, { defaultModel: best.modelId });
        }
        setMode({ kind: 'details', profileId: profile.id });
        refreshData();
      } catch (refreshError) {
        setError(refreshError instanceof Error ? refreshError.message : String(refreshError));
        setMode({ kind: 'details', profileId: profile.id });
      }
    },
    [context, notify, refreshData],
  );

  const deleteProfile = useCallback(
    async (profile: ProviderProfile): Promise<void> => {
      setMode({ kind: 'busy', label: `Deleting ${profile.name}…` });
      try {
        await removeProfile(context.store, profile.id);
        setSelected(0);
        setMode({ kind: 'list' });
        notify(`Deleted ${profile.name}.`);
        refreshData();
      } catch (deleteError) {
        setError(deleteError instanceof Error ? deleteError.message : String(deleteError));
        setMode({ kind: 'list' });
      }
    },
    [context, notify, refreshData],
  );

  useInput(
    (input, key) => {
      if (mode.kind === 'busy') return;
      if (key.escape) {
        if (confirmDelete) {
          setConfirmDelete(null);
          return;
        }
        if (mode.kind === 'wizard') {
          setMode({ kind: 'list' });
          setError(null);
          return;
        }
        if (mode.kind === 'details') {
          setMode({ kind: 'list' });
          return;
        }
        onBack();
        return;
      }
      if (confirmDelete) {
        const target = profiles.find((profile) => profile.id === confirmDelete);
        if ((input === 'y' || input === 'Y') && target) {
          setConfirmDelete(null);
          void deleteProfile(target);
        } else if (input === 'n' || input === 'N') {
          setConfirmDelete(null);
        }
        return;
      }
      if (mode.kind === 'list') {
        if (key.leftArrow) {
          onCycleScreen(-1);
          return;
        }
        if (key.rightArrow) {
          onCycleScreen(1);
          return;
        }
        if (key.tab) {
          onCycleScreen(key.shift ? -1 : 1);
          return;
        }
        if (key.upArrow || input === 'k') {
          setSelected((value) =>
            profiles.length === 0 ? 0 : (value - 1 + profiles.length) % profiles.length,
          );
        } else if (key.downArrow || input === 'j') {
          setSelected((value) => (profiles.length === 0 ? 0 : (value + 1) % profiles.length));
        } else if (input === 'a') startAdd();
        else if (current && input === 'e') startEdit(current);
        else if (current && input === 't') void runTest(current);
        else if (current && input === 'r') void runRefresh(current);
        else if (current && input === 'd') setConfirmDelete(current.id);
        else if (current && input === ' ') {
          context.store.updateProfile(current.id, { enabled: !current.enabled });
          refreshData();
        } else if (current && isEnter(input, key))
          setMode({ kind: 'details', profileId: current.id });
        return;
      }
      if (mode.kind === 'details') {
        const profile = context.store.getProfile(mode.profileId);
        if (!profile) {
          setMode({ kind: 'list' });
          return;
        }
        if (key.leftArrow) {
          onCycleScreen(-1);
          return;
        }
        if (key.rightArrow) {
          onCycleScreen(1);
          return;
        }
        if (key.tab) {
          onCycleScreen(key.shift ? -1 : 1);
          return;
        }
        if (isEnter(input, key) || input === 't') void runTest(profile);
        else if (input === 'r') void runRefresh(profile);
        else if (input === 'e') startEdit(profile);
        else if (input === 'd') setConfirmDelete(profile.id);
        else if (input === ' ') {
          context.store.updateProfile(profile.id, { enabled: !profile.enabled });
          refreshData();
        }
        return;
      }
      if (mode.kind === 'wizard' && mode.step === 'kind') {
        if (key.upArrow || input === 'k') {
          setKindIndex((value) =>
            kinds.length === 0 ? 0 : (value - 1 + kinds.length) % kinds.length,
          );
        } else if (key.downArrow || input === 'j') {
          setKindIndex((value) => (kinds.length === 0 ? 0 : (value + 1) % kinds.length));
        } else if (isEnter(input, key)) {
          const option = kinds[kindIndex];
          if (option) {
            const draft = draftFromKind(option);
            setAccessIndex(Math.max(0, ACCESS_OPTIONS.indexOf(draft.access)));
            setMode({ kind: 'wizard', draft, step: 'name' });
          }
        }
        return;
      }
      if (mode.kind === 'wizard' && mode.step === 'access') {
        if (key.upArrow || input === 'k') {
          setAccessIndex((value) =>
            ACCESS_OPTIONS.length === 0
              ? 0
              : (value - 1 + ACCESS_OPTIONS.length) % ACCESS_OPTIONS.length,
          );
        } else if (key.downArrow || input === 'j') {
          setAccessIndex((value) =>
            ACCESS_OPTIONS.length === 0 ? 0 : (value + 1) % ACCESS_OPTIONS.length,
          );
        } else if (isEnter(input, key)) {
          const access = ACCESS_OPTIONS[accessIndex] ?? 'unknown';
          setMode({ kind: 'wizard', draft: { ...mode.draft, access }, step: 'effort' });
        }
        return;
      }
      if (mode.kind === 'wizard' && mode.step === 'effort') {
        if (key.upArrow || input === 'k') {
          setEffortIndex((value) => (value - 1 + EFFORT_OPTIONS.length) % EFFORT_OPTIONS.length);
        } else if (key.downArrow || input === 'j') {
          setEffortIndex((value) => (value + 1) % EFFORT_OPTIONS.length);
        } else if (isEnter(input, key)) {
          const effort = EFFORT_OPTIONS[effortIndex] ?? 'default';
          setMode({ kind: 'wizard', draft: { ...mode.draft, effort }, step: 'confirm' });
        }
        return;
      }
      if (mode.kind === 'wizard' && mode.step === 'confirm') {
        if (isEnter(input, key)) void saveDraft(mode.draft);
      }
    },
    { isActive: active },
  );

  const listWindow = Math.max(2, Math.floor((rows - 16) / 2));
  const listStart = Math.max(
    0,
    Math.min(selected - Math.floor(listWindow / 2), profiles.length - listWindow),
  );
  const kindWindow = Math.max(6, rows - 20);
  const kindStart = Math.max(
    0,
    Math.min(kindIndex - Math.floor(kindWindow / 2), kinds.length - kindWindow),
  );

  if (mode.kind === 'busy') {
    return (
      <ProvidersFrame embedded={embedded} title="Providers" subtitle="working">
        <Spinner frame={frame} label={mode.label} />
      </ProvidersFrame>
    );
  }

  if (mode.kind === 'wizard') {
    const draft = mode.draft;
    const isText = TEXT_STEPS.includes(mode.step);
    return (
      <ProvidersFrame
        embedded={embedded}
        title={draft.editingId ? 'Edit provider' : 'Add provider'}
        subtitle={isText ? stepLabel(mode.step) : mode.step}
        footer={['enter continue', 'esc back']}
      >
        <Text color={theme.muted} wrap="wrap">
          Custom platforms are first-class: any OpenAI-compatible or Gemini-compatible endpoint
          works.
        </Text>
        {error ? <Text color={theme.danger}>{error}</Text> : null}
        {mode.step === 'kind' ? (
          <Box flexDirection="column" marginTop={1} overflow="hidden">
            <Text color={theme.faint} wrap="truncate">
              {'  '}Free options are marked. Local endpoints need no key.
            </Text>
            {kinds.slice(kindStart, kindStart + kindWindow).map((option, offset) => {
              const index = kindStart + offset;
              const activeRow = index === kindIndex;
              return (
                <Box
                  key={option.key}
                  flexDirection="column"
                  backgroundColor={activeRow ? theme.surfaceAlt : undefined}
                >
                  <Box>
                    <Text color={activeRow ? theme.accent : theme.faint} bold={activeRow}>
                      {activeRow ? `${glyph.active} ` : '  '}
                    </Text>
                    <Text bold color={activeRow ? theme.text : theme.text}>
                      {option.label}
                    </Text>
                    {option.badge ? (
                      <Text color={activeRow ? theme.accent : theme.success}>
                        {'  '}[{option.badge}]
                      </Text>
                    ) : null}
                  </Box>
                  <Text color={theme.faint} wrap="truncate">
                    {'     '}
                    {clip(option.detail, Math.max(20, columns - 12))}
                    {option.baseUrl && option.preset ? (
                      <Text color={theme.faint}>{`  ${clip(option.baseUrl, 40)}`}</Text>
                    ) : null}
                  </Text>
                </Box>
              );
            })}
            <Hint>
              ↑/↓ choose {glyph.bullet} enter continue {glyph.bullet} esc cancel
            </Hint>
          </Box>
        ) : null}
        {isText ? (
          <Box flexDirection="column" marginTop={1}>
            <Text color={theme.muted}>{stepLabel(mode.step)}</Text>
            <PromptInput
              value={String((draft as unknown as Record<string, string>)[mode.step] ?? '')}
              mask={mode.step === 'apiKey' ? '*' : undefined}
              focus={active}
              placeholder={
                mode.step === 'apiKey' ? '(stored securely; never written to SQLite)' : ''
              }
              onChange={(value) => {
                setMode({
                  kind: 'wizard',
                  draft: { ...draft, [mode.step]: value } as Draft,
                  step: mode.step,
                });
              }}
              onSubmit={(value) => {
                if (mode.step === 'name' && !value.trim()) {
                  setError('A profile name is required.');
                  return;
                }
                if (mode.step === 'baseUrl') {
                  const urlError = validateBaseUrl(value);
                  if (urlError) {
                    setError(urlError);
                    return;
                  }
                }
                setError(null);
                const next = advance(mode.step);
                setMode({
                  kind: 'wizard',
                  draft: { ...draft, [mode.step]: value } as Draft,
                  step: next,
                });
              }}
            />
            <Hint>
              {mode.step === 'apiKeyEnv'
                ? 'Leave blank to store a key instead. Environment variables keep secrets out of the database.'
                : 'enter continue · esc cancels without saving'}
            </Hint>
          </Box>
        ) : null}
        {mode.step === 'access' ? (
          <Box flexDirection="column" marginTop={1}>
            <Text color={theme.muted}>How should routing classify this profile?</Text>
            {ACCESS_OPTIONS.map((access, index) => {
              const activeRow = index === accessIndex;
              return (
                <Text
                  key={access}
                  color={activeRow ? theme.black : theme.text}
                  backgroundColor={activeRow ? theme.accent : undefined}
                  bold={activeRow}
                >
                  {activeRow ? ` ${glyph.active} ` : '   '}
                  {access.padEnd(13)}
                  <Text color={activeRow ? theme.black : theme.faint}>
                    {access === 'unknown'
                      ? ' usable, not preferred'
                      : access === 'user-free'
                        ? ' free for you; preferred fallback'
                        : access === 'user-paid'
                          ? ' blocked unless allowPaid'
                          : ' never routed'}
                  </Text>
                </Text>
              );
            })}
            <Hint>
              ↑/↓ choose {glyph.bullet} enter continue {glyph.bullet} esc cancel
            </Hint>
          </Box>
        ) : null}
        {mode.step === 'effort' ? (
          <Box flexDirection="column" marginTop={1}>
            <Text color={theme.muted} wrap="wrap">
              How deep should the agent go on this profile? Lower effort uses far fewer tokens.
            </Text>
            {EFFORT_OPTIONS.map((effort, index) => {
              const activeRow = index === effortIndex;
              return (
                <Box
                  key={effort}
                  backgroundColor={activeRow ? theme.surfaceAlt : undefined}
                  flexDirection="column"
                >
                  <Text
                    color={activeRow ? theme.black : theme.text}
                    backgroundColor={activeRow ? theme.accent : undefined}
                    bold={activeRow}
                  >
                    {activeRow ? ` ${glyph.active} ` : '   '}
                    {effort.padEnd(10)}
                    <Text color={activeRow ? theme.black : theme.faint}>
                      {EFFORT_DESCRIPTIONS[effort]}
                    </Text>
                  </Text>
                </Box>
              );
            })}
            <Hint>
              ↑/↓ choose {glyph.bullet} enter continue {glyph.bullet} esc cancel
            </Hint>
          </Box>
        ) : null}
        {mode.step === 'confirm' ? (
          <Box flexDirection="column" marginTop={1}>
            <KeyValue
              rows={[
                ['Name', draft.name || '(missing)'],
                ['Provider', providerDisplayName(draft.providerId)],
                ['Base URL', draft.baseUrl || '(missing)'],
                ['Protocol', draft.apiStyle],
                ['Default model', draft.defaultModel || '(none)'],
                [
                  'Credential',
                  draft.apiKey
                    ? maskSecret(draft.apiKey)
                    : draft.apiKeyEnv
                      ? `env:${draft.apiKeyEnv}`
                      : 'none',
                ],
                ['Access', draft.access],
                ['Effort', draft.effort],
                [
                  'Discovery',
                  draft.apiStyle === 'gemini' || draft.providerId !== 'gemini'
                    ? 'provider list'
                    : 'Gemini list',
                ],
              ]}
            />
            <Box marginTop={1}>
              <Text color={theme.muted}>
                <Text bold color={theme.accent}>
                  enter
                </Text>{' '}
                save <Text color={theme.faint}>{glyph.bullet} esc cancels</Text>
              </Text>
            </Box>
            {error ? <Text color={theme.danger}>{error}</Text> : null}
          </Box>
        ) : null}
      </ProvidersFrame>
    );
  }

  if (mode.kind === 'details') {
    const profile = context.store.getProfile(mode.profileId);
    if (!profile) {
      return (
        <ProvidersFrame embedded={embedded} title="Providers" subtitle="missing">
          <Text color={theme.muted}>This profile no longer exists. Press esc to return.</Text>
        </ProvidersFrame>
      );
    }
    const config = readEndpointConfig(profile);
    const models = context.store
      .listModels(profile.providerId, profile.providerId === 'custom' ? profile.id : undefined)
      .filter((model) => model.profileId === null || model.profileId === profile.id);
    const limits = context.store.listLimits(true).filter((limit) => limit.profileId === profile.id);
    const keyState = profile.apiKeyEnv
      ? `env:${profile.apiKeyEnv}`
      : storedIds.has(credentialIdForProfile(profile.id))
        ? 'stored securely'
        : config.allowNoAuth
          ? 'no auth'
          : 'missing';
    return (
      <ProvidersFrame
        embedded={embedded}
        title={profile.name}
        subtitle={providerDisplayName(profile.providerId)}
        footer={['t test', 'r refresh', 'e edit', 'space toggle', 'd delete', 'esc back']}
      >
        {error ? <Text color={theme.danger}>{error}</Text> : null}
        <KeyValue
          rows={[
            ['Provider', providerDisplayName(profile.providerId)],
            ['Base URL', profile.baseUrl],
            ['Protocol', profile.providerId === 'gemini' ? 'gemini' : config.apiStyle],
            ['Credential', keyState],
            ['Default model', profile.defaultModel ?? '—'],
            ['Enabled', profile.enabled ? 'yes' : 'no'],
            ['Access', profile.accessClassification],
            ['Effort', typeof config.effort === 'string' ? config.effort : 'default'],
            ['Discovery', config.supportsModelDiscovery ? 'yes' : 'no'],
            ['Streaming', config.supportsStreaming ? 'yes' : 'no'],
            ['Models', String(models.length)],
            ['Last success', formatRelative(profile.lastSuccessAt)],
            ['Last error', profile.lastError ? clip(profile.lastError, 70) : '—'],
            ['Active limits', limits.length ? String(limits.length) : 'none'],
          ]}
          width={18}
        />
        <Box marginTop={1} flexDirection="column" overflow="hidden">
          <Text bold color={theme.text}>
            Models
          </Text>
          {models.slice(0, 6).map((model) => (
            <Text key={model.id} color={theme.faint} wrap="truncate">
              {'  '}
              {model.modelId} [{model.access}]
            </Text>
          ))}
          {models.length > 6 ? (
            <Text color={theme.faint}> … {models.length - 6} more in the model picker</Text>
          ) : null}
        </Box>
        <Box marginTop={1} flexShrink={0}>
          <Text color={theme.muted} wrap="truncate">
            <Text color={theme.accent}>t</Text> test {glyph.bullet}{' '}
            <Text color={theme.accent}>r</Text> refresh {glyph.bullet}{' '}
            <Text color={theme.accent}>e</Text> edit {glyph.bullet}{' '}
            <Text color={theme.accent}>space</Text> enable/disable {glyph.bullet}{' '}
            <Text color={theme.accent}>d</Text> delete {glyph.bullet} esc back
          </Text>
        </Box>
        <Hint>{`esc returns to the profile list${navHint}`}</Hint>
      </ProvidersFrame>
    );
  }

  return (
    <ProvidersFrame
      embedded={embedded}
      title="Providers"
      subtitle={`${profiles.length} configured`}
      footer={[
        'a add',
        'enter details',
        'e edit',
        't test',
        'r refresh',
        'space toggle',
        'd delete',
        'esc close',
      ]}
    >
      {error ? <Text color={theme.danger}>{error}</Text> : null}
      {profiles.length === 0 ? (
        <Empty>
          No providers yet. Press a to connect Gemini, Groq, OpenRouter, OpenAI, or any custom
          platform.
        </Empty>
      ) : (
        <Box flexDirection="column" marginTop={1} overflow="hidden">
          {profiles.slice(listStart, listStart + listWindow).map((profile, offset) => {
            const index = listStart + offset;
            const key = profile.apiKeyEnv
              ? `env:${profile.apiKeyEnv}`
              : storedIds.has(credentialIdForProfile(profile.id))
                ? 'key stored'
                : 'no key';
            const activeRow = index === selected;
            return (
              <Box key={profile.id} flexDirection="column" marginBottom={1}>
                <Text color={activeRow ? theme.text : theme.muted}>
                  {activeRow ? (
                    <Text color={theme.accent} bold>
                      {glyph.active}{' '}
                    </Text>
                  ) : (
                    '  '
                  )}
                  <Text color={lastCheckSucceeded(profile) ? theme.success : theme.faint}>
                    {lastCheckSucceeded(profile) ? glyph.check : glyph.ring}
                  </Text>{' '}
                  <Text bold color={activeRow ? theme.text : theme.text}>
                    {profile.name}
                  </Text>
                  <Text color={theme.faint}> {providerDisplayName(profile.providerId)}</Text>
                  <Text color={theme.accent}> {profile.defaultModel ?? 'no default model'}</Text>
                </Text>
                <Text color={theme.faint} wrap="truncate">
                  {'    '}
                  {clip(profile.baseUrl, Math.max(20, columns - 34))} {glyph.bullet} {key}{' '}
                  {glyph.bullet} {profile.accessClassification} {glyph.bullet}{' '}
                  {profile.enabled ? 'enabled' : 'disabled'} {glyph.bullet}{' '}
                  {formatRelative(profile.lastSuccessAt)}
                </Text>
              </Box>
            );
          })}
        </Box>
      )}
      {confirmDelete ? (
        <Text color={theme.warning}>
          Delete {profiles.find((profile) => profile.id === confirmDelete)?.name} and its
          credential? <Text bold>y</Text> yes {glyph.bullet} <Text bold>n</Text> no
        </Text>
      ) : (
        <Box marginTop={1} flexShrink={0}>
          <Text color={theme.muted} wrap="truncate">
            <Text color={theme.accent}>a</Text> add {glyph.bullet}{' '}
            <Text color={theme.accent}>enter</Text> details {glyph.bullet}{' '}
            <Text color={theme.accent}>e</Text> edit {glyph.bullet}{' '}
            <Text color={theme.accent}>t</Text> test {glyph.bullet}{' '}
            <Text color={theme.accent}>r</Text> refresh {glyph.bullet}{' '}
            <Text color={theme.accent}>space</Text> toggle {glyph.bullet}{' '}
            <Text color={theme.accent}>d</Text> delete
          </Text>
        </Box>
      )}
      <Hint>{`↑/↓ move${navHint} ${glyph.bullet} ${backHint}`}</Hint>
    </ProvidersFrame>
  );
}
