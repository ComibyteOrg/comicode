import React, { useState, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import { randomUUID } from 'node:crypto';
import type { AppContext } from '../../core/app.js';
import type { ProviderKind, ProviderProfile } from '../../core/types.js';
import { providerDisplayName } from '../../core/providers/definitions.js';
import {
  credentialIdForProfile,
  keysToSecret,
  parseKeyInput,
  refreshProfileModels,
  testProfileConnection,
} from '../../core/providers/service.js';
import { getCredentialStore } from '../../core/security/credentials.js';
import { registerSecret } from '../../core/security/redact.js';
import { maskSecret } from '../../core/security/masking.js';
import { Selector, filterByQuery, type SelectorItem } from './selector.js';
import { PromptInput, Spinner } from '../components.js';
import { glyph, theme } from '../theme.js';
import { ModalWindow } from './modal.js';

interface ConnectDialogProps {
  context: AppContext;
  onClose: () => void;
  onConnected: (profile: ProviderProfile) => void;
  notify: (message: string) => void;
  refreshData: () => void;
}

type Step = 'select-provider' | 'configure-profile' | 'testing';

interface ProviderChoice {
  kind: ProviderKind;
  presetId?: string;
  label: string;
  detail: string;
  defaultBaseUrl: string;
  defaultModel: string;
  requiresKey: boolean;
  apiStyle: 'openai-compatible' | 'gemini';
}

const PROVIDER_CHOICES: ProviderChoice[] = [
  {
    kind: 'gemini',
    label: 'Google AI Studio',
    detail: 'Gemini models through Google AI Studio',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-2.5-flash',
    requiresKey: true,
    apiStyle: 'gemini',
  },
  {
    kind: 'groq',
    label: 'Groq Cloud',
    detail: 'Fast OpenAI-compatible inference from GroqCloud',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    requiresKey: true,
    apiStyle: 'openai-compatible',
  },
  {
    kind: 'openrouter',
    label: 'OpenRouter',
    detail: 'A unified gateway for models with provider-specific pricing',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'meta-llama/llama-3.3-70b-instruct:free',
    requiresKey: true,
    apiStyle: 'openai-compatible',
  },
  {
    kind: 'openai',
    label: 'OpenAI-compatible API',
    detail: 'Standard /v1/chat/completions endpoint (OpenAI, Anyscale, etc.)',
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o',
    requiresKey: true,
    apiStyle: 'openai-compatible',
  },
  {
    kind: 'custom',
    label: 'Custom Provider (Local / Self-hosted)',
    detail: 'Ollama, vLLM, LM Studio, LocalAI, or private inference server',
    defaultBaseUrl: 'http://localhost:11434/v1',
    defaultModel: 'qwen2.5-coder:32b',
    requiresKey: false,
    apiStyle: 'openai-compatible',
  },
];

type FieldIndex = 0 | 1 | 2 | 3; // name, apiKey, baseUrl, defaultModel

export function ConnectDialog({
  context,
  onClose,
  onConnected,
  notify,
  refreshData,
}: ConnectDialogProps): React.ReactElement {
  const [step, setStep] = useState<Step>('select-provider');
  const [providerIndex, setProviderIndex] = useState(0);
  const [providerQuery, setProviderQuery] = useState('');
  const [selectedProvider, setSelectedProvider] = useState<ProviderChoice>(PROVIDER_CHOICES[0]!);

  // Configuration Form State
  const [fieldIndex, setFieldIndex] = useState<FieldIndex>(0);
  const [name, setName] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [defaultModel, setDefaultModel] = useState('');
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const existingProfiles = useMemo(() => context.store.listProfiles(), [context, step]);

  const providerItems: SelectorItem[] = useMemo(() => {
    const items = PROVIDER_CHOICES.map((choice) => {
      const connected = existingProfiles.filter((p) => p.providerId === choice.kind);
      const countBadge =
        connected.length > 0
          ? `${connected.length} connected`
          : choice.kind === 'custom'
            ? 'custom'
            : 'not connected';
      const connectedNames = connected.map((p) => p.name).join(', ');
      return {
        key: choice.kind,
        label: choice.label,
        detail: `${choice.detail}${connectedNames ? ` · profiles: ${connectedNames}` : ''}`,
        badge: countBadge,
        badgeColor: connected.length > 0 ? theme.success : theme.faint,
      };
    });
    return filterByQuery(items, providerQuery, (item) => [item.label, item.detail ?? '']);
  }, [existingProfiles, providerQuery]);

  const handleSelectProvider = (item: SelectorItem) => {
    const choice = PROVIDER_CHOICES.find((c) => c.kind === item.key) ?? PROVIDER_CHOICES[0]!;
    setSelectedProvider(choice);

    // Suggest default profile name based on existing profiles
    const existingSameKind = existingProfiles.filter((p) => p.providerId === choice.kind);
    const defaultName =
      existingSameKind.length === 0
        ? 'Default'
        : existingSameKind.length === 1
          ? 'Work'
          : `Profile-${existingSameKind.length + 1}`;

    setName(defaultName);
    setBaseUrl(choice.defaultBaseUrl);
    setDefaultModel(choice.defaultModel);
    setApiKey('');
    setTestResult(null);
    setStatusMessage(null);
    setFieldIndex(choice.requiresKey ? 1 : 0);
    setStep('configure-profile');
  };

  const handleTestConnection = async (): Promise<boolean> => {
    if (selectedProvider.requiresKey && !apiKey.trim()) {
      setTestResult({ ok: false, message: 'API key is required for testing.' });
      return false;
    }
    setStatusMessage('Testing connection…');
    setTestResult(null);

    let passed = false;
    const temporaryProfileId = `test-${randomUUID()}`;
    let temporaryCredentialId: string | null = null;
    try {
      const dummyProfile: ProviderProfile = {
        id: temporaryProfileId,
        providerId: selectedProvider.kind,
        name: name.trim() || 'Test',
        baseUrl: baseUrl.trim() || selectedProvider.defaultBaseUrl,
        authType: selectedProvider.requiresKey ? 'api-key' : 'bearer',
        defaultModel: defaultModel.trim() || selectedProvider.defaultModel,
        accessClassification: 'unknown',
        enabled: true,
        apiKeyEnv: null,
        lastSuccessAt: null,
        lastError: null,
        lastErrorAt: null,
        lastCheckedAt: null,
        modelsRefreshedAt: null,
        config: {
          apiStyle: selectedProvider.apiStyle,
          allowNoAuth: !selectedProvider.requiresKey,
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const tempKeys = parseKeyInput(apiKey);
      if (tempKeys.length > 0) {
        for (const entry of tempKeys) registerSecret(entry);
        temporaryCredentialId = credentialIdForProfile(dummyProfile.id);
        await getCredentialStore().setSecret(temporaryCredentialId, keysToSecret(tempKeys));
      }

      const res = await testProfileConnection(context.store, dummyProfile, {
        persistStatus: false,
      });

      if (res.ok) {
        passed = true;
        setTestResult({
          ok: true,
          message:
            res.message || `Connected successfully (${res.modelCount ?? 0} models discovered).`,
        });
      } else {
        setTestResult({
          ok: false,
          message: res.message || 'Connection failed.',
        });
      }
    } catch (err) {
      setTestResult({
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      if (temporaryCredentialId) {
        try {
          await getCredentialStore().deleteSecret(temporaryCredentialId);
        } catch (cleanupError) {
          passed = false;
          setTestResult({
            ok: false,
            message: `Connection test finished, but temporary credential cleanup failed: ${
              cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
            }`,
          });
        }
      }
      setStatusMessage(null);
    }
    return passed;
  };

  const handleSave = async () => {
    const finalName = name.trim();
    if (!finalName) {
      setTestResult({ ok: false, message: 'Profile name cannot be empty.' });
      return;
    }

    if (selectedProvider.requiresKey && !apiKey.trim()) {
      setTestResult({ ok: false, message: 'API key is required.' });
      return;
    }

    try {
      const profile = context.store.createProfile({
        providerId: selectedProvider.kind,
        name: finalName,
        baseUrl: baseUrl.trim() || selectedProvider.defaultBaseUrl,
        authType: selectedProvider.requiresKey ? 'api-key' : 'bearer',
        defaultModel: defaultModel.trim() || selectedProvider.defaultModel,
        accessClassification: 'unknown',
        enabled: true,
        config: {
          apiStyle: selectedProvider.apiStyle,
          allowNoAuth: !selectedProvider.requiresKey,
        },
      });

      // Save secret credential
      const finalKeys = parseKeyInput(apiKey);
      if (finalKeys.length > 0) {
        for (const entry of finalKeys) registerSecret(entry);
        const credStore = getCredentialStore();
        await credStore.setSecret(
          credentialIdForProfile(profile.id),
          keysToSecret(finalKeys),
        );
      }

      // Try discovering models in background
      void refreshProfileModels(context.store, profile).catch(() => {});

      // Set active profile if none or only one exists
      if (!context.store.getSelectedProfileId() || existingProfiles.length === 0) {
        context.store.setSelectedProfileId(profile.id);
      }

      notify(`Connected ${profile.name} (${providerDisplayName(profile.providerId)}).`);
      refreshData();
      onConnected(profile);
      onClose();
    } catch (err) {
      setTestResult({
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  // Keyboard navigation for configuration step
  useInput(
    (input, key) => {
      if (step !== 'configure-profile') return;

      if (key.escape) {
        setStep('select-provider');
        return;
      }

      if (key.tab) {
        setFieldIndex((cur) => ((cur + (key.shift ? -1 : 1) + 4) % 4) as FieldIndex);
        return;
      }

      if (key.ctrl && input === 't') {
        void handleTestConnection();
        return;
      }

      if (key.ctrl && input === 's') {
        void handleSave();
        return;
      }
    },
    { isActive: step === 'configure-profile' },
  );

  if (step === 'select-provider') {
    return (
      <Selector
        title="CONNECT PROVIDER"
        subtitle="pick a provider to connect"
        items={providerItems}
        query={providerQuery}
        onQueryChange={(value) => {
          setProviderQuery(value);
          setProviderIndex(0);
        }}
        selected={providerIndex}
        onSelectedChange={setProviderIndex}
        onSelect={handleSelectProvider}
        onClose={onClose}
        searchPlaceholder="Filter providers…"
        footer={['↑↓ navigate', 'enter select', 'esc close']}
      />
    );
  }

  // Configuration Step
  return (
    <ModalWindow
      title={`CONNECT ${selectedProvider.label.toUpperCase()}`}
      subtitle="Configure profile"
      width={72}
      height={20}
      borderColor={theme.accent}
      footer={['tab next field', 'ctrl+t test', 'ctrl+s save', 'esc back']}
    >
      <Box flexDirection="column" marginTop={1} flexGrow={1}>
        {/* Field 0: Profile Name */}
        <Box marginBottom={1}>
          <Text color={fieldIndex === 0 ? theme.accent : theme.faint} bold={fieldIndex === 0}>
            {fieldIndex === 0 ? `▸ ` : `  `}Profile name:
          </Text>
          <Box marginLeft={2} flexGrow={1}>
            <PromptInput
              value={name}
              onChange={setName}
              onSubmit={() => setFieldIndex(1)}
              focus={fieldIndex === 0}
              placeholder="e.g. Personal, Work, Backup"
            />
          </Box>
        </Box>

        {/* Field 1: API Key */}
        <Box marginBottom={1}>
          <Text color={fieldIndex === 1 ? theme.accent : theme.faint} bold={fieldIndex === 1}>
            {fieldIndex === 1 ? `▸ ` : `  `}API key:
          </Text>
          <Box marginLeft={2} flexGrow={1}>
            {fieldIndex === 1 ? (
              <PromptInput
                value={apiKey}
                onChange={setApiKey}
                onSubmit={() => setFieldIndex(2)}
                focus={fieldIndex === 1}
                mask="*"
                placeholder={
                  selectedProvider.requiresKey
                    ? 'Paste API key(s), comma-separate for multiple (masked)'
                    : 'Optional'
                }
              />
            ) : (
              <Text color={apiKey ? theme.muted : theme.faint}>
                {apiKey ? `${maskSecret(apiKey)} (hidden)` : '(none)'}
              </Text>
            )}
          </Box>
        </Box>

        {/* Field 2: Base URL */}
        <Box marginBottom={1}>
          <Text color={fieldIndex === 2 ? theme.accent : theme.faint} bold={fieldIndex === 2}>
            {fieldIndex === 2 ? `▸ ` : `  `}Base URL:
          </Text>
          <Box marginLeft={2} flexGrow={1}>
            <PromptInput
              value={baseUrl}
              onChange={setBaseUrl}
              onSubmit={() => setFieldIndex(3)}
              focus={fieldIndex === 2}
              placeholder={selectedProvider.defaultBaseUrl}
            />
          </Box>
        </Box>

        {/* Field 3: Default Model */}
        <Box marginBottom={1}>
          <Text color={fieldIndex === 3 ? theme.accent : theme.faint} bold={fieldIndex === 3}>
            {fieldIndex === 3 ? `▸ ` : `  `}Default model:
          </Text>
          <Box marginLeft={2} flexGrow={1}>
            <PromptInput
              value={defaultModel}
              onChange={setDefaultModel}
              onSubmit={() => void handleSave()}
              focus={fieldIndex === 3}
              placeholder={selectedProvider.defaultModel}
            />
          </Box>
        </Box>

        {/* Status / Test feedback */}
        {statusMessage ? (
          <Box marginY={1}>
            <Spinner frame={0} label={statusMessage} />
          </Box>
        ) : null}

        {testResult ? (
          <Box marginY={1}>
            <Text color={testResult.ok ? theme.success : theme.danger}>
              {testResult.ok ? glyph.check : glyph.cross} {testResult.message}
            </Text>
          </Box>
        ) : null}
      </Box>

      {/* Action Buttons */}
      <Box justifyContent="flex-end" flexShrink={0} marginTop={1}>
        <Text color={theme.faint}>
          <Text color={theme.info}>[ Ctrl+T Test Connection ]</Text>
          {'   '}
          <Text color={theme.accent}>[ Ctrl+S Save ]</Text>
          {'   '}
          <Text color={theme.muted}>[ Esc Back ]</Text>
        </Text>
      </Box>
    </ModalWindow>
  );
}
