import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { AppContext } from '../../core/app.js';
import type { AppSettings } from '../../core/settings.js';
import { DEFAULT_SETTINGS, parseSettings, SETTING_PATHS } from '../../core/settings.js';
import { resolveProfile } from '../../cli/shared.js';
import { Hint, PanelScreen, PromptInput, isEnter, useLayout } from '../components.js';
import { glyph, theme } from '../theme.js';

function getPath(settings: AppSettings, path: string): unknown {
  return path.split('.').reduce<unknown>((current, key) => {
    if (current && typeof current === 'object') return (current as Record<string, unknown>)[key];
    return undefined;
  }, settings);
}

function setPath(settings: AppSettings, path: string, value: unknown): void {
  const parts = path.split('.');
  let current = settings as unknown as Record<string, unknown>;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const key = parts[index]!;
    const next = current[key];
    if (!next || typeof next !== 'object') current[key] = {};
    current = current[key] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]!] = value;
}

type ValueType = 'boolean' | 'number' | 'array' | 'nullable-string' | 'string' | 'profile' | 'enum';

function valueType(path: string): ValueType {
  if (path === 'theme' || path === 'accent') return 'enum';
  if (path.endsWith('ProfileId')) return 'profile';
  if (
    path === 'agent.testCommand' ||
    path === 'agent.lintCommand' ||
    path === 'agent.buildCommand'
  ) {
    return 'nullable-string';
  }
  const value = getPath(DEFAULT_SETTINGS, path);
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'string') return 'string';
  if (Array.isArray(value)) return 'array';
  return 'nullable-string';
}

function displayValue(context: AppContext, path: string, value: unknown): string {
  if (value === null || value === undefined) return '(none)';
  if (typeof value === 'boolean') return value ? 'on' : 'off';
  if (Array.isArray(value)) return value.length ? value.join(', ') : '(empty)';
  if (path.endsWith('ProfileId') && typeof value === 'string') {
    return context.store.getProfile(value)?.name ?? value;
  }
  return String(value);
}

function parseEdited(context: AppContext, path: string, raw: string): unknown {
  const type = valueType(path);
  const trimmed = raw.trim();
  if (type === 'number') {
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) throw new Error('Enter a number.');
    return parsed;
  }
  if (type === 'array') {
    return trimmed
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  if (type === 'nullable-string') return trimmed ? trimmed : null;
  if (type === 'profile') {
    if (!trimmed) return null;
    return resolveProfile(context.store, trimmed).id;
  }
  return raw;
}

const ENUMS: Record<string, string[]> = {
  theme: ['dark', 'dark-dim'],
  accent: ['cyan', 'blue', 'green', 'magenta', 'orange'],
};

const TYPE_LABEL: Record<ValueType, string> = {
  boolean: 'toggle',
  number: 'number',
  array: 'list',
  'nullable-string': 'text',
  string: 'text',
  profile: 'profile',
  enum: 'cycle',
};

interface SettingsProps {
  context: AppContext;
  active: boolean;
  notify: (message: string) => void;
  refreshData: () => void;
  onCycleScreen: (direction: 1 | -1) => void;
  onBack: () => void;
}

export function SettingsScreen({
  context,
  active,
  notify,
  refreshData,
  onCycleScreen,
  onBack,
}: SettingsProps): React.ReactElement {
  const { rows, columns } = useLayout();
  const [selected, setSelected] = useState(0);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const settings = context.store.getSettings();
  const paths = SETTING_PATHS as readonly string[];
  const path = paths[Math.min(selected, paths.length - 1)]!;
  const value = getPath(settings, path);

  const save = (nextPath: string, nextValue: unknown): void => {
    setError(null);
    try {
      const candidate = JSON.parse(JSON.stringify(settings)) as AppSettings;
      setPath(candidate, nextPath, nextValue);
      const validated = parseSettings(candidate);
      context.store.saveSettings(validated);
      notify(`${nextPath} updated.`);
      refreshData();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    }
  };

  const beginEdit = (): void => {
    const type = valueType(path);
    if (type === 'boolean') {
      save(path, !(value === true));
      return;
    }
    if (type === 'enum') {
      const options = ENUMS[path] ?? [];
      const index = options.indexOf(String(value));
      save(path, options[(index + 1) % options.length] ?? options[0]);
      return;
    }
    setEditing(true);
    setEditValue(
      value === null || value === undefined
        ? ''
        : Array.isArray(value)
          ? value.join(', ')
          : path.endsWith('ProfileId')
            ? (context.store.getProfile(String(value))?.name ?? String(value))
            : String(value),
    );
  };

  useInput(
    (input, key) => {
      if (editing) {
        if (key.escape) setEditing(false);
        return;
      }
      if (confirmReset) {
        if (input === 'y' || input === 'Y') {
          context.store.saveSettings(DEFAULT_SETTINGS);
          setConfirmReset(false);
          notify('Settings reset to defaults.');
          refreshData();
        } else if (input === 'n' || input === 'N') {
          setConfirmReset(false);
        }
        return;
      }
      if (key.escape) {
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
        setSelected((current) => (paths.length === 0 ? 0 : (current - 1 + paths.length) % paths.length));
      } else if (key.downArrow || input === 'j') {
        setSelected((current) => (paths.length === 0 ? 0 : (current + 1) % paths.length));
      } else if (isEnter(input, key)) beginEdit();
      else if (input === 'r') setConfirmReset(true);
    },
    { isActive: active },
  );

  const submitEdit = (raw: string): void => {
    try {
      const parsed = parseEdited(context, path, raw);
      save(path, parsed);
      setEditing(false);
    } catch (editError) {
      setError(editError instanceof Error ? editError.message : String(editError));
    }
  };

  const windowSize = Math.max(6, rows - 18);
  const start = Math.max(
    0,
    Math.min(selected - Math.floor(windowSize / 2), paths.length - windowSize),
  );
  const valueWidth = Math.max(20, columns - 50);

  return (
    <PanelScreen title="Settings" subtitle={`${paths.length} keys ${glyph.bullet} telemetry off`}>
      {error ? <Text color={theme.danger}>{error}</Text> : null}
      <Box flexDirection="column" marginTop={1} overflow="hidden">
        {paths.slice(start, start + windowSize).map((entryPath, offset) => {
          const index = start + offset;
          const entryValue = getPath(settings, entryPath);
          const activeRow = index === selected;
          return (
            <Box key={entryPath}>
              <Text
                color={activeRow ? theme.black : theme.muted}
                backgroundColor={activeRow ? theme.accent : undefined}
                bold={activeRow}
              >
                {activeRow ? ` ${glyph.active} ` : '   '}
                {entryPath.slice(0, 36).padEnd(37)}
                {displayValue(context, entryPath, entryValue)
                  .slice(0, valueWidth)
                  .padEnd(valueWidth)}
              </Text>
              <Text color={activeRow ? theme.black : theme.faint}>
                {' '}
                {TYPE_LABEL[valueType(entryPath)]}
              </Text>
            </Box>
          );
        })}
      </Box>

      {editing ? (
        <Box flexDirection="column" marginTop={1} flexShrink={0}>
          <Text color={theme.muted}>New value for {path}</Text>
          <PromptInput
            value={editValue}
            onChange={setEditValue}
            onSubmit={submitEdit}
            focus={active && editing}
            placeholder={valueType(path) === 'array' ? 'comma,separated,values' : 'value'}
          />
          <Hint>Enter saves after validation {glyph.bullet} esc cancels</Hint>
        </Box>
      ) : confirmReset ? (
        <Text color={theme.warning}>
          Reset every setting to defaults? Task history is preserved. <Text bold>y</Text> reset{' '}
          {glyph.bullet} <Text bold>n</Text> cancel
        </Text>
      ) : (
        <Box marginTop={1} flexShrink={0}>
          <Text color={theme.muted} wrap="truncate">
            <Text color={theme.accent}>enter</Text>{' '}
            {valueType(path) === 'boolean'
              ? 'toggle'
              : valueType(path) === 'enum'
                ? 'cycle'
                : 'edit'}{' '}
            {glyph.bullet} <Text color={theme.accent}>r</Text> reset defaults
          </Text>
        </Box>
      )}
      <Hint>
        ↑/↓ move {glyph.bullet} ←/→ or tab screens {glyph.bullet} esc back. Profile fields accept a
        name.
      </Hint>
    </PanelScreen>
  );
}
