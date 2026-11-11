import React, { useEffect, useRef, useState } from 'react';
import { Box, Text, useInput, useWindowSize } from 'ink';
import type { ConfirmationRequest, ConfirmDecision } from '../../core/agent/types.js';
import { glyph, theme } from '../theme.js';
import { clip } from '../components.js';
import { setMouseClickHandler } from '../mouse.js';

const ALWAYS_KINDS = new Set([
  'file-write',
  'file-delete',
  'command',
  'dangerous-command',
  'provider-switch',
]);

interface ConfirmOption {
  label: string;
  hint: string;
  decision: ConfirmDecision;
  shortcut: string;
}

/** Compact inline approval prompt rendered in place of the composer. */
export function ConfirmDialog({
  request,
  onDecision,
}: {
  request: ConfirmationRequest;
  onDecision: (decision: ConfirmDecision) => void;
}): React.ReactElement {
  const canAlways = ALWAYS_KINDS.has(request.kind);
  const options: ConfirmOption[] = [
    { label: 'Allow once', hint: 'approve this action', decision: 'allow', shortcut: 'y' },
    ...(canAlways
      ? [
          {
            label: 'Always allow',
            hint: 'approve and remember for this run',
            decision: 'always' as const,
            shortcut: 'a',
          },
        ]
      : []),
    { label: 'Deny', hint: 'refuse this action', decision: 'deny', shortcut: 'n' },
  ];
  const [selected, setSelected] = useState(0);
  const { rows } = useWindowSize();
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // Mouse click support: the option rows sit just above the hint line and
  // bottom border, anchored to the bottom of the screen (app footer = 2 rows,
  // workspace status rows = 4 rows).
  useEffect(() => {
    setMouseClickHandler((row) => {
      const list = optionsRef.current;
      const firstOptionRow = rows - list.length - 7;
      const index = row - firstOptionRow;
      if (index >= 0 && index < list.length) {
        onDecision(list[index]!.decision);
      }
    });
    return () => setMouseClickHandler(null);
  }, [rows, onDecision]);

  useInput((input, key) => {
    const char = input.toLowerCase();
    if (char === 'y') return onDecision('allow');
    if (canAlways && char === 'a') return onDecision('always');
    if (char === 'n' || key.escape) return onDecision('deny');
    if (key.upArrow) {
      setSelected((value) => (value - 1 + options.length) % options.length);
      return;
    }
    if (key.downArrow) {
      setSelected((value) => (value + 1) % options.length);
      return;
    }
    if (key.return || input === ' ') {
      const option = options[selected];
      if (option) onDecision(option.decision);
    }
  });

  const diffLines = request.diff ? request.diff.split(/\r?\n/).slice(0, 4) : [];
  const diffTotal = request.diff ? request.diff.split(/\r?\n/).length : 0;
  const target = request.command ?? request.path ?? null;

  return (
    <Box
      flexDirection="column"
      flexShrink={0}
      borderStyle="round"
      borderColor={theme.warning}
      backgroundColor={theme.surface}
      paddingX={1}
    >
      <Text color={theme.warning} bold wrap="truncate">
        {glyph.pause} {request.title}
      </Text>
      <Text color={theme.muted} wrap="truncate">
        {clip(request.description, 120)}
      </Text>
      {target ? (
        <Text color={theme.warning} wrap="truncate-middle">
          {request.command ? '$ ' : ''}
          {clip(target, 100)}
        </Text>
      ) : null}
      {request.reasons?.slice(0, 2).map((reason) => (
        <Text key={reason} color={theme.danger} wrap="truncate">
          {glyph.bullet} {clip(reason, 100)}
        </Text>
      ))}
      {diffLines.length ? (
        <Box flexDirection="column">
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
              wrap="truncate"
            >
              {clip(line, 100) || ' '}
            </Text>
          ))}
          {diffTotal > diffLines.length ? (
            <Text color={theme.faint}>[+{diffTotal - diffLines.length} diff lines]</Text>
          ) : null}
        </Box>
      ) : null}
      <Box flexDirection="column" marginTop={1}>
        {options.map((option, index) => {
          const active = index === selected;
          const color =
            option.decision === 'deny' ? theme.danger : theme.success;
          return (
            <Box key={option.decision}>
              <Text color={active ? theme.accent : theme.faint} bold={active}>
                {active ? `${glyph.active} ` : '  '}
              </Text>
              <Text color={active ? color : theme.muted} bold={active}>
                {option.label}
              </Text>
              <Text color={theme.faint}> — {option.hint}</Text>
              <Text color={theme.faint}> [{option.shortcut}]</Text>
            </Box>
          );
        })}
      </Box>
      <Text color={theme.faint} wrap="truncate">
        ↑/↓ choose · enter/click select · esc deny
      </Text>
    </Box>
  );
}
