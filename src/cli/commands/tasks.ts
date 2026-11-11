import type { Command } from 'commander';
import type { TaskRecord, TaskStatus } from '../../core/types.js';
import { providerDisplayName } from '../../core/providers/definitions.js';
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
  statusLabel,
  success,
  truncate,
  warning,
} from '../output.js';
import { isInteractive, promptConfirm } from '../prompt.js';
import { taskTitle, withStore } from '../shared.js';

function resolveTaskId(tasks: TaskRecord[], reference: string): TaskRecord {
  const trimmed = reference.trim();
  const exact = tasks.find((task) => task.id === trimmed);
  if (exact) return exact;
  const prefix = tasks.filter((task) => task.id.startsWith(trimmed));
  if (prefix.length === 1) return prefix[0]!;
  if (prefix.length > 1) {
    throw new Error(`Task id "${reference}" is ambiguous. Use more characters.`);
  }
  throw new Error(`Task not found: ${reference}`);
}

interface TaskListOptions {
  all?: boolean;
  status?: string;
  limit?: string;
  json?: boolean;
  project?: string;
}

function listTasks(options: TaskListOptions): Promise<void> {
  return withStore(({ store, cwd }) => {
    const statuses = options.status
      ? (options.status.split(',').map((entry) => entry.trim()) as TaskStatus[])
      : undefined;
    const tasks = store.listTasks({
      projectPath: options.all ? undefined : (options.project ?? cwd),
      statuses,
      limit: options.limit ? Number(options.limit) : 30,
    });
    if (options.json) {
      jsonOut(tasks);
      return;
    }
    printSection('Tasks');
    console.log(
      dim(
        `${tasks.length} shown${options.all ? ' across all projects' : ` for ${options.project ?? cwd}`}`,
      ),
    );
    printTable(
      ['ID', 'STATUS', 'PHASE', 'UPDATED', 'MODEL', 'REQUEST'],
      tasks.map((task) => [
        task.id.slice(0, 8),
        statusLabel(task.status),
        task.phase,
        formatDateTime(task.updatedAt),
        task.currentModelId ?? '—',
        truncate(taskTitle(task), 52),
      ]),
    );
    if (tasks.length === 0) {
      console.log('');
      console.log(
        `Start a task with ${bold('comicode run "<request>"')} or the interactive ${bold('comicode')} UI.`,
      );
    }
  });
}

function showTask(
  reference: string,
  options: { messages?: boolean; json?: boolean; limit?: string },
): Promise<void> {
  return withStore(({ store }) => {
    const task = resolveTaskId(store.listTasks({ limit: 1000 }), reference);
    if (options.json) {
      jsonOut({
        task,
        messages: options.messages
          ? store.loadStoredMessages(task.id, Number(options.limit ?? 100))
          : undefined,
        checkpoints: store.listCheckpoints(task.id, 10),
      });
      return;
    }
    printSection('Task');
    printKeyValue([
      ['ID', task.id],
      ['Project', `${task.projectName} (${task.projectPath})`],
      ['Status', statusLabel(task.status)],
      ['Phase', task.phase],
      ['Type', task.taskType],
      ['Created', formatDateTime(task.createdAt)],
      ['Updated', formatDateTime(task.updatedAt)],
      ['Completed', formatDateTime(task.completedAt)],
      ['Resumes', String(task.resumeCount)],
      ['Model', `${task.currentProfileId ?? '—'} / ${task.currentModelId ?? '—'}`],
      ['Checkpoint', task.lastCheckpointId ?? '—'],
    ]);
    printSection('Request');
    console.log(task.userRequest);
    if (task.plan) {
      printSection(`Plan: ${task.plan.summary}`);
      for (const step of task.plan.steps) {
        console.log(`  [${step.status}] ${step.title}`);
      }
    }
    if (task.changedFiles.length) {
      printSection('Changed files');
      for (const file of task.changedFiles) console.log(`  ${file}`);
    }
    if (task.attempts.length) {
      printSection('Attempts');
      printTable(
        ['WHEN', 'PROFILE', 'MODEL', 'CATEGORY'],
        task.attempts
          .slice(-15)
          .map((attempt) => [
            formatDateTime(attempt.at),
            store.getProfile(attempt.profileId)?.name ?? attempt.profileId.slice(0, 8),
            attempt.modelId,
            attempt.category,
          ]),
      );
    }
    if (task.summary) {
      printSection('Summary');
      console.log(task.summary);
    }
    if (task.error) {
      printSection('Error');
      console.log(danger(task.error));
    }
    if (options.messages) {
      printSection('Messages');
      const messages = store.loadStoredMessages(task.id, Number(options.limit ?? 60));
      for (const message of messages) {
        const label =
          message.role === 'assistant'
            ? bold('assistant')
            : message.role === 'user'
              ? success('user')
              : message.role === 'tool'
                ? dim(`tool:${message.name ?? 'tool'}`)
                : dim(message.role);
        if (message.toolCalls?.length) {
          console.log(
            `\n${label} ${dim(`[calls: ${message.toolCalls.map((call) => call.name).join(', ')}]`)}`,
          );
        } else {
          console.log(`\n${label}${message.isError ? danger(' (error)') : ''}`);
        }
        console.log(truncate(message.content, 1200));
      }
    }
  });
}

function listCheckpoints(reference: string, options: { json?: boolean }): Promise<void> {
  return withStore(({ store }) => {
    const task = resolveTaskId(store.listTasks({ limit: 1000 }), reference);
    const checkpoints = store.listCheckpoints(task.id, 50);
    if (options.json) {
      jsonOut(checkpoints);
      return;
    }
    printSection(`Checkpoints for ${task.id.slice(0, 8)}`);
    printTable(
      ['SEQ', 'CREATED', 'MESSAGES', 'SUMMARY'],
      checkpoints.map((checkpoint) => [
        String(checkpoint.seq),
        formatDateTime(checkpoint.createdAt),
        String(checkpoint.state.messages?.length ?? 0),
        truncate(checkpoint.state.summary ?? '—', 60),
      ]),
    );
  });
}

async function deleteTask(reference: string, options: { yes?: boolean }): Promise<void> {
  await withStore(async ({ store }) => {
    const task = resolveTaskId(store.listTasks({ limit: 1000 }), reference);
    if (!options.yes) {
      if (!isInteractive())
        throw new Error('Deleting a task requires --yes in non-interactive mode.');
      const confirmed = await promptConfirm(
        `Delete task ${task.id.slice(0, 8)} ("${taskTitle(task)}") and its history?`,
        false,
      );
      if (!confirmed) {
        console.log(dim('Cancelled.'));
        return;
      }
    }
    store.deleteTask(task.id);
    console.log(`${success('✔')} Deleted task ${task.id.slice(0, 8)}.`);
  });
}

function history(options: {
  routing?: boolean;
  limit?: string;
  json?: boolean;
  all?: boolean;
}): Promise<void> {
  return withStore(({ store, cwd }) => {
    const limit = options.limit ? Number(options.limit) : 40;
    if (options.routing) {
      const events = store.listRoutingEvents(limit);
      if (options.json) {
        jsonOut(events);
        return;
      }
      printSection('Routing events');
      printTable(
        ['WHEN', 'TASK', 'FROM', 'TO', 'REASON'],
        events.map((event) => [
          formatDateTime(event.createdAt),
          event.taskId ? event.taskId.slice(0, 8) : '—',
          `${event.fromProfileId ? (store.getProfile(event.fromProfileId)?.name ?? event.fromProfileId.slice(0, 6)) : '—'}/${event.fromModelId ?? '—'}`,
          `${event.toProfileId ? (store.getProfile(event.toProfileId)?.name ?? event.toProfileId.slice(0, 6)) : '—'}/${event.toModelId ?? '—'}`,
          truncate(event.reason, 50),
        ]),
      );
      return;
    }
    const tasks = store.listTasks({
      projectPath: options.all ? undefined : cwd,
      limit,
    });
    if (options.json) {
      jsonOut(tasks);
      return;
    }
    printSection('History');
    printTable(
      ['WHEN', 'STATUS', 'PROJECT', 'MODEL', 'REQUEST'],
      tasks.map((task) => [
        formatDateTime(task.updatedAt),
        statusLabel(task.status),
        task.projectName,
        task.currentModelId ?? '—',
        truncate(taskTitle(task), 50),
      ]),
    );
    const totals = store.usageTotals();
    console.log('');
    console.log(
      dim(
        `${formatTokens(totals.inputTokens + totals.outputTokens)} tokens used across ${totals.events} provider calls.`,
      ),
    );
    if (tasks.some((task) => task.status === 'paused')) {
      console.log(warning('Some tasks are paused. Resume with "comicode resume <task-id>".'));
    }
  });
}

function usageSummary(): void {
  console.log(dim('Use "comicode usage" for detailed usage and limits.'));
}

export function registerTaskCommands(program: Command): void {
  const tasks = program.command('tasks').description('Inspect and manage persisted tasks');

  tasks
    .command('list')
    .alias('ls')
    .description('List tasks for the current project')
    .option('--all', 'include tasks from other projects')
    .option('--project <path>', 'filter by project path')
    .option('--status <statuses>', 'comma-separated statuses')
    .option('--limit <number>', 'maximum rows', '30')
    .option('--json', 'machine-readable output')
    .action(async (options) => {
      await listTasks(options);
    });

  tasks
    .command('show <id>')
    .description('Show task details')
    .option('--messages', 'include the stored transcript')
    .option('--limit <number>', 'message limit', '60')
    .option('--json', 'machine-readable output')
    .action(async (reference: string, options) => {
      await showTask(reference, options);
    });

  tasks
    .command('checkpoints <id>')
    .description('List task checkpoints')
    .option('--json', 'machine-readable output')
    .action(async (reference: string, options) => {
      await listCheckpoints(reference, options);
    });

  tasks
    .command('delete <id>')
    .alias('rm')
    .description('Delete a task and its history')
    .option('--yes', 'do not prompt for confirmation')
    .action(async (reference: string, options) => {
      await deleteTask(reference, options);
    });

  program
    .command('history')
    .description('Show task history or routing events')
    .option('--routing', 'show routing events instead of tasks')
    .option('--all', 'include tasks from other projects')
    .option('--limit <number>', 'maximum rows', '40')
    .option('--json', 'machine-readable output')
    .action(async (options) => {
      await history(options);
      if (!options.routing) usageSummary();
      void providerDisplayName;
    });
}
