import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useInput, useWindowSize, type Key } from 'ink';
import { glyph, theme } from './theme.js';
import { isMouseSequence, isSuppressedInput } from './mouse.js';

export type ScreenId = 'workspace';

/**
 * ComiCode is a single-surface UI: the workspace is the only screen. Every
 * other feature (providers, models, tasks, usage, settings) opens as a modal
 * dialog layered over the chat, so there is nothing to cycle between.
 */
export const SCREENS: Array<{ id: ScreenId; label: string; short: string }> = [
  { id: 'workspace', label: 'workspace', short: 'work' },
];

export type AgentStatus = 'idle' | 'running' | 'paused' | 'completed' | 'failed';

const STATUS: Record<AgentStatus, { color: string; label: string }> = {
  idle: { color: theme.faint, label: 'idle' },
  running: { color: theme.accent, label: 'running' },
  paused: { color: theme.warning, label: 'paused' },
  completed: { color: theme.success, label: 'completed' },
  failed: { color: theme.danger, label: 'failed' },
};

interface WrappedLine {
  text: string;
  /** Code-point index of this line's first char in the source string. */
  start: number;
}

/** Greedy word-wrap that prefers breaking at whitespace; keeps char offsets. */
export function wrapText(text: string, width: number): WrappedLine[] {
  const chars = Array.from(text);
  const lines: WrappedLine[] = [];
  let i = 0;
  while (i < chars.length) {
    let end = Math.min(i + width, chars.length);
    if (end < chars.length) {
      let spaceBreak = -1;
      for (let j = end; j > i + 1; j -= 1) {
        if (/\s/.test(chars[j - 1] ?? '')) {
          spaceBreak = j - 1;
          break;
        }
      }
      if (spaceBreak > i) end = spaceBreak;
    }
    const raw = chars.slice(i, end);
    let trimEnd = raw.length;
    while (trimEnd > 0 && /\s/.test(raw[trimEnd - 1] ?? '')) trimEnd -= 1;
    lines.push({ text: raw.slice(0, trimEnd).join(''), start: i });
    i = end;
    while (i < chars.length && /\s/.test(chars[i] ?? '')) i += 1;
  }
  return lines.length > 0 ? lines : [{ text: '', start: 0 }];
}

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
  version,
  cwd,
  profileName,
  status,
  allowPaid,
  taskId,
  branch,
  columns,
  dimmed,
  agentMode = 'build',
}: {
  screen?: ScreenId;
  version: string;
  cwd: string;
  profileName: string | null;
  status: AgentStatus;
  allowPaid: boolean;
  taskId: string | null;
  branch?: string | null;
  columns: number;
  dimmed?: boolean;
  agentMode?: import('../core/agent/modes.js').AgentMode;
}): React.ReactElement {
  const compact = columns < 96;
  return (
    <Box flexDirection="column" flexShrink={0} paddingX={1}>
      {/* Top line: Brand, interactive controls, status */}
      <Box justifyContent="space-between">
        <Text wrap="truncate" dimColor={dimmed}>
          <Text bold color={theme.accent}>
            {glyph.brand}
          </Text>
          <Text bold color={theme.text}>
            {' '}
            comicode
          </Text>
          <Text color={theme.faint}> workspace v{version}</Text>
        </Text>
        <Box columnGap={2}>
          {allowPaid ? (
            <Text color={theme.warning} dimColor={dimmed}>
              paid on
            </Text>
          ) : null}
          <StatusPill status={status} />
          {!compact ? (
            <Text color={theme.faint} dimColor={dimmed}>
              ctrl+p commands
            </Text>
          ) : null}
        </Box>
      </Box>

      {/* Middle line: Interactive Provider and Model controls */}
      <Box marginTop={1} justifyContent="space-between" width="100%">
        <Box columnGap={2}>
          {/* Provider control */}
          <Text dimColor={dimmed}>
            <Text color={theme.faint}>ctrl+b </Text>
            <Text
              color={profileName ? theme.text : theme.warning}
              bold
              backgroundColor={theme.border}
            >
              {profileName ? ` ${glyph.ring} ${profileName} ` : ' Connect Provider '}
            </Text>
          </Text>

          {/* Model control */}
          <Text dimColor={dimmed}>
            <Text color={theme.faint}>ctrl+m </Text>
            <Text color={theme.accent} bold backgroundColor={theme.border}>
              {' Change model '}
            </Text>
          </Text>

          {/* Agent mode control (tab cycles) */}
          <Text dimColor={dimmed}>
            <Text color={theme.faint}>tab </Text>
            <Text
              color={agentMode === 'build' ? theme.text : theme.warning}
              bold
              backgroundColor={theme.border}
            >
              {' '}
              {agentMode === 'build'
                ? glyph.tool
                : agentMode === 'plan'
                  ? glyph.pause
                  : glyph.ring}{' '}
              {agentMode}{' '}
            </Text>
          </Text>
        </Box>

        {taskId ? (
          <Text color={theme.faint} dimColor={dimmed}>
            task {taskId.slice(0, 8)}
          </Text>
        ) : null}
      </Box>

      {/* Bottom line: Directory & branch */}
      <Box justifyContent="space-between" marginTop={1}>
        <Text color={theme.muted} wrap="truncate-middle" dimColor={dimmed}>
          {cwd}
          {branch ? <Text color={theme.violet}> ⎇ {branch}</Text> : null}
        </Text>
        {!compact ? (
          <Text color={theme.faint} dimColor={dimmed}>
            / commands · ? shortcuts
          </Text>
        ) : null}
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
  return `${lines.slice(0, maxLines).join('\n')}\n[+${lines.length - maxLines} lines]`;
}

export interface PromptSuggestion {
  value: string;
  label: string;
  detail?: string;
  hint?: string;
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
  /** Tab cycles the agent mode (build/plan/debug) when provided. */
  onCycleMode?: (direction: 1 | -1) => void;
  prompt?: React.ReactNode;
  promptColor?: string;
  maxSuggestions?: number;
  popupTitle?: string;
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
  onCycleMode,
  prompt,
  promptColor = theme.accent,
  maxSuggestions = 8,
  popupTitle = 'COMMANDS',
}: PromptInputProps): React.ReactElement {
  const chars = useMemo(() => Array.from(value), [value]);
  const [cursor, setCursor] = useState(chars.length);
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [suggestionActive, setSuggestionActive] = useState(false);
  const [suggestionDismissed, setSuggestionDismissed] = useState(false);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const draftRef = useRef('');

  useEffect(() => {
    setCursor((current) => Math.min(current, chars.length));
  }, [chars.length]);

  useEffect(() => {
    setSuggestionDismissed(false);
    setSuggestionIndex(0);
  }, [value]);

  useEffect(() => {
    if (suggestionIndex >= suggestions.length) setSuggestionIndex(0);
  }, [suggestionIndex, suggestions.length]);

  const visibleSuggestions = suggestions.slice(0, maxSuggestions);
  // An open @token at the end of the input triggers file-mention completion.
  const mentionMode = /(^|\s)@([^\s@]*)$/.test(value);
  const labelWidth = Math.min(
    28,
    Math.max(10, ...visibleSuggestions.map((suggestion) => suggestion.label.length)),
  );

  const resetAfterSubmit = (): void => {
    setCursor(0);
    setSuggestionIndex(0);
    setSuggestionActive(false);
    setSuggestionDismissed(false);
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
      if (isMouseSequence(input) || isSuppressedInput()) return;
      const enter = isEnter(input, key);
      const isSuggestionOpen =
        visibleSuggestions.length > 0 &&
        !suggestionDismissed &&
        (suggestionActive || value.startsWith('/') || mentionMode);

      if (key.escape) {
        if (isSuggestionOpen) {
          setSuggestionDismissed(true);
          setSuggestionActive(false);
          return;
        }
        return;
      }

      if (enter) {
        if (isSuggestionOpen) {
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
        if (isSuggestionOpen) {
          const suggestion =
            visibleSuggestions[suggestionIndex % visibleSuggestions.length] ??
            visibleSuggestions[0]!;
          completeSuggestion(suggestion);
          return;
        }
        if (onCycleMode) onCycleMode(key.shift ? -1 : 1);
        else onCycleScreen?.(key.shift ? -1 : 1);
        return;
      }

      if (key.upArrow || key.downArrow) {
        if (visibleSuggestions.length > 0) {
          setSuggestionDismissed(false);
          setSuggestionActive(true);
          setSuggestionIndex((current) => {
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
  const { columns, rows } = useLayout();
  const renderedChars = [
    ...displayChars.slice(0, cursor),
    displayChars[cursor] ?? ' ',
    ...displayChars.slice(cursor + 1),
  ];
  const inputWidth = Math.max(16, columns - 12);
  const wrapped = wrapText(renderedChars.join(''), inputWidth);
  const maxLines = Math.min(10, Math.max(4, Math.floor(rows / 3)));
  let cursorLine = wrapped.length - 1;
  for (let index = 0; index < wrapped.length; index += 1) {
    const nextStart = wrapped[index + 1]?.start ?? Number.MAX_SAFE_INTEGER;
    if (cursor >= wrapped[index]!.start && cursor < nextStart) {
      cursorLine = index;
      break;
    }
  }
  const firstLine = Math.max(
    0,
    Math.min(cursorLine - Math.floor(maxLines / 2), wrapped.length - maxLines),
  );
  const lastLine = Math.min(wrapped.length, firstLine + maxLines);
  const showCursor = focus && (chars.length > 0 || placeholder.length === 0);
  const placeholderFirst = placeholder.slice(0, 1);
  const placeholderRest = placeholder.slice(1);

  return (
    <Box flexDirection="column">
      {focus &&
      visibleSuggestions.length > 0 &&
      !suggestionDismissed &&
      (suggestionActive || value.startsWith('/') || mentionMode) ? (
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor={theme.accent}
          backgroundColor={theme.surface}
          paddingX={1}
          marginBottom={1}
        >
          <Box justifyContent="space-between" marginBottom={1}>
            <Text color={theme.accent} bold>
              {glyph.brand} {mentionMode ? 'FILES' : popupTitle}
            </Text>
            <Text color={theme.faint}>
              {mentionMode
                ? '↑/↓ choose · tab/enter insert · esc dismiss'
                : '↑/↓ choose · enter run · tab complete · esc dismiss'}
            </Text>
          </Box>
          {visibleSuggestions.map((suggestion, index) => {
            const selected = index === suggestionIndex;
            return (
              <Box
                key={`${suggestion.value}-${index}`}
                justifyContent="space-between"
                backgroundColor={selected ? theme.surfaceAlt : undefined}
              >
                <Box>
                  <Text color={selected ? theme.accent : theme.text} bold={selected}>
                    {selected ? `${glyph.active} ` : '  '}
                    {suggestion.label.padEnd(labelWidth)}
                  </Text>
                  {suggestion.detail ? (
                    <Text color={selected ? theme.text : theme.muted}> {suggestion.detail}</Text>
                  ) : null}
                </Box>
                {suggestion.hint ? (
                  <Text color={selected ? theme.text : theme.faint}>{suggestion.hint}</Text>
                ) : null}
              </Box>
            );
          })}
        </Box>
      ) : null}

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
            <Box flexDirection="column" flexGrow={1}>
              {firstLine > 0 ? <Text color={theme.faint}>⋮</Text> : null}
              {wrapped.slice(firstLine, lastLine).map((line, lineIndex) => {
                const absolute = firstLine + lineIndex;
                if (!showCursor || absolute !== cursorLine) {
                  return (
                    <Text key={absolute} color={theme.text} wrap="truncate">
                      {line.text || ' '}
                    </Text>
                  );
                }
                const lineChars = Array.from(line.text);
                const col = Math.min(cursor - line.start, lineChars.length);
                const cursorChar = lineChars[col] ?? ' ';
                return (
                  <Text key={absolute} color={theme.text} wrap="truncate">
                    {lineChars.slice(0, col).join('')}
                    <Text inverse>{cursorChar}</Text>
                    {lineChars.slice(col + 1).join('')}
                  </Text>
                );
              })}
              {lastLine < wrapped.length ? <Text color={theme.faint}>⋮</Text> : null}
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  );
}
