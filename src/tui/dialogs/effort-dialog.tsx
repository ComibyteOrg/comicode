import React, { useMemo, useState } from 'react';
import type { AppContext } from '../../core/app.js';
import { Selector, type SelectorItem } from './selector.js';

const EFFORTS = ['low', 'medium', 'default', 'high', 'xhigh'] as const;

const DESCRIPTIONS: Record<string, string> = {
  low: 'Fewest tokens — tight context, few steps, small tool output',
  medium: 'Lean — smaller context budget and fewer agent steps',
  default: 'Balanced — uses the global agent settings',
  high: 'Deeper — larger context, more steps, bigger tool outputs',
  xhigh: 'Maximum depth — largest context and step budget',
};

interface EffortDialogProps {
  context: AppContext;
  onClose: () => void;
  notify: (message: string) => void;
  refreshData: () => void;
}

/** Popup for choosing the reasoning-effort profile of the active provider profile. */
export function EffortDialog({
  context,
  onClose,
  notify,
  refreshData,
}: EffortDialogProps): React.ReactElement {
  const [query, setQuery] = useState('');
  const profileId = context.store.getSelectedProfileId();
  const profile = profileId ? context.store.getProfile(profileId) : null;
  const current =
    typeof profile?.config?.effort === 'string' ? profile.config.effort : 'default';

  const items = useMemo<SelectorItem[]>(
    () =>
      EFFORTS.map((effort) => ({
        key: effort,
        label: effort,
        detail: DESCRIPTIONS[effort],
        badge: effort === current ? 'current' : undefined,
        badgeColor: undefined,
      })),
    [current],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter(
      (item) =>
        item.label.toLowerCase().includes(needle) ||
        (item.detail ?? '').toLowerCase().includes(needle),
    );
  }, [items, query]);

  const [selected, setSelected] = useState(() =>
    Math.max(
      0,
      items.findIndex((item) => item.key === current),
    ),
  );

  const apply = (effort: string): void => {
    if (!profile) {
      notify('No provider profile selected — connect a provider first.');
      onClose();
      return;
    }
    context.store.updateProfile(profile.id, {
      config: { ...profile.config, effort },
    });
    notify(`Effort set to ${effort} for ${profile.name}.`);
    refreshData();
    onClose();
  };

  return (
    <Selector
      title="REASONING EFFORT"
      subtitle={profile ? `profile: ${profile.name}` : 'no profile selected'}
      items={filtered}
      query={query}
      onQueryChange={setQuery}
      selected={Math.min(selected, Math.max(0, filtered.length - 1))}
      onSelectedChange={setSelected}
      onSelect={(item) => apply(item.key)}
      onClose={onClose}
      searchPlaceholder="Filter effort…"
      emptyText="No matching effort level."
      footer={['↑/↓ choose', 'enter apply', 'esc close']}
    />
  );
}
