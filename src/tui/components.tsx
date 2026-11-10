import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useInput, useWindowSize, type Key } from 'ink';
import type { ConfirmationRequest } from '../core/agent/types.js';
import { glyph, theme } from './theme.js';

export type ScreenId = 'workspace' | 'providers' | 'models' | 'history' | 'usage' | 'settings';

export const SCREENS: Array<{ id: ScreenId; label: string; short: string }> = [
  { id: 'workspace', label: 'workspace', short: 'work' },
  { id: 'providers', label: 'providers', short: 'prov' },
  { id: 'models', label: 'models', short: 'model' },
  { id: 'history', label: 'history', short: 'hist' },
  { id: 'usage', label: 'usage', short: 'usage' },
  { id: 'settings', label: 'settings', short: 'config' },
];

export type AgentStatus = 'idle' | 'running' | 'paused' | 'completed' | 'failed';

const STATUS: Record<AgentStatus, { color: string; label: string }> = {
  idle: { color: theme.faint, label: 'idle' },
  running: { color: theme.accent, label: 'running' },
  paused: { color: theme.warning, label: 'paused' },
  completed: { color: theme.success, label: 'completed' },
  failed: { color: theme.danger, label: 'failed' },
};

export function isEnter(input: string, key: Pick<Key, 'return'>): boolean {
  // Terminals differ: xterm/Windows Terminal send \r, some shells and
  // multiplexers send \n. Ink exposes \r as key.return but leaves \n as a
  // printable-looking input, which is exactly what used to create new lines
  // inside the composer. Treat both as submit.
  return key.return || input === '\n' || input === '\r';
}

export function useLayout(): {
  columns: number;
  rows: number;
  compact: boolean;
  contentWidth: number;
} {
  const size = useWindowSize();
  const columns = Math.max(40, size.columns || 80);
  const rows = Math.max(12, size.rows || 30);
  return {
    columns,
    rows,
    compact: columns < 92,
    contentWidth: Math.max(30, columns - 2),
  };
}

export function Divider({ width }: { width: number }): React.ReactElement {
  return <Text color={theme.border}>{glyph.rule.repeat(Math.max(1, width))}</Text>;
}

export function StatusPill({ status }: { status: AgentStatus }): React.ReactElement {
  const value = STATUS[status];
  const dot = status === 'running' ? glyph.dot : status === 'completed' ? glyph.check : glyph.ring;
  return (
    <Text color={value.color}>
      {dot} {value.label}
    </Text>
  );
}

export function Chip({
  children,
  color = theme.muted,
}: {
  children: React.ReactNode;
  color?: string;
}): React.ReactElement {
  return (
    <Text color={theme.borderStrong}>
      <Text color={color}>{children}</Text>
    </Text>
  );
}

export function Header({
  screen,
  version,
  cwd,
  profileName,
  modelName,
  status,
  allowPaid,
  taskId,
  columns,
}: {
  screen: ScreenId;
  version: string;
  cwd: string;
  profileName: string | null;
  modelName: string | null;
  status: AgentStatus;
  allowPaid: boolean;
  taskId: string | null;
  columns: number;
}): React.ReactElement {
  const compact = columns < 92;
  return (
    <Box flexDirection="column" flexShrink={0} paddingX={1}>
      <Box justifyContent="space-between">
        <Text wrap="truncate">
          <Text bold color={theme.accent}>
            {glyph.brand}
          </Text>
          <Text bold color={theme.text}>
            {' '}
            comicode
          </Text>
          <Text color={theme.faint}> v{version}</Text>
        </Text>
        <Box columnGap={2}>
          {allowPaid ? <Text color={theme.warning}>paid fallback on</Text> : null}
          <StatusPill status={status} />
        </Box>
      </Box>

      <Box marginTop={1} columnGap={1} width="100%">
        {SCREENS.map((entry, index) => {
          const active = entry.id === screen;
          return (
            <Text
              key={entry.id}
              color={active ? theme.black : theme.muted}
              backgroundColor={active ? theme.accent : undefined}
              bold={active}
            >
              {` ${index + 1} ${compact ? entry.short : entry.label} `}
            </Text>
          );
        })}
        <Box flexGrow={1} />
        {!compact ? <Text color={theme.faint}>ctrl+k palette</Text> : null}
      </Box>

      <Box justifyContent="space-between" marginTop={1}>
        <Text color={theme.muted} wrap="truncate-middle">
          {cwd}
        </Text>
        <Text wrap="truncate">
          <Text color={theme.faint}>profile </Text>
          <Text color={profileName ? theme.text : theme.warning}>
            {profileName ?? 'none selected'}
          </Text>
          <Text color={theme.faint}> {glyph.bullet} </Text>
          <Text color={modelName ? theme.accent : theme.warning}>{modelName ?? 'no model'}</Text>
          {taskId ? (
            <Text color={theme.faint}>
              {' '}
              {glyph.bullet} task {taskId.slice(0, 8)}
            </Text>
          ) : null}
        </Text>
      </Box>
      <Box>
        <Divider width={Math.max(1, columns - 2)} />
      </Box>
    </Box>
  );
}

export function Footer({
  hints,
  toast,
  width,
}: {
  hints: string[];
  toast: string | null;
  width: number;
}): React.ReactElement {
  const failed = toast ? /fail|error|cannot|not |missing|blocked/i.test(toast) : false;
  return (
    <Box flexDirection="column" flexShrink={0} paddingX={1}>
      <Divider width={Math.max(1, width - 2)} />
      <Box justifyContent="space-between">
        <Text color={toast ? (failed ? theme.danger : theme.success) : theme.faint} wrap="truncate">
          {toast ?? hints.join(`  ${glyph.bullet}  `)}
        </Text>
      </Box>
    </Box>
  );
}

export function PanelScreen({
  title,
  subtitle,
  children,
  accent = theme.accent,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  accent?: string;
}): React.ReactElement {
  return (
    <Box
      flexDirection="column"
      height="100%"
      borderStyle="round"
      borderColor={theme.border}
      paddingX={1}
      overflow="hidden"
    >
      <Box justifyContent="space-between" flexShrink={0}>
        <Text bold color={theme.text}>
          <Text color={accent}>{glyph.brand} </Text>
          {title}
        </Text>
        {subtitle ? <Text color={theme.muted}>{subtitle}</Text> : null}
      </Box>
      <Box flexDirection="column" flexGrow={1} overflow="hidden" marginTop={1}>
        {children}
      </Box>
    </Box>
  );
}

export const Panel = PanelScreen;

export function Hint({ children }: { children: React.ReactNode }): React.ReactElement {
  return <Text color={theme.faint}>{children}</Text>;
}

export function Empty({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <Box paddingY={1} paddingLeft={1}>
      <Text color={theme.muted} wrap="wrap">
        {children}
      </Text>
    </Box>
  );
}

export function KeyValue({
  rows,
  width = 22,
}: {
  rows: Array<[string, React.ReactNode]>;
  width?: number;
}): React.ReactElement {
  return (
    <Box flexDirection="column">
      {rows.map(([key, value]) => (
        <Box key={key}>
          <Box width={width}>
            <Text color={theme.faint}>{key}</Text>
          </Box>
          <Box flexGrow={1}>
            <Text wrap="truncate-end">{value}</Text>
          </Box>
        </Box>
      ))}
    </Box>
  );
}

export function ConfirmDialog({
  request,
  onDecision,
}: {
  request: ConfirmationRequest;
  onDecision: (approved: boolean) => void;
}): React.ReactElement {
  useInput((input, key) => {
    if (input === 'y' || input === 'Y') onDecision(true);
    else if (input === 'n' || input === 'N' || key.escape) onDecision(false);
  });

  const diffLines = request.diff ? request.diff.split(/\r?\n/).slice(0, 12) : [];

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.warning}
      paddingX={1}
      flexShrink={0}
      overflow="hidden"
    >
      <Box justifyContent="space-between">
        <Text bold color={theme.warning}>
          Approval needed
        </Text>
        <Text color={theme.faint}>y approve {glyph.bullet} n reject</Text>
      </Box>
      <Text bold color={theme.text}>
        {request.title}
      </Text>
      <Text color={theme.muted} wrap="wrap">
        {request.description}
      </Text>
      {request.path ? (
        <Text color={theme.faint} wrap="truncate-middle">
          path {request.path}
        </Text>
      ) : null}
      {request.command ? <Text color={theme.warning}>$ {request.command}</Text> : null}
      {request.reasons?.map((reason) => (
        <Text key={reason} color={theme.danger}>
          risk {glyph.bullet} {reason}
        </Text>
      ))}
      {diffLines.length ? (
        <Box flexDirection="column" marginTop={1}>
          {diffLines.map((line, index) => (
            <Text
              key={`${index}-${line.slice(0, 10)}`}
              color={
                line.startsWith('+')
                  ? theme.success
                  : line.startsWith('-')
                    ? theme.danger
                    : theme.muted
              }
            >
              {line || ' '}
            </Text>
          ))}
          {request.diff && request.diff.split(/\r?\n/).length > diffLines.length ? (
            <Text color={theme.faint}>
              {glyph.bullet} {request.diff.split(/\r?\n/).length - diffLines.length} more lines
            </Text>
          ) : null}
        </Box>
      ) : null}
    </Box>
  );
}

export function Toast({ message }: { message: string }): React.ReactElement {
  return (
    <Text color={/fail|error|cannot|not /i.test(message) ? theme.danger : theme.success}>
      {message}
    </Text>
  );
}

export function Spinner({ frame, label }: { frame: number; label: string }): React.ReactElement {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  return (
    <Text>
      <Text color={theme.accent}>{frames[frame % frames.length]}</Text>
      <Text color={theme.text}> {label}</Text>
    </Text>
  );
}

export function formatCount(value: number): string {
  if (!Number.isFinite(value)) return '0';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

export function clip(text: string, max = 120): string {
  const single = text.replace(/\s+/g, ' ').trim();
  return single.length > max ? `${single.slice(0, max - 1)}…` : single;
}

export function clipLines(text: string, maxLines = 4, maxChars = 900): string {
  const clipped = text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
  const lines = clipped.split(/\r?\n/);
  if (lines.length <= maxLines) return clipped;
  return `${lines.slice(0, maxLines).join('\n')}\n… ${lines.length - maxLines} more lines`;
}

export interface PromptSuggestion {
  value: string;
  label: string;
  detail?: string;
  /** Enter executes the value immediately instead of completing it. */
  submit?: boolean;
}

export interface PromptInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  focus?: boolean;
  placeholder?: string;
  mask?: string;
  suggestions?: PromptSuggestion[];
  history?: string[];
  onCycleScreen?: (direction: 1 | -1) => void;
  prompt?: React.ReactNode;
  promptColor?: string;
  maxSuggestions?: number;
}

function normalizeInsertion(input: string): string {
  const flattened = input.replace(/\r\n?/g, ' ').replace(/\n/g, ' ');
  return Array.from(flattened)
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code >= 0x20 && code !== 0x7f;
    })
    .join('');
}

/**
 * Controlled single-line prompt with a real cursor, command history, slash
 * suggestions, and explicit screen-switch keys.
 *
 * We intentionally do not use ink-text-input: on terminals that send `\n` for
 * Enter it treats the newline as printable text, which is the reported "typing
 * creates new lines" bug. This component treats any newline as submit and
 * strips line breaks out of pasted content.
 */
export function PromptInput({
  value,
  onChange,
  onSubmit,
  focus = true,
  placeholder = '',
  mask,
  suggestions = [],
  history = [],
  onCycleScreen,
  prompt,
  promptColor = theme.accent,
  maxSuggestions = 5,
}: PromptInputProps): React.ReactElement {
  const chars = useMemo(() => Array.from(value), [value]);
  const [cursor, setCursor] = useState(chars.length);
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [suggestionActive, setSuggestionActive] = useState(false);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const draftRef = useRef('');

  useEffect(() => {
    setCursor((current) => Math.min(current, chars.length));
  }, [chars.length]);

  useEffect(() => {
    if (suggestionIndex >= suggestions.length) setSuggestionIndex(0);
  }, [suggestionIndex, suggestions.length]);

  const visibleSuggestions = suggestions.slice(0, maxSuggestions);
  const labelWidth = Math.min(
    28,
    Math.max(10, ...visibleSuggestions.map((suggestion) => suggestion.label.length)),
  );

  const resetAfterSubmit = (): void => {
    setCursor(0);
    setSuggestionIndex(0);
    setSuggestionActive(false);
    setHistoryIndex(null);
    draftRef.current = '';
  };

  const completeSuggestion = (suggestion: PromptSuggestion): void => {
    const next = suggestion.submit
      ? suggestion.value
      : suggestion.value.endsWith(' ')
        ? suggestion.value
        : `${suggestion.value} `;
    onChange(next);
    setCursor(Array.from(next).length);
    setSuggestionIndex(0);
    setSuggestionActive(false);
    setHistoryIndex(null);
  };

  const recallHistory = (direction: 1 | -1): void => {
    if (history.length === 0) return;
    if (historyIndex === null) {
      if (direction === 1) return;
      draftRef.current = value;
      const index = history.length - 1;
      setHistoryIndex(index);
      onChange(history[index] ?? '');
      setCursor(Array.from(history[index] ?? '').length);
      return;
    }
    const next = historyIndex + direction;
    if (next < 0) {
      setHistoryIndex(0);
      onChange(history[0] ?? '');
      setCursor(Array.from(history[0] ?? '').length);
      return;
    }
    if (next >= history.length) {
      setHistoryIndex(null);
      onChange(draftRef.current);
      setCursor(Array.from(draftRef.current).length);
      return;
    }
    setHistoryIndex(next);
    onChange(history[next] ?? '');
    setCursor(Array.from(history[next] ?? '').length);
  };

  useInput(
    (input, key) => {
      const enter = isEnter(input, key);

      if (key.escape) {
        if (suggestionActive) {
          setSuggestionActive(false);
          return;
        }
        return;
      }

      if (enter) {
        if (suggestionActive && visibleSuggestions.length > 0) {
          const suggestion =
            visibleSuggestions[Math.min(suggestionIndex, visibleSuggestions.length - 1)]!;
          if (suggestion.submit) {
            onSubmit(suggestion.value);
            resetAfterSubmit();
          } else {
            completeSuggestion(suggestion);
          }
          return;
        }
        onSubmit(value);
        resetAfterSubmit();
        return;
      }

      if (key.tab) {
        if (visibleSuggestions.length > 0) {
          const suggestion =
            visibleSuggestions[suggestionIndex % visibleSuggestions.length] ??
            visibleSuggestions[0]!;
          completeSuggestion(suggestion);
          return;
        }
        onCycleScreen?.(key.shift ? -1 : 1);
        return;
      }

      if (key.upArrow || key.downArrow) {
        if (visibleSuggestions.length > 0) {
          setSuggestionActive(true);
          setSuggestionIndex((current) => {
            if (!suggestionActive) return key.upArrow ? visibleSuggestions.length - 1 : 0;
            return key.upArrow
              ? (current - 1 + visibleSuggestions.length) % visibleSuggestions.length
              : (current + 1) % visibleSuggestions.length;
          });
          return;
        }
        recallHistory(key.upArrow ? -1 : 1);
        return;
      }

      if (key.leftArrow) {
        if (key.ctrl || key.meta) {
          onCycleScreen?.(-1);
          return;
        }
        if (cursor > 0) setCursor(cursor - 1);
        else if (chars.length === 0) onCycleScreen?.(-1);
        return;
      }

      if (key.rightArrow) {
        if (key.ctrl || key.meta) {
          onCycleScreen?.(1);
          return;
        }
        if (cursor < chars.length) setCursor(cursor + 1);
        else if (chars.length === 0) onCycleScreen?.(1);
        return;
      }

      if (key.home || (key.ctrl && input === 'a')) {
        setCursor(0);
        return;
      }
      if (key.end || (key.ctrl && input === 'e')) {
        setCursor(chars.length);
        return;
      }

      if (key.ctrl) {
        if (input === 'u') {
          onChange('');
          setCursor(0);
          setHistoryIndex(null);
        } else if (input === 'w') {
          let next = cursor;
          while (next > 0 && /\s/.test(chars[next - 1] ?? '')) next -= 1;
          while (next > 0 && !/\s/.test(chars[next - 1] ?? '')) next -= 1;
          onChange([...chars.slice(0, next), ...chars.slice(cursor)].join(''));
          setCursor(next);
          setHistoryIndex(null);
        } else if (input === 'h') {
          if (cursor > 0) {
            onChange([...chars.slice(0, cursor - 1), ...chars.slice(cursor)].join(''));
            setCursor(cursor - 1);
            setHistoryIndex(null);
          }
        }
        return;
      }

      if (key.meta) return;

      if (key.backspace) {
        if (cursor > 0) {
          onChange([...chars.slice(0, cursor - 1), ...chars.slice(cursor)].join(''));
          setCursor(cursor - 1);
          setHistoryIndex(null);
          setSuggestionActive(false);
        }
        return;
      }

      if (key.delete) {
        if (cursor < chars.length) {
          onChange([...chars.slice(0, cursor), ...chars.slice(cursor + 1)].join(''));
          setHistoryIndex(null);
          setSuggestionActive(false);
        }
        return;
      }

      if (key.pageUp || key.pageDown || input.length === 0) return;

      const clean = normalizeInsertion(input);
      if (!clean) return;
      const inserted = Array.from(clean);
      const next = [...chars.slice(0, cursor), ...inserted, ...chars.slice(cursor)].join('');
      onChange(next);
      setCursor(cursor + inserted.length);
      setHistoryIndex(null);
      setSuggestionActive(false);
    },
    { isActive: focus },
  );

  const displayChars = mask ? Array.from(mask.repeat(chars.length)) : chars;
  const before = displayChars.slice(0, cursor).join('');
  const at = displayChars[cursor] ?? ' ';
  const after = displayChars.slice(cursor + 1).join('');
  const showCursor = focus && (chars.length > 0 || placeholder.length === 0);
  const placeholderFirst = placeholder.slice(0, 1);
  const placeholderRest = placeholder.slice(1);

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={promptColor} bold>
          {prompt ?? `${glyph.prompt} `}
        </Text>
        <Box flexGrow={1}>
          {chars.length === 0 && placeholder ? (
            focus ? (
              <Text color={theme.faint} wrap="wrap">
                <Text color={theme.muted} inverse>
                  {placeholderFirst}
                </Text>
                {placeholderRest}
              </Text>
            ) : (
              <Text color={theme.faint} wrap="wrap">
                {placeholder}
              </Text>
            )
          ) : (
            <Text color={theme.text} wrap="wrap">
              {before}
              {showCursor ? <Text inverse>{at}</Text> : at}
              {after}
            </Text>
          )}
        </Box>
      </Box>

      {focus && suggestionActive && visibleSuggestions.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          {visibleSuggestions.map((suggestion, index) => {
            const selected = index === suggestionIndex;
            return (
              <Box key={`${suggestion.value}-${index}`}>
                <Text
                  color={selected ? theme.black : theme.text}
                  backgroundColor={selected ? theme.accent : undefined}
                  bold={selected}
                >
                  {` ${suggestion.label.padEnd(labelWidth)} `}
                </Text>
                {suggestion.detail ? (
                  <Text color={selected ? theme.black : theme.faint}> {suggestion.detail}</Text>
                ) : null}
              </Box>
            );
          })}
        </Box>
      ) : focus && visibleSuggestions.length > 0 ? (
        <Box marginTop={1}>
          <Text color={theme.faint}>
            {glyph.arrowUp}/{glyph.arrowDown} choose {glyph.bullet} tab complete {glyph.bullet}{' '}
            enter run
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}
