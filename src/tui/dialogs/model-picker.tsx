import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Text } from 'ink';
import type { AppContext } from '../../core/app.js';
import type { ModelInfo, ProviderKind, ProviderProfile } from '../../core/types.js';
import {
  ACCESS_LABELS,
  effectiveAccess,
  isFreeAccess,
  isPaidAccess,
  owningProfileForModel,
} from '../../core/providers/catalog.js';
import { providerDisplayName } from '../../core/providers/definitions.js';
import { addManualModel, refreshProfileModels } from '../../core/providers/service.js';
import { PromptInput, formatCount } from '../components.js';
import { glyph, theme } from '../theme.js';
import { Selector, filterByQuery, type SelectorItem } from './selector.js';
import { ModalWindow } from './modal.js';

interface ModelPickerProps {
  context: AppContext;
  onClose: () => void;
  onSelected?: (model: ModelInfo, profile: ProviderProfile | null) => void;
  notify: (message: string) => void;
  refreshData: () => void;
  initialQuery?: string;
}

function accessColor(access: string): string {
  if (access === 'free-confirmed' || access === 'user-free') return theme.success;
  if (access === 'free-tier') return theme.accent;
  if (access === 'paid' || access === 'user-paid') return theme.warning;
  if (access === 'unavailable') return theme.danger;
  return theme.muted;
}

function contextLabel(model: ModelInfo): string {
  return model.contextWindow ? `${formatCount(model.contextWindow)} ctx` : 'ctx unknown';
}

export function ModelPicker({
  context,
  onClose,
  onSelected,
  notify,
  refreshData,
  initialQuery = '',
}: ModelPickerProps): React.ReactElement {
  const [query, setQuery] = useState(initialQuery);
  const [selected, setSelected] = useState(0);
  const [freeOnly, setFreeOnly] = useState(false);
  const [toolsOnly, setToolsOnly] = useState(false);
  const [availableOnly, setAvailableOnly] = useState(true);
  const [providerFilter, setProviderFilter] = useState<ProviderKind | null>(null);
  const [manualMode, setManualMode] = useState(false);
  const [manualValue, setManualValue] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  const profiles = context.store.listProfiles();
  const allowPaid = context.store.getSettings().routing.allowPaid;
  const providers = useMemo(
    () => [...new Set(profiles.map((profile) => profile.providerId))],
    [profiles],
  );
  const currentSelectedKey = context.store.getSelectedModelId();

  const models = useMemo(() => {
    let entries = context.store
      .listModels()
      .filter((model) => profiles.some((profile) => profile.providerId === model.providerId));
    if (providerFilter) entries = entries.filter((model) => model.providerId === providerFilter);
    if (availableOnly) entries = entries.filter((model) => model.available);
    if (toolsOnly) entries = entries.filter((model) => model.supportsTools);
    if (freeOnly) {
      entries = entries.filter((model) =>
        isFreeAccess(
          effectiveAccess(
            model,
            owningProfileForModel(profiles, model)?.accessClassification ?? null,
          ),
        ),
      );
    }
    const accessOf = (model: ModelInfo) =>
      effectiveAccess(model, owningProfileForModel(profiles, model)?.accessClassification ?? null);
    if (!allowPaid) entries = entries.filter((model) => !isPaidAccess(accessOf(model)));
    entries = filterByQuery(entries, query, (model) => [
      model.modelId,
      model.displayName,
      providerDisplayName(model.providerId),
      owningProfileForModel(profiles, model)?.name ?? '',
      ACCESS_LABELS[
        effectiveAccess(model, owningProfileForModel(profiles, model)?.accessClassification ?? null)
      ],
    ]);
    const accessRank = (model: ModelInfo): number => {
      const access = accessOf(model);
      if (isFreeAccess(access)) return 0;
      if (access === 'unknown') return 1;
      return 2;
    };
    // Keep provider headings contiguous. Within a provider, free models appear
    // first, then the most capable models, so the picker reads as grouped
    // provider sections rather than an interleaved global ranking.
    const groupOf = (model: ModelInfo): string => {
      const owner = owningProfileForModel(profiles, model);
      return model.providerId === 'custom' && owner
        ? owner.name
        : providerDisplayName(model.providerId);
    };
    return entries.sort(
      (left, right) =>
        groupOf(left).localeCompare(groupOf(right)) ||
        accessRank(left) - accessRank(right) ||
        right.codingSuitability - left.codingSuitability ||
        left.modelId.localeCompare(right.modelId),
    );
  }, [
    context,
    profiles,
    providerFilter,
    availableOnly,
    toolsOnly,
    freeOnly,
    allowPaid,
    query,
    version,
  ]);

  useEffect(() => {
    setSelected((value) => Math.min(value, Math.max(0, models.length - 1)));
  }, [models.length]);

  const current = models[Math.min(selected, Math.max(0, models.length - 1))] ?? null;

  const items: SelectorItem[] = useMemo(
    () =>
      models.map((model) => {
        const profile = owningProfileForModel(profiles, model);
        const access = effectiveAccess(model, profile?.accessClassification ?? null);
        const free = isFreeAccess(access);
        const isSelected = model.id === currentSelectedKey;
        const group =
          model.providerId === 'custom' && profile
            ? profile.name
            : providerDisplayName(model.providerId);
        const capabilities = [
          model.supportsTools ? 'tools' : 'no tools',
          model.supportsVision ? 'vision' : null,
          model.supportsStreaming ? 'stream' : null,
        ].filter(Boolean);
        const accessBadge =
          access === 'free-confirmed' || access === 'user-free'
            ? 'free'
            : access === 'free-tier'
              ? 'free tier'
              : isPaidAccess(access)
                ? 'paid'
                : access === 'unknown'
                  ? 'unknown'
                  : null;
        return {
          key: model.id,
          label: `${isSelected ? `${glyph.dot} ` : ''}${model.displayName || model.modelId}`,
          group,
          leadingBadge: accessBadge ?? undefined,
          leadingBadgeColor:
            accessBadge === 'free'
              ? theme.success
              : accessBadge === 'paid'
                ? theme.warning
                : accessBadge === 'free tier'
                  ? theme.accent
                  : theme.muted,
          badge: free
            ? model.available
              ? undefined
              : 'unavailable'
            : `${ACCESS_LABELS[access]}${model.available ? '' : ' · unavailable'}`,
          badgeColor: accessColor(access),
          detail: `${group} ${glyph.bullet} ${profile?.name ?? 'no profile'} ${glyph.bullet} id ${model.modelId} ${glyph.bullet} ${contextLabel(model)} ${glyph.bullet} ${capabilities.join('/')} ${glyph.bullet} ${model.available ? 'available' : 'not verified'}${isSelected ? ` ${glyph.bullet} selected` : ''}`,
          disabled: access === 'unavailable',
          disabledReason: 'This model is classified as unavailable.',
        };
      }),
    [models, profiles, currentSelectedKey],
  );

  const selectModel = useCallback(
    async (model: ModelInfo): Promise<void> => {
      const profile = owningProfileForModel(profiles, model);
      context.store.setSelectedModelId(model.id);
      if (profile) context.store.setSelectedProfileId(profile.id);
      notify(`Using ${model.modelId}${profile ? ` via ${profile.name}` : ''}.`);
      refreshData();
      onSelected?.(model, profile);
      onClose();
    },
    [context, notify, onClose, onSelected, profiles, refreshData],
  );

  const setDefault = useCallback(
    (model: ModelInfo): void => {
      const profile = owningProfileForModel(profiles, model);
      if (!profile) {
        notify('No profile owns this model.');
        return;
      }
      context.store.updateProfile(profile.id, { defaultModel: model.modelId });
      notify(`Default model for ${profile.name} is now ${model.modelId}.`);
      refreshData();
      setVersion((value) => value + 1);
    },
    [context, notify, profiles, refreshData],
  );

  const refresh = useCallback(async (): Promise<void> => {
    const enabled = profiles.filter((profile) => profile.enabled);
    if (enabled.length === 0) {
      setError('Connect or enable a provider profile first.');
      return;
    }
    setBusy('Refreshing model catalogs…');
    setError(null);
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
    setVersion((value) => value + 1);
    refreshData();
    if (failures.length) {
      setError(
        `Refreshed ${discovered} models. ${failures.length} profile(s) failed: ${failures[0]}`,
      );
    } else {
      notify(`Refreshed ${discovered} models across ${enabled.length} profile(s).`);
    }
  }, [context, notify, profiles, refreshData]);

  const saveManual = useCallback(async (): Promise<void> => {
    const value = manualValue.trim();
    if (!value) {
      setError('Enter a model id.');
      return;
    }
    const profile =
      (current ? owningProfileForModel(profiles, current) : null) ??
      profiles.find((entry) => entry.id === context.store.getSelectedProfileId()) ??
      profiles.find((entry) => entry.enabled) ??
      profiles[0];
    if (!profile) {
      setError('Connect a provider profile before adding a manual model.');
      return;
    }
    setBusy('Adding model…');
    setError(null);
    try {
      await addManualModel(context.store, profile, value);
      const added =
        context.store
          .listModels()
          .find(
            (model) =>
              model.modelId === value &&
              (profile.providerId === 'custom'
                ? model.profileId === profile.id
                : model.providerId === profile.providerId),
          ) ?? null;
      setManualMode(false);
      setManualValue('');
      setVersion((current) => current + 1);
      refreshData();
      if (added) await selectModel(added);
      else {
        notify(`Added ${value} to ${profile.name}.`);
        onClose();
      }
    } catch (manualError) {
      setError(manualError instanceof Error ? manualError.message : String(manualError));
    } finally {
      setBusy(null);
    }
  }, [context, current, manualValue, notify, onClose, profiles, refreshData, selectModel]);

  if (manualMode) {
    return (
      <ModalWindow
        title="ADD A MODEL ID MANUALLY"
        subtitle="Catalog override"
        width={68}
        height={14}
        footer={['enter add', 'esc cancel']}
      >
        <Text color={theme.muted} wrap="wrap">
          Use this when a provider's model-list endpoint is unavailable. The id is stored in the
          catalog for the selected profile.
        </Text>
        <Box marginTop={1}>
          <PromptInput
            value={manualValue}
            onChange={setManualValue}
            onSubmit={() => void saveManual()}
            focus
            placeholder="provider/model-id"
          />
        </Box>
        {error ? (
          <Text color={theme.danger} wrap="wrap">
            {error}
          </Text>
        ) : null}
        {busy ? <Text color={theme.accent}>{busy}</Text> : null}
      </ModalWindow>
    );
  }

  return (
    <Selector
      title="Select model"
      subtitle={
        busy ??
        `${providerFilter ? providerDisplayName(providerFilter) : 'all providers'}${freeOnly ? ' · free' : ''}${toolsOnly ? ' · tools' : ''}${availableOnly ? ' · available' : ''}${allowPaid ? '' : ' · paid hidden'}`
      }
      items={items}
      query={query}
      onQueryChange={(value) => {
        setQuery(value);
        setSelected(0);
      }}
      selected={selected}
      onSelectedChange={setSelected}
      onSelect={(item) => {
        const model = models.find((entry) => entry.id === item.key);
        if (model) void selectModel(model);
      }}
      onClose={onClose}
      onKey={(input, key) => {
        if (busy) return true;
        if (key.ctrl && input === 'f') {
          setFreeOnly((value) => !value);
          setSelected(0);
          return true;
        }
        if (key.ctrl && input === 't') {
          setToolsOnly((value) => !value);
          setSelected(0);
          return true;
        }
        if (key.ctrl && input === 'a') {
          setAvailableOnly((value) => !value);
          setSelected(0);
          return true;
        }
        if (key.ctrl && input === 'p') {
          const index = providerFilter ? providers.indexOf(providerFilter) : -1;
          const next = index + 1 >= providers.length ? null : (providers[index + 1] ?? null);
          setProviderFilter(next);
          setSelected(0);
          return true;
        }
        if (key.ctrl && input === 'r') {
          void refresh();
          return true;
        }
        if (key.ctrl && input === 'e') {
          setManualMode(true);
          return true;
        }
        if (key.ctrl && input === 'd') {
          if (current) setDefault(current);
          return true;
        }
        return false;
      }}
      searchPlaceholder="Search models by name, id, provider, or access…"
      emptyText={
        profiles.length === 0
          ? 'No provider profiles are connected. Run /connect first.'
          : 'No models match the current search and filters.'
      }
      footer={[
        '↑↓ navigate',
        'enter select',
        'ctrl+f free',
        'ctrl+t tools',
        'ctrl+a available',
        'ctrl+p provider',
        'ctrl+r refresh',
        'ctrl+e manual',
        'ctrl+d default',
        allowPaid ? 'paid: on (/allow-paid)' : 'paid: off (/allow-paid)',
        'esc close',
      ]}
    />
  );
}
