import React, { useMemo } from 'react';
import { Box, Text, useInput, type Key } from 'ink';
import { glyph, theme } from '../theme.js';
import { useLayout } from '../components.js';
import { isMouseSequence, isSuppressedInput } from '../mouse.js';

export interface SelectorItem {
  key: string;
  label: string;
  detail?: string;
  group?: string;
  badge?: string;
  badgeColor?: string;
  /** Marker rendered before the label (for example a free/paid status). */
  leadingBadge?: string;
  leadingBadgeColor?: string;
  disabled?: boolean;
  disabledReason?: string;
}

export interface SelectorProps {
  title: string;
  subtitle?: string;
  items: SelectorItem[];
  query: string;
  onQueryChange: (value: string) => void;
  selected: number;
  onSelectedChange: (index: number) => void;
  onSelect: (item: SelectorItem) => void;
  onClose: () => void;
  /** Return true to consume a key before the built-in handling. */
  onKey?: (input: string, key: Key, item: SelectorItem | null) => boolean;
  searchPlaceholder?: string;
  emptyText?: string;
  footer?: string[];
  showSearch?: boolean;
  accent?: string;
  maxVisible?: number;
  floating?: boolean;
}

export function Selector({
  title,
  subtitle,
  items,
  query,
  onQueryChange,
  selected,
  onSelectedChange,
  onSelect,
  onClose,
  onKey,
  searchPlaceholder = 'Search…',
  emptyText = 'No matches.',
  footer = ['↑↓ navigate', 'enter select', 'esc close'],
  showSearch = true,
  accent = theme.accent,
  maxVisible,
  floating = true,
}: SelectorProps): React.ReactElement {
  const { rows, columns } = useLayout();
  const safeSelected = Math.min(Math.max(0, selected), Math.max(0, items.length - 1));
  const current = items[safeSelected] ?? null;

  const move = (direction: 1 | -1): void => {
    if (items.length === 0) return;
    let index = safeSelected;
    for (let attempt = 0; attempt < items.length; attempt += 1) {
      index = (index + direction + items.length) % items.length;
      if (!items[index]?.disabled) {
        onSelectedChange(index);
        return;
      }
    }
  };

  useInput(
    (input, key) => {
      if (isMouseSequence(input) || isSuppressedInput()) return;
      if (onKey?.(input, key, current)) return;
      if (key.escape) {
        onClose();
        return;
      }
      if (key.upArrow) {
        move(-1);
        return;
      }
      if (key.downArrow) {
        move(1);
        return;
      }
      if (key.pageUp) {
        onSelectedChange(Math.max(0, safeSelected - 6));
        return;
      }
      if (key.pageDown) {
        onSelectedChange(Math.min(Math.max(0, items.length - 1), safeSelected + 6));
        return;
      }
      if (key.return || input === '\r' || input === '\n') {
        if (current && !current.disabled) onSelect(current);
        return;
      }
      if (!showSearch) return;
      if (key.backspace || key.delete) {
        onQueryChange([...query].slice(0, -1).join(''));
        return;
      }
      if (key.ctrl || key.meta || key.tab) return;
      if (!input) return;
      const clean = Array.from(input)
        .filter((character) => {
          const code = character.codePointAt(0) ?? 0;
          return code >= 0x20 && code !== 0x7f;
        })
        .join('');
      if (clean) onQueryChange(query + clean);
    },
    { isActive: true },
  );

  type Row = { kind: 'group'; label: string } | { kind: 'item'; item: SelectorItem; index: number };

  const displayRows = useMemo(() => {
    const result: Row[] = [];
    let previousGroup: string | undefined;
    items.forEach((item, index) => {
      if (item.group && item.group !== previousGroup) {
        result.push({ kind: 'group', label: item.group });
        previousGroup = item.group;
      }
      result.push({ kind: 'item', item, index });
    });
    return result;
  }, [items]);

  const selectedRow = Math.max(
    0,
    displayRows.findIndex((row) => row.kind === 'item' && row.index === safeSelected),
  );
  const modalWidth = Math.max(36, Math.min(columns - 4, 72));
  const modalHeight = Math.max(8, Math.min(rows - 4, 20));
  const height = Math.max(4, maxVisible ?? (floating ? modalHeight - 9 : rows - 12));

  // Window by terminal lines, not row count: items with a detail line occupy
  // two rows, and the "N more" indicators each take one. Without this the
  // selected item can be pushed below the visible area and appear cut off.
  const rowCost = (row: Row): number =>
    row.kind === 'group' ? 1 : row.item.detail ? 2 : 1;
  const costs = displayRows.map(rowCost);
  let start = selectedRow;
  let used = costs[selectedRow] ?? 1;
  while (start > 0 && used + (costs[start - 1] ?? 0) <= height) {
    start -= 1;
    used += costs[start] ?? 0;
  }
  let end = selectedRow;
  while (end + 1 < displayRows.length && used + (costs[end + 1] ?? 0) <= height) {
    end += 1;
    used += costs[end] ?? 0;
  }
  // Reclaim space above if the downward pass left budget unused.
  while (start > 0 && used + (costs[start - 1] ?? 0) <= height) {
    start -= 1;
    used += costs[start] ?? 0;
  }
  // Account for the overflow indicators so total lines never exceed height.
  while (
    end > selectedRow &&
    used + (start > 0 ? 1 : 0) + (end + 1 < displayRows.length ? 1 : 0) > height
  ) {
    used -= costs[end] ?? 0;
    end -= 1;
  }
  const visible = displayRows.slice(start, end + 1);
  const remainingAbove = start;
  const remainingBelow = Math.max(0, displayRows.length - (end + 1));

  const content = (
    <Box
      width={floating ? modalWidth : undefined}
      height={floating ? modalHeight : undefined}
      flexGrow={floating ? undefined : 1}
      flexDirection="column"
      borderStyle="round"
      borderColor={accent}
      backgroundColor={theme.surface}
      paddingX={1}
      overflow="hidden"
    >
      <Box justifyContent="space-between" flexShrink={0}>
        <Text bold color={theme.text} wrap="truncate">
          <Text color={accent}>{glyph.brand} </Text>
          {title}
        </Text>
        <Text color={theme.faint} wrap="truncate">
          {subtitle ? `${subtitle}  ` : ''}
          {items.length} {items.length === 1 ? 'result' : 'results'}
        </Text>
      </Box>

      {showSearch ? (
        <Box flexShrink={0} marginTop={1}>
          <Text color={theme.faint}>{glyph.prompt} </Text>
          {query ? (
            <Text color={theme.text} wrap="truncate">
              {query}
              <Text color={accent}>▌</Text>
            </Text>
          ) : (
            <Text color={theme.faint} wrap="truncate">
              {searchPlaceholder}
              <Text color={accent}>▌</Text>
            </Text>
          )}
        </Box>
      ) : null}

      <Box flexDirection="column" flexGrow={1} overflow="hidden" marginTop={1}>
        {items.length === 0 ? (
          <Text color={theme.muted} wrap="wrap">
            {emptyText}
          </Text>
        ) : (
          <>
            {remainingAbove > 0 ? (
              <Text color={theme.faint}>
                {glyph.arrowUp} {remainingAbove} more
              </Text>
            ) : null}
            {visible.map((row, offset) => {
              if (row.kind === 'group') {
                return (
                  <Text key={`group-${row.label}-${start + offset}`} color={theme.faint} bold>
                    {row.label.toUpperCase()}
                  </Text>
                );
              }
              const active = row.index === safeSelected && !row.item.disabled;
              return (
                <Box key={row.item.key} flexDirection="column" flexShrink={0}>
                  <Box>
                    <Text
                      color={active ? theme.black : row.item.disabled ? theme.faint : theme.text}
                      backgroundColor={active ? accent : undefined}
                      bold={active}
                      wrap="truncate"
                    >
                      {active ? ` ${glyph.active} ` : '   '}
                      {row.item.leadingBadge ? (
                        <Text
                          bold
                          color={
                            active ? theme.black : (row.item.leadingBadgeColor ?? theme.success)
                          }
                        >
                          {row.item.leadingBadge}{' '}
                        </Text>
                      ) : null}
                      <Text bold={active}>{row.item.label}</Text>
                      {row.item.badge ? (
                        <Text color={active ? theme.black : (row.item.badgeColor ?? theme.muted)}>
                          {'  '}
                          {row.item.badge}
                        </Text>
                      ) : null}
                      {'  '}
                    </Text>
                  </Box>
                  {row.item.detail ? (
                    <Text color={active ? theme.muted : theme.faint} wrap="truncate">
                      {'     '}
                      {row.item.detail}
                    </Text>
                  ) : null}
                </Box>
              );
            })}
            {remainingBelow > 0 ? (
              <Text color={theme.faint}>
                {glyph.arrowDown} {remainingBelow} more
              </Text>
            ) : null}
          </>
        )}
      </Box>

      <Box flexShrink={0} marginTop={1} justifyContent="space-between">
        <Text color={theme.faint} wrap="truncate">
          {footer.join(`  ${glyph.bullet}  `)}
        </Text>
        <Text color={theme.faint}>{columns < 80 ? '' : `${columns} cols`}</Text>
      </Box>
    </Box>
  );

  if (!floating) return content;

  return (
    <Box
      position="absolute"
      top={0}
      left={0}
      width={columns}
      height={rows}
      justifyContent="center"
      alignItems="center"
    >
      {content}
    </Box>
  );
}

export function filterByQuery<T>(items: T[], query: string, fields: (item: T) => string[]): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return items;
  return items.filter((item) => fields(item).some((field) => field.toLowerCase().includes(needle)));
}
