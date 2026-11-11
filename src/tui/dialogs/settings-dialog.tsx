import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { AppContext } from '../../core/app.js';
import type { AppSettings } from '../../core/settings.js';
import { glyph, THEME_LABELS, THEME_NAMES, theme } from '../theme.js';
import { useLayout } from '../components.js';
import { ModalWindow } from './modal.js';

interface SettingsDialogProps {
  context: AppContext;
  onClose: () => void;
  notify: (message: string) => void;
  refreshData: () => void;
}

interface SettingItem {
  id: string;
  label: string;
  description: string;
  value: string;
  type: 'toggle' | 'cycle' | 'number';
  onNext: () => void;
  onPrev: () => void;
}

const ACCENTS = ['cyan', 'blue', 'green', 'magenta', 'orange'] as const;
const PERMISSION_MODES = ['ask', 'trusted', 'auto'] as const;
const PERMISSION_LABELS: Record<string, string> = {
  ask: 'ASK EVERY TIME',
  trusted: 'TRUSTED (no prompts for edits/commands)',
  auto: 'AUTO (never ask)',
};

function toggleLabel(value: boolean, onText: string, offText: string): string {
  return value ? `ON (${onText})` : `OFF (${offText})`;
}

export function SettingsDialog({
  context,
  onClose,
  notify,
  refreshData,
}: SettingsDialogProps): React.ReactElement {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const settings = context.store.getSettings();

  const update = (mutate: (s: AppSettings) => void): void => {
    context.store.updateSettings((s) => {
      mutate(s);
      return s;
    });
    refreshData();
  };

  const cycleTheme = (direction: 1 | -1): void => {
    const index = Math.max(0, THEME_NAMES.indexOf(settings.ui.theme));
    const next = THEME_NAMES[(index + direction + THEME_NAMES.length) % THEME_NAMES.length]!;
    update((s) => {
      s.ui.theme = next;
    });
    notify(`Theme set to ${THEME_LABELS[next] ?? next}.`);
  };

  const cycleAccent = (direction: 1 | -1): void => {
    const index = ACCENTS.indexOf(settings.accent);
    const next = ACCENTS[(index + direction + ACCENTS.length) % ACCENTS.length]!;
    update((s) => {
      s.accent = next;
    });
    notify(`Accent color set to ${next}.`);
  };

  const stepNumber = (
    current: number,
    min: number,
    max: number,
    step: number,
    apply: (value: number) => void,
  ): void => {
    apply(Math.min(max, Math.max(min, current + step)));
    refreshData();
  };

  const items: SettingItem[] = [
    {
      id: 'allowPaid',
      label: 'Paid model fallbacks',
      description: 'Allow routing to fall back to paid models when free models are exhausted',
      value: toggleLabel(settings.routing.allowPaid, 'Allowed', 'Free-only'),
      type: 'toggle',
      onNext: () =>
        update((s) => {
          s.routing.allowPaid = !s.routing.allowPaid;
        }),
      onPrev: () =>
        update((s) => {
          s.routing.allowPaid = !s.routing.allowPaid;
        }),
    },
    {
      id: 'preferFree',
      label: 'Prefer free models',
      description: 'Bias routing toward models classified as free or free-tier',
      value: toggleLabel(settings.routing.preferFree, 'Preferred', 'Off'),
      type: 'toggle',
      onNext: () =>
        update((s) => {
          s.routing.preferFree = !s.routing.preferFree;
        }),
      onPrev: () =>
        update((s) => {
          s.routing.preferFree = !s.routing.preferFree;
        }),
    },
    {
      id: 'allowUnknownAccess',
      label: 'Allow unknown-access models',
      description: 'Allow fallback to models whose pricing/access could not be determined',
      value: toggleLabel(settings.routing.allowUnknownAccess, 'Allowed', 'Blocked'),
      type: 'toggle',
      onNext: () =>
        update((s) => {
          s.routing.allowUnknownAccess = !s.routing.allowUnknownAccess;
        }),
      onPrev: () =>
        update((s) => {
          s.routing.allowUnknownAccess = !s.routing.allowUnknownAccess;
        }),
    },
    {
      id: 'maxFallbacks',
      label: 'Maximum fallback candidates',
      description: 'How many alternative profiles/models routing may try per pass',
      value: `${settings.routing.maxFallbacks} candidates`,
      type: 'number',
      onNext: () =>
        stepNumber(settings.routing.maxFallbacks, 1, 20, 1, (value) => {
          update((s) => {
            s.routing.maxFallbacks = value;
          });
        }),
      onPrev: () =>
        stepNumber(settings.routing.maxFallbacks, 1, 20, -1, (value) => {
          update((s) => {
            s.routing.maxFallbacks = value;
          });
        }),
    },
    {
      id: 'maxRetriesPerCandidate',
      label: 'Retries per candidate',
      description: 'Retry attempts against a single model before moving to the next fallback',
      value: `${settings.routing.maxRetriesPerCandidate} retries`,
      type: 'number',
      onNext: () =>
        stepNumber(settings.routing.maxRetriesPerCandidate, 0, 5, 1, (value) => {
          update((s) => {
            s.routing.maxRetriesPerCandidate = value;
          });
        }),
      onPrev: () =>
        stepNumber(settings.routing.maxRetriesPerCandidate, 0, 5, -1, (value) => {
          update((s) => {
            s.routing.maxRetriesPerCandidate = value;
          });
        }),
    },
    {
      id: 'maxSteps',
      label: 'Max agent steps per run',
      description: 'Upper bound on iterations per coding task turn',
      value: `${settings.agent.maxSteps} steps`,
      type: 'number',
      onNext: () =>
        stepNumber(settings.agent.maxSteps, 1, 200, 10, (value) => {
          update((s) => {
            s.agent.maxSteps = value;
          });
        }),
      onPrev: () =>
        stepNumber(settings.agent.maxSteps, 1, 200, -10, (value) => {
          update((s) => {
            s.agent.maxSteps = value;
          });
        }),
    },
    {
      id: 'autoApproveReadOnly',
      label: 'Auto-approve read-only tools',
      description: 'Run inspection commands (ls, grep, git status) without asking',
      value: toggleLabel(settings.agent.autoApproveReadOnly, 'Auto', 'Ask'),
      type: 'toggle',
      onNext: () =>
        update((s) => {
          s.agent.autoApproveReadOnly = !s.agent.autoApproveReadOnly;
        }),
      onPrev: () =>
        update((s) => {
          s.agent.autoApproveReadOnly = !s.agent.autoApproveReadOnly;
        }),
    },
    {
      id: 'autoApproveFileEdits',
      label: 'Auto-approve file edits',
      description: 'Write and patch files without an approval prompt',
      value: toggleLabel(settings.agent.autoApproveFileEdits, 'Auto', 'Ask'),
      type: 'toggle',
      onNext: () =>
        update((s) => {
          s.agent.autoApproveFileEdits = !s.agent.autoApproveFileEdits;
        }),
      onPrev: () =>
        update((s) => {
          s.agent.autoApproveFileEdits = !s.agent.autoApproveFileEdits;
        }),
    },
    {
      id: 'autoApproveCommands',
      label: 'Auto-approve shell commands',
      description: 'Run non-read-only commands without an approval prompt',
      value: toggleLabel(settings.agent.autoApproveCommands, 'Auto', 'Ask'),
      type: 'toggle',
      onNext: () =>
        update((s) => {
          s.agent.autoApproveCommands = !s.agent.autoApproveCommands;
        }),
      onPrev: () =>
        update((s) => {
          s.agent.autoApproveCommands = !s.agent.autoApproveCommands;
        }),
    },
    {
      id: 'permissionMode',
      label: 'Permission mode',
      description:
        'ask = prompt each time · trusted = auto-approve edits and normal commands · auto = never prompt',
      value: PERMISSION_LABELS[settings.agent.permissionMode] ?? settings.agent.permissionMode,
      type: 'cycle',
      onNext: () =>
        update((s) => {
          const index = PERMISSION_MODES.indexOf(s.agent.permissionMode);
          s.agent.permissionMode = PERMISSION_MODES[(index + 1) % PERMISSION_MODES.length]!;
        }),
      onPrev: () =>
        update((s) => {
          const index = PERMISSION_MODES.indexOf(s.agent.permissionMode);
          s.agent.permissionMode =
            PERMISSION_MODES[(index - 1 + PERMISSION_MODES.length) % PERMISSION_MODES.length]!;
        }),
    },
    {
      id: 'theme',
      label: 'UI theme',
      description: 'Color palette — dark and light themes included',
      value: THEME_LABELS[settings.ui.theme] ?? settings.ui.theme,
      type: 'cycle',
      onNext: () => cycleTheme(1),
      onPrev: () => cycleTheme(-1),
    },
    {
      id: 'accent',
      label: 'Accent color',
      description: 'Highlight color for selected items, indicators, and borders',
      value: settings.accent,
      type: 'cycle',
      onNext: () => cycleAccent(1),
      onPrev: () => cycleAccent(-1),
    },
  ];

  useInput((input, key) => {
    if (key.escape) {
      onClose();
      return;
    }
    if (key.upArrow) {
      setSelectedIndex((cur) => (cur - 1 + items.length) % items.length);
      return;
    }
    if (key.downArrow) {
      setSelectedIndex((cur) => (cur + 1) % items.length);
      return;
    }
    if (key.leftArrow) {
      items[selectedIndex]?.onPrev();
      return;
    }
    if (key.rightArrow || key.return || input === ' ') {
      items[selectedIndex]?.onNext();
      return;
    }
  });

  const { rows } = useLayout();
  const ITEM_HEIGHT = 3;
  const modalHeight = Math.min(rows - 4, items.length * ITEM_HEIGHT + 8);
  const visibleCount = Math.max(1, Math.floor((modalHeight - 7) / ITEM_HEIGHT));
  const scrollStart = Math.min(
    Math.max(0, selectedIndex - Math.floor(visibleCount / 2)),
    Math.max(0, items.length - visibleCount),
  );
  const visibleItems = items.slice(scrollStart, scrollStart + visibleCount);

  return (
    <ModalWindow
      title="COMICODE SETTINGS"
      subtitle={`${items.length} options · ↑/↓ scroll`}
      width={72}
      height={modalHeight}
      footer={['↑/↓ select setting', '←/→ or enter change', 'esc close']}
    >
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {scrollStart > 0 ? <Text color={theme.faint}>  ⋮</Text> : null}
        {visibleItems.map((item, offset) => {
          const index = scrollStart + offset;
          const isSelected = index === selectedIndex;
          return (
            <Box
              key={item.id}
              flexDirection="column"
              marginBottom={1}
              paddingX={1}
              borderStyle={isSelected ? 'single' : undefined}
              borderColor={isSelected ? theme.accent : undefined}
            >
              <Box justifyContent="space-between">
                <Text bold={isSelected} color={isSelected ? theme.accent : theme.text}>
                  {isSelected ? `${glyph.active} ` : '  '}
                  {item.label}
                </Text>
                <Text
                  bold
                  color={
                    item.value.startsWith('ON') || item.value.startsWith('YES')
                      ? theme.success
                      : item.value.startsWith('OFF') || item.value.startsWith('NO')
                        ? theme.warning
                        : theme.accent
                  }
                >
                  {item.value} {isSelected ? '◀▶' : ''}
                </Text>
              </Box>
              <Box paddingLeft={2}>
                <Text color={theme.faint} wrap="truncate">
                  {item.description}
                </Text>
              </Box>
            </Box>
          );
        })}
        {scrollStart + visibleCount < items.length ? (
          <Text color={theme.faint}>  ⋮</Text>
        ) : null}
      </Box>
    </ModalWindow>
  );
}
