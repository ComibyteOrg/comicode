import React, { useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { AppContext } from '../../core/app.js';
import { describeCategory } from '../../core/providers/errors.js';
import { formatDateTime, formatRelative } from '../../cli/output.js';
import { Hint, KeyValue, PanelScreen, formatCount, useLayout } from '../components.js';
import { glyph, theme } from '../theme.js';

function money(value: number | null): string {
  if (value === null) return '—';
  if (value === 0) return '$0';
  if (value < 0.01) return `$${value.toFixed(5)}`;
  return `$${value.toFixed(3)}`;
}

interface UsageProps {
  context: AppContext;
  active: boolean;
  notify: (message: string) => void;
  refreshData: () => void;
  onCycleScreen: (direction: 1 | -1) => void;
  onBack: () => void;
}

export function UsageScreen({
  context,
  active,
  notify,
  refreshData,
  onCycleScreen,
  onBack,
}: UsageProps): React.ReactElement {
  const { columns } = useLayout();
  const [today, setToday] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  const since = useMemo(() => {
    if (!today) return undefined;
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  }, [today]);

  const totals = context.store.usageTotals(since);
  const byModel = context.store.usageByModel(since).slice(0, 8);
  const limits = context.store.listLimits(true);
  const events = context.store.listRoutingEvents(6);

  useInput(
    (input, key) => {
      if (key.escape) {
        if (confirmClear) setConfirmClear(false);
        else onBack();
        return;
      }
      if (confirmClear) {
        if (input === 'y' || input === 'Y') {
          for (const limit of limits) context.store.clearLimit(limit.profileId, limit.modelId);
          setConfirmClear(false);
          notify(`Cleared ${limits.length} active limit${limits.length === 1 ? '' : 's'}.`);
          refreshData();
        } else if (input === 'n' || input === 'N') {
          setConfirmClear(false);
        }
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
      if (input === 't' || input === 'd') setToday((value) => !value);
      else if (input === 'x' && limits.length) setConfirmClear(true);
    },
    { isActive: active },
  );

  return (
    <PanelScreen title="Usage" subtitle={today ? 'today' : 'all time'}>
      <Box flexDirection="column" flexShrink={0}>
        <KeyValue
          rows={[
            ['Input tokens', formatCount(totals.inputTokens)],
            ['Output tokens', formatCount(totals.outputTokens)],
            ['Total tokens', formatCount(totals.inputTokens + totals.outputTokens)],
            ['Estimated cost', money(totals.cost)],
            ['Provider calls', String(totals.events)],
          ]}
          width={18}
        />
      </Box>

      <Box flexDirection="column" marginTop={1} flexShrink={0} overflow="hidden">
        <Text bold color={theme.text}>
          By model
        </Text>
        {byModel.length === 0 ? (
          <Text color={theme.muted}>No usage recorded for this period.</Text>
        ) : (
          byModel.map((entry) => (
            <Text key={`${entry.profileId}-${entry.modelId}`} wrap="truncate">
              <Text color={theme.muted}>
                {'  '}
                {entry.modelId.slice(0, 30).padEnd(31)}
              </Text>
              <Text color={theme.faint}>
                {(context.store.getProfile(entry.profileId)?.name ?? 'removed').padEnd(16)}
                {formatCount(entry.inputTokens)} in / {formatCount(entry.outputTokens)} out{' '}
                {glyph.bullet} {entry.events} calls {glyph.bullet} {money(entry.costEstimate)}
              </Text>
            </Text>
          ))
        )}
      </Box>

      <Box flexDirection="column" marginTop={1} flexShrink={0} overflow="hidden">
        <Text bold color={theme.text}>
          Active limits{' '}
          <Text color={limits.length ? theme.warning : theme.faint}>({limits.length})</Text>
        </Text>
        {limits.length === 0 ? (
          <Text color={theme.muted}>No active provider limits.</Text>
        ) : (
          limits.slice(0, 6).map((limit) => (
            <Text key={`${limit.profileId}-${limit.modelId}-${limit.category}`} wrap="truncate">
              <Text color={theme.muted}>
                {'  '}
                {(context.store.getProfile(limit.profileId)?.name ?? 'removed').padEnd(16)}
                {limit.modelId.slice(0, 22).padEnd(23)}
              </Text>
              <Text color={theme.warning}>{describeCategory(limit.category)}</Text>
              <Text color={theme.faint}>
                {' '}
                {glyph.bullet} reset {formatDateTime(limit.resetAt ?? limit.retryAfterAt)}
              </Text>
            </Text>
          ))
        )}
        {limits.length ? (
          <Text color={theme.faint}>Reset times appear only when the provider supplied them.</Text>
        ) : null}
      </Box>

      <Box flexDirection="column" marginTop={1} flexShrink={0} overflow="hidden">
        <Text bold color={theme.text}>
          Recent routing
        </Text>
        {events.length === 0 ? (
          <Text color={theme.muted}>No routing events yet.</Text>
        ) : (
          events.map((event) => (
            <Text key={event.id} color={theme.faint} wrap="truncate">
              {'  '}
              {formatRelative(event.createdAt).padEnd(10)}
              {event.fromModelId ?? '—'} {glyph.route} {event.toModelId ?? '—'} {glyph.bullet}{' '}
              {event.reason.slice(0, Math.max(20, columns - 62))}
            </Text>
          ))
        )}
      </Box>

      {confirmClear ? (
        <Text color={theme.warning}>
          Clear all {limits.length} active limits? Providers may still enforce them.{' '}
          <Text bold>y</Text> clear {glyph.bullet} <Text bold>n</Text> cancel
        </Text>
      ) : (
        <Box marginTop={1} flexShrink={0}>
          <Text color={theme.muted} wrap="truncate">
            <Text color={theme.accent}>t</Text> toggle today/all
            {limits.length ? (
              <>
                {' '}
                {glyph.bullet} <Text color={theme.accent}>x</Text> clear active limits
              </>
            ) : null}
          </Text>
        </Box>
      )}
      <Hint>
        Costs are catalog estimates {glyph.bullet} ←/→ or tab screens {glyph.bullet} esc back
      </Hint>
    </PanelScreen>
  );
}
