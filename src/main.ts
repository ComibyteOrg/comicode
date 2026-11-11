import { Command, Option } from 'commander';
import { stdin, stdout } from 'node:process';
import type { AgentResult } from './core/agent/types.js';
import { VERSION } from './version.js';
import { registerProviderCommands } from './cli/commands/providers.js';
import { registerModelCommands } from './cli/commands/models.js';
import { registerTaskCommands } from './cli/commands/tasks.js';
import { registerUsageCommands } from './cli/commands/usage.js';
import { registerSettingsCommands } from './cli/commands/settings.js';
import { registerSystemCommands } from './cli/commands/system.js';
import {
  createTaskForRequest,
  normalizeTaskType,
  printResumeHint,
  resolveModel,
  resolveProfile,
  resultExitCode,
  runTask,
  withStore,
  type AuthorityOptions,
} from './cli/shared.js';
import { bold, danger, dim } from './cli/output.js';
import { isInteractive, promptText } from './cli/prompt.js';
import type { TaskRecord } from './core/types.js';

interface RunFlags extends AuthorityOptions {
  profile?: string;
  model?: string;
  type?: string;
  maxSteps?: string;
  json?: boolean;
  resume?: boolean;
}

function authorityFlags(command: Command): Command {
  return command
    .option('--yes', 'approve file edits without prompting')
    .option('--allow-commands', 'allow running shell commands')
    .option('--allow-dangerous-commands', 'allow risky shell commands (also required for them)')
    .option('--allow-secrets', 'allow reading protected/secret files')
    .option('--allow-paid', 'allow paid fallback models for this run only');
}

function maxSteps(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 200) {
    throw new Error('--max-steps must be an integer between 1 and 200.');
  }
  return parsed;
}

function selectedModelReference(
  store: Parameters<typeof resolveModel>[0],
  flags: RunFlags,
): { profileId: string | null; modelId: string | null; profileName: string | null } {
  const profile = flags.profile ? resolveProfile(store, flags.profile) : null;
  if (flags.model) {
    const resolved = resolveModel(store, flags.model, flags.profile);
    return {
      profileId: resolved.profile.id,
      modelId: resolved.model.modelId,
      profileName: resolved.profile.name,
    };
  }
  if (profile) {
    return {
      profileId: profile.id,
      modelId: profile.defaultModel,
      profileName: profile.name,
    };
  }
  return { profileId: null, modelId: null, profileName: null };
}

function reportResult(result: AgentResult): void {
  printResumeHint(result);
  process.exitCode = resultExitCode(result);
}

async function runCommand(parts: string[], flags: RunFlags): Promise<void> {
  const request = parts.join(' ').trim();
  if (!request) {
    throw new Error('Provide a request. Example: comicode run "fix the failing tests"');
  }
  await withStore(async ({ store, cwd }) => {
    const target = selectedModelReference(store, flags);
    const task = createTaskForRequest(store, cwd, request, {
      taskType: normalizeTaskType(flags.type),
      profileId: target.profileId,
      modelId: target.modelId,
    });
    if (flags.json) {
      reportResult(await runTask(store, task.id, { ...flags, maxSteps: maxSteps(flags.maxSteps) }));
      return;
    }
    console.log('');
    console.log(`${bold('COMICODE')} ${dim(`task ${task.id.slice(0, 8)} · ${cwd}`)}`);
    console.log(dim(`request: ${request}`));
    reportResult(await runTask(store, task.id, { ...flags, maxSteps: maxSteps(flags.maxSteps) }));
  });
}

async function resumeCommand(reference: string | undefined, flags: RunFlags): Promise<void> {
  await withStore(async ({ store, cwd }) => {
    const tasks = store.listTasks({ limit: 1000 });
    let exact: TaskRecord | null = null;
    if (reference) {
      exact =
        tasks.find((task) => task.id === reference) ??
        (() => {
          const matches = tasks.filter((task) => task.id.startsWith(reference));
          if (matches.length === 1) return matches[0]!;
          if (matches.length > 1) throw new Error(`Task id "${reference}" is ambiguous.`);
          return null;
        })();
    } else {
      exact =
        tasks.find(
          (task) =>
            task.projectPath === cwd && (task.status === 'paused' || task.status === 'failed'),
        ) ??
        tasks.find((task) => task.status === 'paused' || task.status === 'failed') ??
        null;
      if (!exact) {
        throw new Error('No paused or interrupted task found to resume.');
      }
    }
    if (!exact) throw new Error(`Task not found: ${reference}`);
    if (exact.status === 'completed') {
      throw new Error('This task is already completed. Start a new task instead.');
    }
    if (exact.status === 'cancelled') {
      throw new Error('This task was cancelled and cannot be resumed. Start a new task instead.');
    }
    if (!flags.json) {
      console.log('');
      console.log(
        `${bold('COMICODE')} ${dim(`resume ${exact.id.slice(0, 8)} · ${exact.projectPath}`)}`,
      );
      console.log(dim(`request: ${exact.userRequest}`));
    }
    reportResult(
      await runTask(store, exact.id, {
        ...flags,
        resume: true,
        maxSteps: maxSteps(flags.maxSteps),
      }),
    );
  });
}

async function launchChat(flags: RunFlags): Promise<void> {
  if (!isInteractive()) {
    throw new Error(
      'The chat REPL requires an interactive terminal. Use "comicode run" for scripts.',
    );
  }
  await withStore(async ({ store, cwd }) => {
    const target = selectedModelReference(store, flags);
    const taskType = normalizeTaskType(flags.type);
    let task: TaskRecord | null = null;
    console.log('');
    console.log(
      `${bold('COMICODE')} ${dim('chat · /exit to quit, /new to start a fresh task, /tasks to list')}`,
    );
    const request = await promptText('You', { required: true });
    if (!request.trim() || request.trim() === '/exit') return;
    task = createTaskForRequest(store, cwd, request, {
      taskType,
      profileId: target.profileId,
      modelId: target.modelId,
    });
    let result = await runTask(store, task.id, { ...flags, maxSteps: maxSteps(flags.maxSteps) });
    while (result.status === 'completed') {
      const next = await promptText('You', { allowEmpty: true, defaultValue: '/exit' });
      const trimmed = next.trim();
      if (!trimmed || trimmed === '/exit' || trimmed === '/quit') break;
      if (trimmed === '/new') {
        const fresh = await promptText('New task', { required: true });
        task = createTaskForRequest(store, cwd, fresh, {
          taskType,
          profileId: target.profileId,
          modelId: target.modelId,
        });
      } else if (trimmed === '/tasks') {
        for (const entry of store.listTasks({ projectPath: cwd, limit: 10 })) {
          console.log(
            dim(`  ${entry.id.slice(0, 8)}  ${entry.status}  ${entry.userRequest.slice(0, 60)}`),
          );
        }
        continue;
      } else {
        if (!task) break;
        store.appendMessage(task.id, { role: 'user', content: trimmed });
        store.updateTask(task.id, {
          status: 'running',
          phase: 'implement',
          completedAt: null,
        });
      }
      result = await runTask(store, task.id, { ...flags, maxSteps: maxSteps(flags.maxSteps) });
    }
    if (result.status === 'paused') printResumeHint(result);
  });
}

export function buildProgram(): Command {
  const program = new Command();
  program
    .name('comicode')
    .description('Multi-provider AI coding agent with quota-aware routing and persistent tasks')
    .version(VERSION, '-v, --version', 'print the ComiCode version')
    .showHelpAfterError()
    .configureHelp({ sortSubcommands: true });

  program
    .command('run <request...>')
    .description('Run a coding task in the current project')
    .option('-p, --profile <profile>', 'provider profile to start with')
    .option('-m, --model <model>', 'model to start with (explicit selections are honored)')
    .option('-t, --type <type>', 'coding, reasoning, review, vision, or general', 'coding')
    .option('--max-steps <number>', 'maximum agent steps for this run')
    .option('--json', 'emit a single JSON result instead of streaming output')
    .action(async (parts: string[], flags: RunFlags) => {
      await runCommand(parts, flags);
    });

  program
    .command('task <request...>')
    .description('Run a coding task in the current project (alias for run)')
    .option('-p, --profile <profile>', 'provider profile to start with')
    .option('-m, --model <model>', 'model to start with (explicit selections are honored)')
    .option('-t, --type <type>', 'coding, reasoning, review, vision, or general', 'coding')
    .option('--max-steps <number>', 'maximum agent steps for this run')
    .option('--json', 'emit a single JSON result instead of streaming output')
    .action(async (parts: string[], flags: RunFlags) => {
      await runCommand(parts, flags);
    });

  program
    .command('resume [task]')
    .description('Resume a paused or interrupted task')
    .option('--max-steps <number>', 'maximum agent steps for this run')
    .option('--json', 'emit a single JSON result instead of streaming output')
    .action(async (reference: string | undefined, flags: RunFlags) => {
      await resumeCommand(reference, flags);
    });

  program
    .command('connect')
    .description('Connect an AI provider profile (interactive or flagged)')
    .option('--provider <kind>', 'gemini, groq, openrouter, openai, or custom')
    .option('--name <name>', 'profile name')
    .option('--api-key <key>', 'API key')
    .option('--base-url <url>', 'API base URL')
    .action(async (options) => {
      const { addProvider } = await import('./cli/commands/providers.js');
      await addProvider(options);
    });

  program
    .command('status')
    .description('Show provider, quota, model, and git status')
    .option('--json', 'machine-readable output')
    .action(async (options: { json?: boolean }) => {
      await withStore(async ({ store, cwd }) => {
        const { gitSummary } = await import('./core/git/repository.js');
        const { jsonOut, printKeyValue, printSection, success, warning, danger } =
          await import('./cli/output.js');
        const profiles = store.listProfiles();
        const activeProfileId = store.getSelectedProfileId();
        const activeModelId = store.getSelectedModelId();
        const limits = store.listLimits(true);
        const settings = store.getSettings();
        const git = await gitSummary(cwd);

        if (options.json) {
          jsonOut({
            selectedProfileId: activeProfileId,
            selectedModelId: activeModelId,
            profiles,
            limits,
            allowPaid: settings.routing.allowPaid,
            git,
          });
          return;
        }

        printSection('ComiCode Status');
        const activeProfile = profiles.find((p) => p.id === activeProfileId);
        printKeyValue([
          ['Selected Profile', activeProfile ? activeProfile.name : dim('(none selected)')],
          ['Selected Model', activeModelId ?? dim('(provider default)')],
          [
            'Paid Fallbacks',
            settings.routing.allowPaid ? warning('enabled') : success('disabled (free only)'),
          ],
          ['Connected Profiles', `${profiles.length} connected`],
          [
            'Active Limits',
            limits.length === 0 ? success('none') : danger(`${limits.length} active limits`),
          ],
          [
            'Git Repository',
            git.repository
              ? git.clean
                ? success(`clean (⎇ ${git.branch ?? 'HEAD'})`)
                : warning(`modified (⎇ ${git.branch ?? 'HEAD'}, ${git.files.length} changed)`)
              : dim('not a git repository'),
          ],
        ]);
      });
    });

  program
    .command('chat')
    .description('Start a multi-turn coding conversation in this project')
    .option('-p, --profile <profile>', 'provider profile to start with')
    .option('-m, --model <model>', 'model to start with')
    .option('-t, --type <type>', 'coding, reasoning, review, vision, or general', 'coding')
    .option('--max-steps <number>', 'maximum agent steps per turn')
    .action(async (flags: RunFlags) => {
      await launchChat(flags);
    });

  for (const command of program.commands) {
    if (['run', 'task', 'resume', 'chat'].includes(command.name())) authorityFlags(command);
  }

  registerProviderCommands(program);
  registerModelCommands(program);
  registerTaskCommands(program);
  registerUsageCommands(program);
  registerSettingsCommands(program);
  registerSystemCommands(program);

  program
    .command('bench')
    .description('Run honest micro-benchmarks (startup, memory, context build, tokens)')
    .option('-n, --iterations <number>', 'samples per metric', '5')
    .action(async (options: { iterations?: string }) => {
      const iterations = Math.max(1, Math.min(50, Number(options.iterations) || 5));
      const { runBenchmarks } = await import('./core/bench.js');
      const results = await runBenchmarks(process.cwd(), iterations);
      const width = Math.max(...results.map((r) => r.metric.length));
      for (const result of results) {
        console.log(`${result.metric.padEnd(width)}  ${String(result.value).padStart(10)} ${result.unit}`);
      }
    });

  program
    .command('completion')
    .description('Print shell completion instructions')
    .addOption(new Option('--shell <shell>', 'bash, zsh, or fish').choices(['bash', 'zsh', 'fish']))
    .action((options: { shell?: string }) => {
      const shell = options.shell ?? 'bash';
      console.log(dim('Shell completion is advisory; generate it from the command list:'));
      console.log(`${bold('comicode')} --help | awk '/^  [a-z]/ {print $1}' # ${shell}`);
    });

  program.action(async () => {
    if (!stdin.isTTY || !stdout.isTTY) {
      program.outputHelp();
      return;
    }
    const { runTui } = await import('./tui/app.js');
    await runTui();
  });

  return program;
}

export async function main(argv: string[] = process.argv): Promise<void> {
  const program = buildProgram();
  try {
    await program.parseAsync(argv);
  } catch (error) {
    if (error instanceof Error && /process\.exit|commander\.exit/i.test(error.name)) throw error;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`${danger('comicode:')} ${message}`);
    if (process.env.COMICODE_DEBUG) {
      console.error(error instanceof Error ? (error.stack ?? '') : '');
    }
    process.exitCode = 1;
  }
}
