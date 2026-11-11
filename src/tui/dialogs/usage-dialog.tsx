import React, { useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { AppContext } from '../../core/app.js';
import { formatCount } from '../components.js';
import { formatDateTime } from '../../cli/output.js';
import { describeCategory } from '../../core/providers/errors.js';
import { theme } from '../theme.js';
import { ModalWindow } from './modal.js';

interface UsageDialogProps {
  context: AppContext;
  onClose: () => void;
  notify: (message: string) => void;
  refreshData: () => void;
}

function money(value: number | null): string {
  if (value === null) return '—';
  if (value === 0) return '$0';
  if (value < 0.01) return `$${value.toFixed(5)}`;
  return `$${value.toFixed(3)}`;
}

export function UsageDialog({
  context,
  onClose,
  notify,
  refreshData,
}: UsageDialogProps): React.ReactElement {
  const [todayOnly, setTodayOnly] = useState(false);

  const since = useMemo(() => {
    if (!todayOnly) return undefined;
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  }, [todayOnly]);

  const totals = context.store.usageTotals(since);
  const byModel = context.store.usageByModel(since).slice(0, 5);
  const limits = context.store.listLimits(true);

  useInput((input, key) => {
    if (key.escape) {
      onClose();
      return;
    }
    if (input === 't' || input === 'T') {
      setTodayOnly((v) => !v);
      return;
    }
    if (input === 'c' || input === 'C') {
      if (limits.length === 0) return;
      for (const limit of limits) {
        context.store.clearLimit(limit.profileId, limit.modelId);
      }
      notify(`Cleared ${limits.length} active limit(s).`);
      refreshData();
      return;
    }
  });

  return (
    <ModalWindow
      title="TOKEN USAGE & PROVIDER LIMITS"
      subtitle={todayOnly ? 'today only' : 'all-time'}
      width={72}
      height={19}
      borderColor={theme.accent}
      footer={[
        't toggle all/today',
        limits.length > 0 ? 'c clear active limits' : 'limits active: ' + limits.length,
        'esc close',
      ]}
    >
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {/* Totals Summary */}
        <Box
          justifyContent="space-between"
          paddingX={1}
          marginBottom={1}
          borderStyle="single"
          borderColor={theme.border}
        >
          <Box flexDirection="column">
            <Text color={theme.faint}>INPUT TOKENS</Text>
            <Text bold color={theme.text}>
              {formatCount(totals.inputTokens)}
            </Text>
          </Box>
          <Box flexDirection="column">
            <Text color={theme.faint}>OUTPUT TOKENS</Text>
            <Text bold color={theme.text}>
              {formatCount(totals.outputTokens)}
            </Text>
          </Box>
          <Box flexDirection="column">
            <Text color={theme.faint}>TOTAL TOKENS</Text>
            <Text bold color={theme.accent}>
              {formatCount(totals.inputTokens + totals.outputTokens)}
            </Text>
          </Box>
          <Box flexDirection="column">
            <Text color={theme.faint}>EVENTS</Text>
            <Text bold color={theme.text}>
              {formatCount(totals.events)}
            </Text>
          </Box>
          <Box flexDirection="column">
            <Text color={theme.faint}>ESTIMATED COST</Text>
            <Text bold color={theme.success}>
              {money(totals.cost)}
            </Text>
          </Box>
        </Box>

        {/* Active Limits */}
        <Box flexDirection="column" marginBottom={1}>
          <Text color={theme.accent} bold>
            Active Provider Rate Limits ({limits.length})
          </Text>
          {limits.length === 0 ? (
            <Text color={theme.muted}>No active rate limits recorded. All providers available.</Text>
          ) : (
            limits.slice(0, 3).map((limit) => {
              const profile = context.store.getProfile(limit.profileId);
              return (
                <Box key={`${limit.profileId}-${limit.modelId}`} justifyContent="space-between">
                  <Text color={theme.warning}>
                    · {profile?.name ?? limit.profileId} ({limit.modelId ?? 'all models'})
                  </Text>
                  <Text color={theme.faint}>
                    {describeCategory(limit.category)} · resets{' '}
                    {limit.resetAt ? formatDateTime(limit.resetAt) : 'unknown'}
                  </Text>
                </Box>
              );
            })
          )}
        </Box>

        {/* Top Models By Usage */}
        <Box flexDirection="column">
          <Text color={theme.accent} bold>
            Top Models by Usage
          </Text>
          {byModel.length === 0 ? (
            <Text color={theme.muted}>No recorded usage for this period.</Text>
          ) : (
            byModel.map((item) => (
              <Box key={item.modelId} justifyContent="space-between">
                <Text color={theme.text} wrap="truncate">
                  · {item.modelId}
                </Text>
                <Text color={theme.faint}>
                  {formatCount(item.inputTokens + item.outputTokens)} tokens ·{' '}
                  {money(item.costEstimate)}
                </Text>
              </Box>
            ))
          )}
        </Box>
      </Box>
    </ModalWindow>
  );
}
