import type { Command } from 'commander';
import { describeCategory } from '../../core/providers/errors.js';
import {
  bold,
  danger,
  dim,
  formatDateTime,
  formatTokens,
  jsonOut,
  printKeyValue,
  printSection,
  printTable,
  success,
  truncate,
  warning,
} from '../output.js';
import { resolveProfile, withStore } from '../shared.js';

function money(value: number | null): string {
  if (value === null) return '—';
  if (value === 0) return '$0';
  if (value < 0.01) return `$${value.toFixed(5)}`;
  return `$${value.toFixed(3)}`;
}

async function usage(options: {
  today?: boolean;
  days?: string;
  all?: boolean;
  json?: boolean;
}): Promise<void> {
  await withStore(({ store }) => {
    const now = new Date();
    let since: string | undefined;
    let label = 'All time';
    if (options.today) {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      since = start.toISOString();
      label = 'Today';
    } else if (options.days) {
      const days = Number(options.days);
      if (!Number.isFinite(days) || days <= 0) throw new Error('--days must be a positive number.');
      since = new Date(Date.now() - days * 86_400_000).toISOString();
      label = `Last ${days} days`;
    }
    const totals = store.usageTotals(since);
    const byModel = store.usageByModel(since);
    const limits = store.listLimits(true);
    if (options.json) {
      jsonOut({ period: label, since: since ?? null, totals, byModel, limits });
      return;
    }
    printSection(`Usage — ${label}`);
    printKeyValue([
      ['Input tokens', formatTokens(totals.inputTokens)],
      ['Output tokens', formatTokens(totals.outputTokens)],
      ['Total tokens', formatTokens(totals.inputTokens + totals.outputTokens)],
      ['Estimated cost', money(totals.cost)],
      ['Provider calls', String(totals.events)],
    ]);
    if (byModel.length) {
      printSection('By model');
      printTable(
        ['MODEL', 'PROFILE', 'INPUT', 'OUTPUT', 'CALLS', 'COST'],
        byModel.map((entry) => [
          entry.modelId,
          store.getProfile(entry.profileId)?.name ?? dim('removed'),
          formatTokens(entry.inputTokens),
          formatTokens(entry.outputTokens),
          String(entry.events),
          money(entry.costEstimate),
        ]),
      );
    } else {
      console.log('');
      console.log(dim('No usage recorded for this period.'));
    }
    printSection('Active limits');
    if (limits.length === 0) {
      console.log(dim('No active provider limits.'));
    } else {
      printTable(
        ['PROFILE', 'MODEL', 'CATEGORY', 'RESET', 'MESSAGE'],
        limits.map((limit) => [
          store.getProfile(limit.profileId)?.name ?? limit.profileId.slice(0, 8),
          limit.modelId,
          describeCategory(limit.category),
          formatDateTime(limit.resetAt ?? limit.retryAfterAt),
          truncate(limit.message ?? '—', 54),
        ]),
      );
      console.log('');
      console.log(dim('Reset times are shown only when the provider supplied them.'));
    }
    console.log('');
    console.log(
      dim(
        'Costs are estimates from catalog pricing; providers bill independently. Tokens may be estimated when a provider does not report usage.',
      ),
    );
  });
}

async function limits(
  options: { all?: boolean; json?: boolean; clear?: string; model?: string } = {},
): Promise<void> {
  await withStore(({ store }) => {
    if (options.clear) {
      const profile = resolveProfile(store, options.clear);
      if (options.model) {
        store.clearLimit(profile.id, options.model);
        console.log(`${success('✔')} Cleared limit for ${profile.name}/${options.model}.`);
      } else {
        const existing = store.listLimits(true).filter((limit) => limit.profileId === profile.id);
        for (const limit of existing) store.clearLimit(profile.id, limit.modelId);
        console.log(
          `${success('✔')} Cleared ${existing.length} limit${existing.length === 1 ? '' : 's'} for ${profile.name}.`,
        );
      }
      return;
    }
    const records = store.listLimits(!options.all);
    if (options.json) {
      jsonOut(records);
      return;
    }
    printSection(options.all ? 'All provider limits' : 'Active provider limits');
    if (records.length === 0) {
      console.log(dim('No active limits.'));
      return;
    }
    printTable(
      ['PROFILE', 'MODEL', 'CATEGORY', 'RESET', 'UPDATED', 'ATTEMPTS', 'MESSAGE'],
      records.map((limit) => [
        store.getProfile(limit.profileId)?.name ?? dim('removed'),
        limit.modelId,
        describeCategory(limit.category),
        formatDateTime(limit.resetAt ?? limit.retryAfterAt),
        formatDateTime(limit.updatedAt),
        String(limit.attempts),
        truncate(limit.message ?? '—', 44),
      ]),
    );
    console.log('');
    console.log(
      dim(`Clear a stale limit with ${bold('comicode limits --clear <profile> [--model <id>]')}.`),
    );
    void warning;
    void danger;
  });
}

export function registerUsageCommands(program: Command): void {
  program
    .command('usage')
    .description('Show token usage, cost estimates, and active provider limits')
    .option('--today', 'only today')
    .option('--days <number>', 'rolling window in days')
    .option('--all', 'all time (default)')
    .option('--json', 'machine-readable output')
    .action(async (options) => {
      await usage(options);
    });

  program
    .command('limits')
    .description('Show or clear provider/reset limits')
    .option('--all', 'include expired limits')
    .option('--clear <profile>', 'clear limits for a profile')
    .option('--model <model>', 'limit clearing to one model id')
    .option('--json', 'machine-readable output')
    .action(async (options) => {
      await limits(options);
    });
}
