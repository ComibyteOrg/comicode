import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { AppContext } from '../../core/app.js';
import type { ModelInfo, ProviderProfile } from '../../core/types.js';
import { providerDisplayName } from '../../core/providers/definitions.js';
import {
  ACCESS_LABELS,
  effectiveAccess,
  isFreeAccess,
  isPaidAccess,
} from '../../core/providers/catalog.js';
import { addManualModel, refreshProfileModels } from '../../core/providers/service.js';
import {
  Empty,
  Hint,
  PromptInput,
  PanelScreen,
  Spinner,
  clip,
  isEnter,
  useLayout,
} from '../components.js';
import { glyph, theme } from '../theme.js';

function owningProfile(profiles: ProviderProfile[], model: ModelInfo): ProviderProfile | null {
  if (model.profileId) return profiles.find((profile) => profile.id === model.profileId) ?? null;
  return (
    profiles.find(
      (profile) =>
        profile.providerId === model.providerId && profile.defaultModel === model.modelId,
    ) ??
    profiles.find((profile) => profile.providerId === model.providerId && profile.enabled) ??
    profiles.find((profile) => profile.providerId === model.providerId) ??
    null
  );
}

function accessColor(access: string): string {
  if (access === 'free-confirmed' || access === 'user-free') return theme.success;
  if (access === 'free-tier') return theme.accent;
  if (access === 'paid' || access === 'user-paid') return theme.warning;
  if (access === 'unavailable') return theme.danger;
  return theme.muted;
}

interface ModelsProps {
  context: AppContext;
  active: boolean;
  notify: (message: string) => void;
  refreshData: () => void;
  onCycleScreen: (direction: 1 | -1) => void;
  onBack: () => void;
}

export function ModelsScreen({
  context,
  active,
  notify,
  refreshData,
  onCycleScreen,
  onBack,
}: ModelsProps): React.ReactElement {
  const { rows, columns } = useLayout();
  const [selected, setSelected] = useState(0);
  const [search, setSearch] = useState('');
  const [searchMode, setSearchMode] = useState(false);
  const [freeOnly, setFreeOnly] = useState(false);
  const [toolsOnly, setToolsOnly] = useState(false);
  const [availableOnly, setAvailableOnly] = useState(true);
  const [manualMode, setManualMode] = useState(false);
  const [manualValue, setManualValue] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => setFrame((value) => value + 1), 120);
    return () => clearInterval(timer);
  }, [busy]);

  const profiles = context.store.listProfiles();
  const selectedModelKey = context.store.getSelectedModelId();
  const models = useMemo(() => {
    let entries = context.store
      .listModels()
      .filter((model) => profiles.some((profile) => profile.providerId === model.providerId));
    if (availableOnly) entries = entries.filter((model) => model.available);
    if (freeOnly) {
      entries = entries.filter((model) =>
        isFreeAccess(
          effectiveAccess(model, owningProfile(profiles, model)?.accessClassification ?? null),
        ),
      );
    }
    if (toolsOnly) entries = entries.filter((model) => model.supportsTools);
    if (search.trim()) {
      const needle = search.trim().toLowerCase();
      entries = entries.filter(
        (model) =>
          model.modelId.toLowerCase().includes(needle) ||
          model.displayName.toLowerCase().includes(needle) ||
          (owningProfile(profiles, model)?.name.toLowerCase().includes(needle) ?? false),
      );
    }
    return entries.sort(
      (a, b) => b.codingSuitability - a.codingSuitability || a.modelId.localeCompare(b.modelId),
    );
  }, [context, profiles, availableOnly, freeOnly, toolsOnly, search, busy]);

  const current = models[Math.min(selected, Math.max(0, models.length - 1))] ?? null;
  const currentProfile = current ? owningProfile(profiles, current) : null;

  useInput(
    (input, key) => {
      if (busy) return;
      if (manualMode) {
        if (key.escape) {
          setManualMode(false);
          setManualValue('');
        }
        return;
      }
      if (searchMode) {
        if (key.escape || isEnter(input, key)) setSearchMode(false);
        return;
      }
      if (key.escape) {
        if (search) {
          setSearch('');
          return;
        }
        onBack();
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
      if (key.upArrow || input === 'k') {
        setSelected((value) => (models.length === 0 ? 0 : (value - 1 + models.length) % models.length));
      } else if (key.downArrow || input === 'j') {
        setSelected((value) => (models.length === 0 ? 0 : (value + 1) % models.length));
      } else if (input === '/') setSearchMode(true);
      else if (input === 'f') {
        setFreeOnly((value) => !value);
        setSelected(0);
      } else if (input === 't') {
        setToolsOnly((value) => !value);
        setSelected(0);
      } else if (input === 'v') {
        setAvailableOnly((value) => !value);
        setSelected(0);
      } else if (input === 'm' && currentProfile) {
        setManualMode(true);
        setManualValue('');
      } else if (isEnter(input, key) && current && currentProfile) {
        const access = effectiveAccess(current, currentProfile.accessClassification);
        context.store.setSelectedProfileId(currentProfile.id);
        context.store.setSelectedModelId(current.id);
        notify(
          `Selected ${current.modelId} via ${currentProfile.name}${isPaidAccess(access) ? ' (paid; explicit selection honored)' : ''}.`,
        );
        refreshData();
      } else if (input === 'p' && current && currentProfile) {
        context.store.updateProfile(currentProfile.id, { defaultModel: current.modelId });
        notify(`Default model for ${currentProfile.name} is now ${current.modelId}.`);
        refreshData();
      } else if (input === 'r') {
        setBusy('Refreshing model catalogs…');
        setError(null);
        void (async () => {
          const enabled = profiles.filter((profile) => profile.enabled);
          let discovered = 0;
          const failures: string[] = [];
          for (const profile of enabled) {
            try {
              const result = await refreshProfileModels(context.store, profile);
              discovered += result.discovered;
            } catch (refreshError) {
              failures.push(
                `${profile.name}: ${refreshError instanceof Error ? refreshError.message : String(refreshError)}`,
              );
            }
          }
          setBusy(null);
          refreshData();
          if (failures.length) {
            setError(failures.join(' · '));
            notify(`Refreshed ${enabled.length - failures.length}/${enabled.length} profiles.`);
          } else {
            notify(`Refreshed ${discovered} models across ${enabled.length} profiles.`);
          }
        })();
      }
    },
    { isActive: active },
  );

  const submitManual = async (): Promise<void> => {
    const profile = currentProfile ?? profiles.find((entry) => entry.enabled) ?? null;
    if (!profile) {
      setManualMode(false);
      setError('Connect a provider profile first.');
      return;
    }
    if (!manualValue.trim()) {
      setManualMode(false);
      return;
    }
    setBusy(`Adding ${manualValue.trim()}…`);
    try {
      await addManualModel(context.store, profile, manualValue.trim());
      if (!profile.defaultModel) {
        context.store.updateProfile(profile.id, { defaultModel: manualValue.trim() });
      }
      notify(`Added ${manualValue.trim()} to ${profile.name}.`);
      setManualMode(false);
      setManualValue('');
      refreshData();
    } catch (manualError) {
      setError(manualError instanceof Error ? manualError.message : String(manualError));
    } finally {
      setBusy(null);
    }
  };

  const windowSize = Math.max(6, rows - 20);
  const start = Math.max(
    0,
    Math.min(selected - Math.floor(windowSize / 2), models.length - windowSize),
  );
  const modelWidth = Math.max(18, Math.min(34, columns - 50));
  const profileWidth = Math.max(10, Math.min(18, columns - modelWidth - 24));

  if (busy) {
    return (
      <PanelScreen title="Models" subtitle="catalog">
        <Spinner frame={frame} label={busy} />
      </PanelScreen>
    );
  }

  return (
    <PanelScreen
      title="Models"
      subtitle={`${models.length} shown ${glyph.bullet} ${profiles.length} profiles`}
    >
      {searchMode ? (
        <Box>
          <PromptInput
            value={search}
            onChange={setSearch}
            onSubmit={() => setSearchMode(false)}
            focus={active && searchMode}
            placeholder="model id, name, or profile"
            prompt={<Text color={theme.accent}>search </Text>}
            promptColor={theme.accent}
          />
        </Box>
      ) : search ? (
        <Text color={theme.faint}>
          filter {search} {glyph.bullet} / edit {glyph.bullet} esc clear
        </Text>
      ) : (
        <Text color={theme.faint}>
          {freeOnly ? 'free ' : ''}
          {toolsOnly ? 'tools ' : ''}
          {availableOnly ? 'available' : 'all'}
        </Text>
      )}
      {manualMode ? (
        <Box flexDirection="column" marginTop={1}>
          <Text color={theme.muted}>
            Add a model manually to {currentProfile?.name ?? profiles[0]?.name ?? 'a profile'}
          </Text>
          <PromptInput
            value={manualValue}
            onChange={setManualValue}
            onSubmit={() => void submitManual()}
            focus={active && manualMode}
            placeholder="model-id"
          />
          <Hint>Enter adds it {glyph.bullet} esc cancels</Hint>
        </Box>
      ) : null}
      {error ? (
        <Text color={theme.danger} wrap="truncate">
          {clip(error, 140)}
        </Text>
      ) : null}
      {models.length === 0 ? (
        <Empty>
          No models match. Refresh with r, clear filters, or press m to add a model id manually for
          your custom endpoint.
        </Empty>
      ) : (
        <Box flexDirection="column" marginTop={1} overflow="hidden">
          <Text color={theme.faint}>
            {'  '}
            {'MODEL'.padEnd(modelWidth)}
            {'PROFILE'.padEnd(profileWidth)}
            ACCESS
          </Text>
          {models.slice(start, start + windowSize).map((model, offset) => {
            const index = start + offset;
            const owner = owningProfile(profiles, model);
            const access = effectiveAccess(model, owner?.accessClassification ?? null);
            const selectedKey = selectedModelKey === model.id;
            const activeRow = index === selected;
            return (
              <Text key={model.id} color={activeRow ? theme.text : theme.muted}>
                {activeRow ? (
                  <Text color={theme.accent} bold>
                    {glyph.active}{' '}
                  </Text>
                ) : (
                  '  '
                )}
                {selectedKey ? <Text color={theme.accent}>{glyph.dot}</Text> : ' '}
                {clip(model.modelId, modelWidth - 1).padEnd(modelWidth)}
                {clip(
                  owner?.name ?? providerDisplayName(model.providerId),
                  profileWidth - 1,
                ).padEnd(profileWidth)}
                <Text color={accessColor(access)}>{clip(ACCESS_LABELS[access] ?? access, 13)}</Text>
              </Text>
            );
          })}
        </Box>
      )}
      <Box marginTop={1} flexShrink={0}>
        <Text color={theme.muted} wrap="truncate">
          <Text color={theme.accent}>enter</Text> select {glyph.bullet}{' '}
          <Text color={theme.accent}>p</Text> default {glyph.bullet}{' '}
          <Text color={theme.accent}>m</Text> add {glyph.bullet} <Text color={theme.accent}>r</Text>{' '}
          refresh {glyph.bullet} <Text color={theme.accent}>f</Text> free {glyph.bullet}{' '}
          <Text color={theme.accent}>t</Text> tools {glyph.bullet}{' '}
          <Text color={theme.accent}>v</Text> available {glyph.bullet}{' '}
          <Text color={theme.accent}>/</Text> search
        </Text>
      </Box>
      <Hint>
        ↑/↓ move {glyph.bullet} ←/→ or tab screens {glyph.bullet} esc back to workspace
      </Hint>
    </PanelScreen>
  );
}
