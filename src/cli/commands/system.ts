import { existsSync, statSync } from 'node:fs';
import type { Command } from 'commander';
import type { ProviderProfile } from '../../core/types.js';
import {
  credentialIdForProfile,
  keysToSecret,
  parseKeyInput,
  testProfileConnection,
} from '../../core/providers/service.js';
import { describeCategory } from '../../core/providers/errors.js';
import { providerDisplayName } from '../../core/providers/definitions.js';
import { getCredentialStore } from '../../core/security/credentials.js';
import { registerSecret } from '../../core/security/redact.js';
import { getComicodeHome, getDatabasePath } from '../../core/paths.js';
import { initProject, readProjectConfig } from '../../core/project/init.js';
import { runProcess } from '../../core/safety/process.js';
import { GITHUB_REPOSITORY, VERSION } from '../../version.js';
import {
  bold,
  danger,
  dim,
  formatDateTime,
  formatRelative,
  jsonOut,
  printKeyValue,
  printSection,
  printTable,
  success,
  truncate,
  warning,
} from '../output.js';
import { isInteractive, promptSecret, promptText } from '../prompt.js';
import { resolveProfile, withStore } from '../shared.js';

function compareVersions(left: string, right: string): number {
  const a = left.split('.').map((part) => Number(part.replace(/\D/g, '')) || 0);
  const b = right.split('.').map((part) => Number(part.replace(/\D/g, '')) || 0);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

async function initCommand(name: string | undefined, options: { json?: boolean }): Promise<void> {
  const cwd = process.cwd();
  const result = await initProject(cwd, name);
  await withStore(({ store }) => {
    // Opening the database here creates the schema and seeds catalogs early.
    void store.stats();
  });
  if (options.json) {
    jsonOut(result);
    return;
  }
  printSection(result.created ? 'Project initialized' : 'Project configuration updated');
  printKeyValue([
    ['Project', result.config.name],
    ['Config', result.configPath],
    ['.gitignore', result.gitignoreUpdated ? success('updated') : dim('already configured')],
    ['Test command', result.config.commands.test ?? dim('(none detected)')],
    ['Lint command', result.config.commands.lint ?? dim('(none detected)')],
    ['Build command', result.config.commands.build ?? dim('(none detected)')],
  ]);
  console.log('');
  console.log(
    dim(
      'The .comicode directory contains local task metadata and is ignored by git. It never stores credentials.',
    ),
  );
  console.log(
    `Next: ${bold('comicode providers add')} then ${bold('comicode')} or ${bold('comicode run "<task>"')}.`,
  );
  if (existsSync(getDatabasePath())) {
    console.log(dim(`Database: ${getDatabasePath()} (${statSync(getDatabasePath()).size} bytes)`));
  }
}

async function credentialState(profile: ProviderProfile): Promise<string> {
  if (profile.apiKeyEnv) {
    return process.env[profile.apiKeyEnv]
      ? success(`env:${profile.apiKeyEnv}`)
      : warning(`env:${profile.apiKeyEnv} (unset)`);
  }
  if (profile.config?.allowNoAuth === true) return dim('no auth');
  const ids = new Set(getCredentialStore().listSecretIds());
  return ids.has(credentialIdForProfile(profile.id)) ? success('stored') : warning('missing');
}

async function authStatus(options: { json?: boolean }): Promise<void> {
  await withStore(async ({ store }) => {
    const backend = await getCredentialStore().describe();
    const profiles = store.listProfiles();
    const rows = await Promise.all(
      profiles.map(async (profile) => ({
        name: profile.name,
        provider: providerDisplayName(profile.providerId),
        state: await credentialState(profile),
        env: profile.apiKeyEnv,
      })),
    );
    if (options.json) {
      jsonOut({ backend, profiles: rows });
      return;
    }
    printSection('Credentials');
    printKeyValue([
      ['Backend', `${backend.label}${backend.secure ? '' : dim(' (fallback)')}`],
      ['Detail', backend.detail],
      ['Storage', getComicodeHome()],
    ]);
    printSection('Profile credentials');
    printTable(
      ['PROFILE', 'PROVIDER', 'CREDENTIAL'],
      rows.map((row) => [row.name, row.provider, row.state]),
    );
    if (profiles.length === 0) {
      console.log(dim('No profiles yet. Add one with "comicode providers add".'));
    }
    console.log('');
    console.log(
      dim(
        'Secrets are stored through the OS credential facility when available, otherwise AES-256-GCM.',
      ),
    );
  });
}

async function authSet(
  reference: string | undefined,
  options: { key?: string; test?: boolean },
): Promise<void> {
  await withStore(async ({ store }) => {
    const profile = resolveProfile(store, reference);
    let key = options.key?.trim() ?? '';
    if (!key) {
      if (!isInteractive()) {
        throw new Error(
          'Provide --key in non-interactive mode, or set an environment variable with --api-key-env.',
        );
      }
      key = (
        await promptSecret(
          `API key(s) for ${profile.name}, comma-separated for multiple (input is hidden)`,
        )
      ).trim();
    }
    const keys = parseKeyInput(key);
    if (keys.length === 0) throw new Error('The API key cannot be empty.');
    for (const entry of keys) registerSecret(entry);
    await getCredentialStore().setSecret(credentialIdForProfile(profile.id), keysToSecret(keys));
    store.updateProfile(profile.id, { apiKeyEnv: null, lastError: null, lastErrorAt: null });
    store.clearLimit(profile.id, '*');
    console.log(
      `${success('✔')} Stored ${keys.length} API key${keys.length === 1 ? '' : 's'} for ${profile.name}.`,
    );
    if (options.test) {
      const fresh = store.getProfile(profile.id);
      if (fresh) {
        const result = await testProfileConnection(store, fresh);
        console.log(
          result.ok
            ? `${success('✔')} ${result.message} ${dim(`(${result.latencyMs}ms)`)}`
            : `${danger('✖')} ${result.message} (${result.category ?? 'unknown'})`,
        );
        if (!result.ok) process.exitCode = 1;
      }
    }
  });
}

async function authRemove(reference: string | undefined): Promise<void> {
  await withStore(async ({ store }) => {
    const profile = resolveProfile(store, reference);
    await getCredentialStore().deleteSecret(credentialIdForProfile(profile.id));
    console.log(`${success('✔')} Removed the stored credential for ${profile.name}.`);
  });
}

async function authBackend(options: { json?: boolean }): Promise<void> {
  const backend = await getCredentialStore().describe();
  if (options.json) {
    jsonOut(backend);
    return;
  }
  printKeyValue([
    ['Backend', backend.label],
    ['Secure', backend.secure ? success('yes') : warning('fallback')],
    ['Detail', backend.detail],
    ['Secrets indexed', String(getCredentialStore().listSecretIds().length)],
  ]);
}

async function doctor(options: { json?: boolean; test?: boolean }): Promise<number> {
  return withStore(async ({ store, cwd }) => {
    const warnings: string[] = [];
    const errors: string[] = [];
    const stats = store.stats();
    const backend = await getCredentialStore().describe();
    const git = await runProcess('git', ['--version'], { timeoutMs: 8000, maxOutputBytes: 2000 });
    const nodeOk = compareVersions(process.version.replace(/^v/, ''), '22.5.0') >= 0;
    if (!nodeOk) errors.push('Node.js 22.5 or newer is required for node:sqlite.');
    if (!backend.secure) {
      warnings.push(
        'Credentials use the encrypted-file fallback. Keep the ComiCode data directory private.',
      );
    }
    const profiles = store.listProfiles();
    if (profiles.length === 0) warnings.push('No provider profiles are connected.');
    const selectedProfile = store.getSelectedProfileId();
    const selectedModel = store.getSelectedModelId();
    if (profiles.length > 0 && !selectedProfile) warnings.push('No profile is selected.');
    if (profiles.length > 0 && !selectedModel) {
      warnings.push('No model is selected; the router will use the first enabled profile default.');
    }
    const enabledWithoutModel = profiles.filter(
      (profile) => profile.enabled && !profile.defaultModel,
    );
    for (const profile of enabledWithoutModel) {
      warnings.push(`Profile "${profile.name}" has no default model.`);
    }
    const activeLimits = store.listLimits(true);
    if (activeLimits.length) {
      warnings.push(
        `${activeLimits.length} provider limit${activeLimits.length === 1 ? '' : 's'} active.`,
      );
    }
    const project = readProjectConfig(cwd);
    if (!project) warnings.push('Project state is not initialized. Run "comicode init".');
    const modelCounts = new Map<string, number>();
    for (const model of store.listModels()) {
      modelCounts.set(model.providerId, (modelCounts.get(model.providerId) ?? 0) + 1);
    }

    const results: Array<{ profile: string; ok: boolean; message: string; latencyMs: number }> = [];
    if (options.test) {
      for (const profile of profiles.filter((entry) => entry.enabled)) {
        const result = await testProfileConnection(store, profile);
        results.push({
          profile: profile.name,
          ok: result.ok,
          message: result.message,
          latencyMs: result.latencyMs,
        });
        if (!result.ok) warnings.push(`${profile.name}: ${result.message}`);
      }
    }

    if (options.json) {
      jsonOut({
        version: VERSION,
        node: process.version,
        platform: `${process.platform} ${process.arch}`,
        home: getComicodeHome(),
        database: getDatabasePath(),
        stats,
        credentialBackend: backend,
        git: git.spawnError ? null : git.stdout.trim(),
        project,
        selectedProfile,
        selectedModel,
        profiles: profiles.map((profile) => ({
          name: profile.name,
          provider: profile.providerId,
          enabled: profile.enabled,
          defaultModel: profile.defaultModel,
          lastError: profile.lastError,
        })),
        activeLimits,
        tests: results.length ? results : undefined,
        warnings,
        errors,
      });
      return errors.length ? 1 : 0;
    }

    printSection('ComiCode doctor');
    printKeyValue([
      ['Version', VERSION],
      ['Node', `${process.version}${nodeOk ? '' : danger(' (too old)')}`],
      ['Platform', `${process.platform} ${process.arch}`],
      ['Home', getComicodeHome()],
      ['Database', `${stats.databasePath} (${(stats.databaseBytes / 1024).toFixed(1)} KiB)`],
      ['Credential backend', `${backend.label}${backend.secure ? '' : warning(' (fallback)')}`],
      ['Git', git.spawnError ? danger('not found') : git.stdout.trim()],
      ['Project config', project ? success(project.name) : warning('not initialized')],
      ['Profiles', String(stats.profiles)],
      ['Models', String(stats.models)],
      ['Tasks', `${stats.tasks} total, ${stats.pausedTasks} paused`],
    ]);
    printSection('Profiles');
    if (profiles.length === 0) {
      console.log(dim('None connected.'));
    } else {
      printTable(
        ['PROFILE', 'PROVIDER', 'ENABLED', 'DEFAULT MODEL', 'CREDENTIAL', 'LAST ERROR'],
        await Promise.all(
          profiles.map(async (profile) => [
            profile.name,
            providerDisplayName(profile.providerId),
            profile.enabled ? success('yes') : warning('no'),
            profile.defaultModel ?? '—',
            await credentialState(profile),
            truncate(profile.lastError ?? '—', 40),
          ]),
        ),
      );
    }
    if (results.length) {
      printSection('Connection tests');
      printTable(
        ['PROFILE', 'RESULT', 'LATENCY', 'MESSAGE'],
        results.map((result) => [
          result.profile,
          result.ok ? success('ok') : danger('failed'),
          `${result.latencyMs}ms`,
          truncate(result.message, 60),
        ]),
      );
    }
    if (activeLimits.length) {
      printSection('Active limits');
      for (const limit of activeLimits) {
        const profile = store.getProfile(limit.profileId);
        console.log(
          `  ${profile?.name ?? limit.profileId} / ${limit.modelId}: ${describeCategory(limit.category)} ${
            limit.resetAt || limit.retryAfterAt
              ? `(reset ${formatDateTime(limit.resetAt ?? limit.retryAfterAt)})`
              : '(reset unknown)'
          }`,
        );
      }
    }
    if (warnings.length) {
      printSection('Warnings');
      for (const item of warnings) console.log(`${warning('!')} ${item}`);
    }
    if (errors.length) {
      printSection('Errors');
      for (const item of errors) console.log(`${danger('✖')} ${item}`);
    }
    if (!warnings.length && !errors.length) {
      console.log('');
      console.log(`${success('✔')} Everything looks healthy.`);
    }
    console.log('');
    console.log(dim(`Logs: ${getComicodeHome()}\\logs\\comicode.log · No telemetry is collected.`));
    return errors.length ? 1 : 0;
  });
}

async function dataStats(options: { json?: boolean }): Promise<void> {
  await withStore(({ store }) => {
    const stats = store.stats();
    if (options.json) {
      jsonOut(stats);
      return;
    }
    printKeyValue([
      ['Database', stats.databasePath],
      ['Size', `${(stats.databaseBytes / 1024).toFixed(1)} KiB`],
      ['Profiles', String(stats.profiles)],
      ['Models', String(stats.models)],
      ['Tasks', String(stats.tasks)],
      ['Paused tasks', String(stats.pausedTasks)],
    ]);
  });
}

async function dataDeleteAll(options: { yes?: boolean }): Promise<void> {
  await withStore(async ({ store }) => {
    if (!options.yes) {
      if (!isInteractive()) {
        throw new Error('Deleting all ComiCode data requires --yes in non-interactive mode.');
      }
      const answer = await promptText(
        'This deletes profiles, credentials, tasks, checkpoints, models, usage, and settings. Type DELETE to confirm:',
        { required: true },
      );
      if (answer !== 'DELETE') {
        console.log(dim('Cancelled.'));
        return;
      }
    }
    await getCredentialStore().deleteAllSecrets();
    store.deleteAllData();
    console.log(`${success('✔')} All ComiCode data and stored credentials were deleted.`);
    console.log(dim('Project .comicode directories and log files were left untouched.'));
  });
}

async function dataVacuum(): Promise<void> {
  await withStore(({ store }) => {
    store.db.raw.exec('VACUUM');
    console.log(`${success('✔')} Database vacuumed.`);
  });
}

export function registerSystemCommands(program: Command): void {
  program
    .command('init [name]')
    .description('Initialize ComiCode state for the current project')
    .option('--json', 'machine-readable output')
    .action(async (name: string | undefined, options) => {
      await initCommand(name, options);
    });

  const auth = program.command('auth').description('Manage credentials without exposing them');

  auth
    .command('status')
    .description('Show credential backend and per-profile status')
    .option('--json', 'machine-readable output')
    .action(async (options) => {
      await authStatus(options);
    });

  auth
    .command('set [profile]')
    .description('Store an API key securely for a profile')
    .option('--key <key>', 'API key (prefer interactive input)')
    .option('--test', 'test the connection after storing the key')
    .action(async (reference: string | undefined, options) => {
      await authSet(reference, options);
    });

  auth
    .command('remove [profile]')
    .alias('delete')
    .description('Remove a stored API key')
    .action(async (reference: string | undefined) => {
      await authRemove(reference);
    });

  auth
    .command('backend')
    .description('Show the active credential storage backend')
    .option('--json', 'machine-readable output')
    .action(async (options) => {
      await authBackend(options);
    });

  program
    .command('doctor')
    .description('Diagnose installation, storage, providers, and project state')
    .option('--test', 'test all enabled provider connections')
    .option('--json', 'machine-readable output')
    .action(async (options) => {
      const code = await doctor(options);
      if (code !== 0) process.exitCode = code;
    });

  const data = program.command('data').description('Inspect or delete local ComiCode data');

  data
    .command('stats')
    .description('Show database statistics')
    .option('--json', 'machine-readable output')
    .action(async (options) => {
      await dataStats(options);
    });

  data
    .command('vacuum')
    .description('Compact the SQLite database')
    .action(async () => {
      await dataVacuum();
    });

  data
    .command('delete-all')
    .description('Delete all ComiCode data and credentials (keeps logs and .comicode folders)')
    .option('--yes', 'do not prompt for confirmation')
    .action(async (options) => {
      await dataDeleteAll(options);
    });

  program
    .command('version')
    .description('Print the ComiCode version')
    .action(() => {
      console.log(VERSION);
      console.log(dim('Data directory: ' + getComicodeHome()));
      void formatRelative;
    });

  program
    .command('update')
    .description('Check for a newer ComiCode release and install it globally')
    .option('--check', 'only report whether an update is available')
    .action(async (options: { check?: boolean }) => {
      const repo = GITHUB_REPOSITORY.replace('https://github.com/', '');
      let latest: string | null = null;
      let reachable = false;
      // Prefer the npm registry once published; fall back to GitHub releases/tags.
      try {
        const npmResponse = await fetch('https://registry.npmjs.org/comicode/latest', {
          signal: AbortSignal.timeout(10_000),
        });
        if (npmResponse.ok) {
          reachable = true;
          const body = (await npmResponse.json()) as { version?: string };
          if (body.version) latest = body.version;
        }
      } catch {
        // Registry unreachable — try GitHub below.
      }
      if (!latest) {
        for (const url of [
          `https://api.github.com/repos/${repo}/releases/latest`,
          `https://api.github.com/repos/${repo}/tags?per_page=1`,
        ]) {
          try {
            const response = await fetch(url, {
              headers: {
                'User-Agent': 'comicode',
                Accept: 'application/vnd.github+json',
              },
              signal: AbortSignal.timeout(10_000),
            });
            if (response.status === 404) {
              reachable = true;
              continue;
            }
            if (!response.ok) continue;
            reachable = true;
            const body = (await response.json()) as
              | { tag_name?: string }
              | Array<{ name?: string }>;
            const tag = Array.isArray(body) ? body[0]?.name : body.tag_name;
            if (tag) {
              latest = tag.replace(/^v/, '');
              break;
            }
          } catch {
            // Try the next endpoint, then give up honestly.
          }
        }
      }
      if (!reachable) {
        console.log(warning('Could not reach the update server to check for updates.'));
        return;
      }
      if (!latest) {
        console.log(
          dim(`No published releases found yet — ${VERSION} is as new as it gets.`),
        );
        return;
      }
      if (compareVersions(VERSION, latest) >= 0) {
        console.log(success(`ComiCode ${VERSION} is up to date (latest release: ${latest}).`));
        return;
      }
      console.log(`${warning('Update available')}: ${VERSION} → ${bold(latest)}`);
      if (options.check) {
        console.log(dim(`Run ${bold('comicode update')} to install it.`));
        return;
      }
      const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
      // Install the exact release tag when one exists; fall back to main HEAD.
      const specs = [`github:${repo}#${latest}`, `github:${repo}`];
      let installed = false;
      for (const spec of specs) {
        console.log(dim(`Installing ${spec} …`));
        const result = await runProcess(npmCmd, ['install', '-g', spec], {
          timeoutMs: 600_000,
        });
        if (result.code === 0) {
          installed = true;
          break;
        }
        const tail = result.stderr.trim().split('\n').slice(-3).join('\n');
        if (tail) console.log(dim(tail));
      }
      if (installed) {
        console.log(success(`Updated to ${latest}. Restart ComiCode to use the new version.`));
      } else {
        console.log(
          danger(`Update failed. Run manually: npm install -g github:${repo}`),
        );
      }
    });
}
