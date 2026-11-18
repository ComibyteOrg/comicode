import React, { useMemo, useState } from 'react';
import { AGENT_MODES, AGENT_MODE_IDS, type AgentMode } from '../../core/agent/modes.js';
import { Selector, type SelectorItem } from './selector.js';

interface ModePickerProps {
  current: AgentMode;
  onMode: (mode: AgentMode) => void;
  onClose: () => void;
  notify: (message: string) => void;
  refreshData: () => void;
}

/** Popup for switching the active agent/workflow — opened by `/mode` with no argument. */
export function ModePicker({
  current,
  onMode,
  onClose,
  notify,
  refreshData,
}: ModePickerProps): React.ReactElement {
  const [query, setQuery] = useState('');

  const items = useMemo<SelectorItem[]>(
    () =>
      AGENT_MODE_IDS.map((id) => {
        const spec = AGENT_MODES[id];
        return {
          key: id,
          label: id === 'team' ? 'team  ◈ full company' : id,
          detail: spec.description,
          badge: id === current ? 'current' : undefined,
        };
      }),
    [current],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter(
      (item) =>
        item.key.toLowerCase().includes(needle) ||
        (item.detail ?? '').toLowerCase().includes(needle),
    );
  }, [items, query]);

  const [selected, setSelected] = useState(() =>
    Math.max(0, AGENT_MODE_IDS.indexOf(current)),
  );

  const apply = (key: string): void => {
    if (!AGENT_MODE_IDS.includes(key as AgentMode)) {
      onClose();
      return;
    }
    const mode = key as AgentMode;
    onMode(mode);
    notify(
      mode === 'team'
        ? 'Team mode: the full company works the task stage by stage with handoffs.'
        : mode === 'plan'
          ? 'Plan mode: read-only — the agent proposes steps without changing files.'
          : mode === 'security'
            ? 'Security mode: read-only audit with severity-ranked findings.'
            : `${AGENT_MODES[mode].label} mode: ${AGENT_MODES[mode].description}`,
    );
    refreshData();
    onClose();
  };

  return (
    <Selector
      title="AGENT / WORKFLOW"
      subtitle="choose who works on this task"
      items={filtered}
      query={query}
      onQueryChange={setQuery}
      selected={Math.min(selected, Math.max(0, filtered.length - 1))}
      onSelectedChange={setSelected}
      onSelect={(item) => apply(item.key)}
      onClose={onClose}
      searchPlaceholder="Filter agents…"
      emptyText="No matching agent."
      footer={['↑/↓ choose', 'enter select', 'esc close']}
    />
  );
}
