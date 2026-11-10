import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Command } from 'commander';
import type { AppSettings } from '../../core/settings.js';
import { DEFAULT_SETTINGS, SETTING_PATHS, parseSettings } from '../../core/settings.js';
import { exportProviders, importProviders } from '../../core/providers/service.js';
import { getComicodeHome } from '../../core/paths.js';
import {
  bold,
  danger,
  dim,
  jsonOut,
  printKeyValue,
  printSection,
  printTable,
  success,
  warning,
} from '../output.js';
import { isInteractive, promptConfirm } from '../prompt.js';
import { resolveProfile, withStore } from '../shared.js';

function getPath(settings: AppSettings, path: string): unknown {
  return path.split('.').reduce<unknown>((current, key) => {
    if (current && typeof current === 'object') {
      return (current as Record<string, unknown>)[key];
    }
    return undefined;
  }, settings);
}

function setPath(settings: AppSettings, path: string, value: unknown): void {
  const parts = path.split('.');
  let current = settings as unknown as Record<string, unknown>;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const key = parts[index]!;
    const next = current[key];
    if (!next || typeof next !== 'object') {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]!] = value;
}

function parseSettingValue(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed === 'null') return null;
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === '[]') return [];
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      return JSON.parse(trimmed) as unknown;
    } catch (error) {
      throw new Error(
        `Invalid JSON value: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (trimmed.includes(',')) {
    return trimmed
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return raw;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return dim('null');
  if (typeof value === 'boolean') return value ? success('true') : warning('false');
  if (Array.isArray(value)) return value.length ? value.join(', ') : dim('(empty)');
  return String(value);
}

async function showSettings(options: { json?: boolean }): Promise<void> {
  await withStore(({ store }) => {
    const settings = store.getSettings();
    if (options.json) {
      jsonOut(settings);
      return;
    }
    printSection('Routing policy');
    printTable(
      ['SETTING', 'VALUE'],
      [
        ['preferFree', formatValue(settings.routing.preferFree)],
        ['preferSameProvider', formatValue(settings.routing.preferSameProvider)],
        ['preferCoding', formatValue(settings.routing.preferCoding)],
        ['allowPaid', formatValue(settings.routing.allowPaid)],
        ['allowUnknownAccess', formatValue(settings.routing.allowUnknownAccess)],
        ['maxFallbacks', formatValue(settings.routing.maxFallbacks)],
        ['maxRetriesPerCandidate', formatValue(settings.routing.maxRetriesPerCandidate)],
        ['retryBaseDelayMs', formatValue(settings.routing.retryBaseDelayMs)],
        ['retryMaxDelayMs', formatValue(settings.routing.retryMaxDelayMs)],
        ['minContextWindow', formatValue(settings.routing.minContextWindow)],
        ['preferredProviders', formatValue(settings.routing.preferredProviders)],
        ['excludedProviders', formatValue(settings.routing.excludedProviders)],
      ],
    );
    printSection('Agent');
    printTable(
      ['SETTING', 'VALUE'],
      [
        ['maxSteps', formatValue(settings.agent.maxSteps)],
        ['contextBudgetRatio', formatValue(settings.agent.contextBudgetRatio)],
        ['maxToolOutputChars', formatValue(settings.agent.maxToolOutputChars)],
        ['autoApproveReadOnly', formatValue(settings.agent.autoApproveReadOnly)],
        ['autoApproveFileEdits', formatValue(settings.agent.autoApproveFileEdits)],
        ['autoApproveCommands', formatValue(settings.agent.autoApproveCommands)],
        ['allowSecretAccess', formatValue(settings.agent.allowSecretAccess)],
        ['testCommand', formatValue(settings.agent.testCommand)],
        ['lintCommand', formatValue(settings.agent.lintCommand)],
        ['buildCommand', formatValue(settings.agent.buildCommand)],
        ['collaboration.enabled', formatValue(settings.agent.collaboration.enabled)],
        [
          'collaboration.plannerProfileId',
          formatValue(settings.agent.collaboration.plannerProfileId),
        ],
        [
          'collaboration.reviewerProfileId',
          formatValue(settings.agent.collaboration.reviewerProfileId),
        ],
        ['collaboration.reviewChanges', formatValue(settings.agent.collaboration.reviewChanges)],
      ],
    );
    printSection('Interface');
    printKeyValue([
      ['theme', settings.theme],
      ['accent', settings.accent],
      ['telemetry', 'disabled (always)'],
      ['database', store.path],
    ]);
    console.log('');
    console.log(dim(`Set a value with ${bold('comicode settings set <path> <value>')}.`));
    console.log(dim(`Available paths: ${SETTING_PATHS.join(', ')}`));
  });
}

async function getSetting(path: string, options: { json?: boolean }): Promise<void> {
  await withStore(({ store }) => {
    const settings = store.getSettings();
    const value = getPath(settings, path);
    if (value === undefined) {
      throw new Error(`Unknown setting path "${path}". Run "comicode settings" to list paths.`);
    }
    if (options.json) jsonOut({ path, value });
    else console.log(`${path} = ${formatValue(value)}`);
  });
}

async function setSetting(path: string, rawValue: string): Promise<void> {
  const allowed = SETTING_PATHS as readonly string[];
  if (!allowed.includes(path)) {
    throw new Error(`Unknown setting path "${path}". Available paths:\n  ${allowed.join('\n  ')}`);
  }
  await withStore(({ store }) => {
    let value = parseSettingValue(rawValue);
    if (path.endsWith('ProfileId')) {
      if (value === null || value === '') {
        value = null;
      } else if (typeof value === 'string') {
        const profile = resolveProfile(store, value);
        value = profile.id;
      }
    }
    const current = store.getSettings();
    const candidate = JSON.parse(JSON.stringify(current)) as AppSettings;
    setPath(candidate, path, value);
    let validated: AppSettings;
    try {
      validated = parseSettings(candidate);
    } catch (error) {
      throw new Error(
        `Invalid value for ${path}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    store.saveSettings(validated);
    console.log(`${success('✔')} ${path} = ${formatValue(getPath(validated, path))}`);
    if (path === 'routing.allowPaid' && validated.routing.allowPaid) {
      console.log(
        warning(
          'Paid fallbacks are now allowed. Explicit selections were always honored; use --allow-paid for a one-run override.',
        ),
      );
    }
  });
}

async function resetSettings(options: { yes?: boolean }): Promise<void> {
  await withStore(async ({ store }) => {
    if (!options.yes) {
      if (!isInteractive())
        throw new Error('Resetting settings requires --yes in non-interactive mode.');
      const confirmed = await promptConfirm(
        'Reset all settings to defaults? Task history is preserved.',
        false,
      );
      if (!confirmed) {
        console.log(dim('Cancelled.'));
        return;
      }
    }
    store.saveSettings(DEFAULT_SETTINGS);
    console.log(`${success('✔')} Settings reset to defaults.`);
  });
}

interface ConfigBundle {
  version: 1;
  exportedAt: string;
  settings: AppSettings;
  profiles: ReturnType<typeof exportProviders>['profiles'];
}

async function exportConfig(file: string | undefined): Promise<void> {
  await withStore(({ store }) => {
    const bundle: ConfigBundle = {
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: store.getSettings(),
      profiles: exportProviders(store).profiles,
    };
    const text = `${JSON.stringify(bundle, null, 2)}\n`;
    if (file) {
      const path = resolve(process.cwd(), file);
      writeFileSync(path, text, 'utf8');
      console.log(`${success('✔')} Exported configuration to ${path}.`);
      console.log(dim('Credentials are never included. API keys must be re-added after import.'));
    } else {
      process.stdout.write(text);
    }
  });
}

async function importConfig(file: string): Promise<void> {
  const path = resolve(process.cwd(), file);
  if (!existsSync(path)) throw new Error(`File not found: ${path}`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch (error) {
    throw new Error(`Invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  await withStore(({ store }) => {
    const record = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    if (record.settings) {
      store.saveSettings(parseSettings(record.settings));
      console.log(`${success('✔')} Imported settings.`);
    }
    if (record.profiles) {
      const summary = importProviders(store, {
        version: 1,
        profiles: record.profiles,
      });
      console.log(
        `${success('✔')} Imported profiles: ${summary.created} created, ${summary.updated} updated, ${summary.skipped} skipped.`,
      );
      for (const item of summary.warnings) console.log(`${warning('!')} ${item}`);
    }
    if (!record.settings && !record.profiles) {
      throw new Error('This file does not contain settings or profiles.');
    }
    console.log(dim('Re-add API keys with "comicode auth set <profile>".'));
  });
}

export function registerSettingsCommands(program: Command): void {
  const settings = program
    .command('settings')
    .description('Show and change routing, agent, and interface settings')
    .option('--json', 'machine-readable output')
    .action(async (options) => {
      await showSettings(options);
    });

  settings
    .command('list')
    .description('Show all settings')
    .option('--json', 'machine-readable output')
    .action(async (options) => {
      await showSettings(options);
    });

  settings
    .command('get <path>')
    .description('Read one setting')
    .option('--json', 'machine-readable output')
    .action(async (path: string, options) => {
      await getSetting(path, options);
    });

  settings
    .command('set <path> <value>')
    .description('Set one setting')
    .action(async (path: string, value: string) => {
      await setSetting(path, value);
    });

  settings
    .command('reset')
    .description('Reset settings to defaults')
    .option('--yes', 'do not prompt for confirmation')
    .action(async (options) => {
      await resetSettings(options);
    });

  const config = program
    .command('config')
    .description('Export or import configuration (never credentials)');

  config
    .command('export [file]')
    .description('Export settings and provider profiles')
    .action(async (file: string | undefined) => {
      await exportConfig(file);
    });

  config
    .command('import <file>')
    .description('Import settings and provider profiles')
    .action(async (file: string) => {
      await importConfig(file);
    });

  config
    .command('path')
    .description('Show the ComiCode data directory')
    .action(() => {
      console.log(getComicodeHome());
    });

  config
    .command('show')
    .description('Show the active configuration')
    .action(async () => {
      await showSettings({ json: true });
    });

  void danger;
}
