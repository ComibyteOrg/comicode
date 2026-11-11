/**
 * Shared command catalog.
 *
 * The terminal UI and the CLI both describe user-facing commands from this
 * list. The UI attaches execution handlers in `src/tui/commands/registry.ts`;
 * the CLI attaches Commander actions. Metadata (names, aliases, descriptions,
 * argument hints) lives here so the two surfaces cannot drift apart silently.
 */

export type CommandSurface = 'slash' | 'cli';

export type CommandCategory =
  'agent' | 'context' | 'git' | 'navigation' | 'providers' | 'system' | 'tasks';

export interface CommandArgumentSpec {
  name: string;
  description: string;
  required?: boolean;
  values?: string[];
}

export interface CommandSpec {
  /** Canonical id, without a leading slash. */
  id: string;
  summary: string;
  description: string;
  usage?: string;
  aliases?: string[];
  arguments?: CommandArgumentSpec[];
  category: CommandCategory;
  surfaces: CommandSurface[];
  /** Keyboard hint shown in help and the palette. */
  shortcut?: string;
}

export const COMMAND_SPECS: CommandSpec[] = [
  {
    id: 'help',
    summary: 'Show commands and shortcuts',
    description: 'List every command, argument, alias, and keyboard shortcut.',
    usage: '/help',
    aliases: ['?'],
    category: 'system',
    surfaces: ['slash'],
  },
  {
    id: 'model',
    summary: 'Select an AI model',
    description:
      'Open the searchable model picker, or select a model directly by id/name. Updates the active model used by new work.',
    usage: '/model [model]',
    arguments: [{ name: 'model', description: 'Model id, name, or unique substring' }],
    category: 'providers',
    surfaces: ['slash'],
    shortcut: 'ctrl+m',
  },
  {
    id: 'models',
    summary: 'Browse the model catalog',
    description: 'Open the full model catalog with filters, metadata, and manual entries.',
    usage: '/models',
    category: 'providers',
    surfaces: ['slash', 'cli'],
    shortcut: 'ctrl+g',
  },
  {
    id: 'connect',
    summary: 'Connect a provider',
    description:
      'Choose a provider and add a profile with a name, API key, base URL, and optional model. Supports multiple profiles per provider.',
    usage: '/connect',
    category: 'providers',
    surfaces: ['slash', 'cli'],
  },
  {
    id: 'providers',
    summary: 'Manage connected providers',
    description:
      'List profiles, add or edit profiles, enable/disable, test connections, refresh models, and remove credentials.',
    usage: '/providers',
    category: 'providers',
    surfaces: ['slash', 'cli'],
  },
  {
    id: 'status',
    summary: 'View provider, quota, and task status',
    description:
      'Show the selected profile/model, connection state, active rate limits and quota classes, routing history, and git status.',
    usage: '/status',
    category: 'providers',
    surfaces: ['slash', 'cli'],
  },
  {
    id: 'usage',
    summary: 'View token usage and limits',
    description: 'Show token totals, per-model usage, cost estimates, and active provider limits.',
    usage: '/usage',
    category: 'providers',
    surfaces: ['slash', 'cli'],
  },
  {
    id: 'tasks',
    summary: 'Manage tasks and sessions',
    description:
      'Search tasks, inspect progress, resume paused work, rename tasks, delete history, or start a new task.',
    usage: '/tasks',
    aliases: ['sessions'],
    category: 'tasks',
    surfaces: ['slash', 'cli'],
    shortcut: 'ctrl+t',
  },
  {
    id: 'resume',
    summary: 'Resume a task',
    description:
      'Resume the current task or choose a paused/interrupted task. Progress, checkpoints, and git state are preserved.',
    usage: '/resume [task-id]',
    arguments: [{ name: 'task-id', description: 'Task id or unique prefix' }],
    category: 'tasks',
    surfaces: ['slash', 'cli'],
  },
  {
    id: 'clear',
    summary: 'Clear the conversation view',
    description: 'Clear the on-screen transcript without deleting stored task history.',
    usage: '/clear',
    category: 'context',
    surfaces: ['slash'],
    shortcut: 'ctrl+l',
  },
  {
    id: 'compact',
    summary: 'Compact the conversation context',
    description:
      'Summarize earlier turns while preserving the request, plan, decisions, tool activity, and changed files. The summary remains inspectable.',
    usage: '/compact',
    category: 'context',
    surfaces: ['slash'],
  },
  {
    id: 'settings',
    summary: 'Open settings',
    description: 'Review and change routing, safety, and editor preferences.',
    usage: '/settings',
    category: 'system',
    surfaces: ['slash', 'cli'],
  },
  {
    id: 'undo',
    summary: 'Safely undo task changes',
    description:
      'Restore files changed by the current task from its baseline snapshot. Refuses files modified after ComiCode finished and never touches unrelated files.',
    usage: '/undo',
    category: 'git',
    surfaces: ['slash'],
  },
  {
    id: 'diff',
    summary: 'View changes made by this task',
    description:
      'Show the git diff for files changed by the current task, including untracked files.',
    usage: '/diff',
    category: 'git',
    surfaces: ['slash'],
  },
  {
    id: 'shortcuts',
    summary: 'Show keyboard shortcuts',
    description: 'List global, workspace, and dialog keyboard shortcuts.',
    usage: '/shortcuts',
    category: 'system',
    surfaces: ['slash'],
    shortcut: '?',
  },
  {
    id: 'new',
    summary: 'Start a fresh task',
    description: 'Clear the active task and transcript so the next request starts a new task.',
    usage: '/new',
    aliases: ['reset'],
    category: 'tasks',
    surfaces: ['slash'],
    shortcut: 'ctrl+n',
  },
  {
    id: 'delete',
    summary: 'Delete a task and its history',
    description:
      'Delete the active task, or a saved task by id/prefix. Removes its messages and checkpoints after confirmation.',
    usage: '/delete [task-id]',
    arguments: [
      {
        name: 'task-id',
        description: 'Task id or unique prefix (default: the active task)',
        required: false,
      },
    ],
    category: 'tasks',
    surfaces: ['slash'],
  },
  {
    id: 'profile',
    summary: 'Reasoning effort / provider profile',
    description:
      'Open the effort picker (low/medium/default/high/xhigh) or switch the active provider profile by name.',
    usage: '/profile [name]',
    arguments: [
      {
        name: 'name',
        description: 'Profile name, id, or provider:name (omit to pick effort)',
        required: false,
      },
    ],
    category: 'providers',
    surfaces: ['slash'],
  },
  {
    id: 'storage',
    summary: 'Inspect storage usage',
    description: 'Show database size and row counts per table.',
    usage: '/storage',
    category: 'system',
    surfaces: ['slash'],
  },
  {
    id: 'cleanup',
    summary: 'Clean up old tasks',
    description:
      'Delete completed/failed tasks older than the retention period and vacuum the database.',
    usage: '/cleanup [days]',
    arguments: [
      {
        name: 'days',
        description: 'Retention window in days (default: settings storage.retentionDays)',
        required: false,
      },
    ],
    category: 'system',
    surfaces: ['slash'],
  },
  {
    id: 'copy',
    summary: 'Copy last output to clipboard',
    description: 'Copy the most recent assistant or tool output to the system clipboard.',
    usage: '/copy',
    category: 'context',
    surfaces: ['slash'],
  },
  {
    id: 'allow-paid',
    summary: 'Allow or block paid fallbacks',
    description: 'Control whether routing may fall back to paid models.',
    usage: '/allow-paid on|off',
    arguments: [
      {
        name: 'state',
        description: 'on or off',
        required: true,
        values: ['on', 'off'],
      },
    ],
    category: 'providers',
    surfaces: ['slash'],
  },
  {
    id: 'mode',
    summary: 'Switch the agent mode',
    description:
      'Choose how the agent behaves: auto (classify), build, plan, debug, architect, review, refactor, test, docs, design, security, or explain. Tab also cycles modes.',
    usage: '/mode [mode]',
    aliases: ['agent'],
    arguments: [
      {
        name: 'mode',
        description: 'agent mode',
        values: [
          'auto',
          'build',
          'plan',
          'debug',
          'architect',
          'review',
          'refactor',
          'test',
          'docs',
          'design',
          'security',
          'explain',
        ],
      },
    ],
    category: 'agent',
    surfaces: ['slash'],
    shortcut: 'tab',
  },
  {
    id: 'skills',
    summary: 'List available agent skills',
    description:
      'Show built-in, user, and project skills the agent can load with the use_skill tool.',
    usage: '/skills',
    category: 'agent',
    surfaces: ['slash'],
  },
  {
    id: 'tools',
    summary: 'Expand or collapse tool output',
    description: 'Toggle detailed tool arguments, output, errors, and durations in the transcript.',
    usage: '/tools',
    category: 'agent',
    surfaces: ['slash'],
    shortcut: 'ctrl+o',
  },
  {
    id: 'workspace',
    summary: 'Return to the workspace',
    description: 'Navigate back to the main conversation workspace.',
    usage: '/workspace',
    aliases: ['home'],
    category: 'navigation',
    surfaces: ['slash'],
  },
  {
    id: 'exit',
    summary: 'Quit ComiCode',
    description: 'Close the terminal UI cleanly.',
    usage: '/exit',
    aliases: ['quit'],
    category: 'system',
    surfaces: ['slash'],
  },
  {
    id: 'init',
    summary: 'Initialize project state',
    description: 'Create or update the project configuration in the current directory.',
    usage: 'comicode init',
    category: 'system',
    surfaces: ['cli'],
  },
  {
    id: 'task',
    summary: 'Run a coding task',
    description: 'Start a coding task from the command line.',
    usage: 'comicode task "<request>"',
    category: 'agent',
    surfaces: ['cli'],
  },
  {
    id: 'doctor',
    summary: 'Diagnose the installation',
    description: 'Check runtime, storage, credentials, providers, project state, and git.',
    usage: 'comicode doctor',
    category: 'system',
    surfaces: ['cli'],
  },
  {
    id: 'version',
    summary: 'Print the version',
    description: 'Print the ComiCode version and data directory.',
    usage: 'comicode --version',
    category: 'system',
    surfaces: ['cli'],
  },
];

const byId = new Map(COMMAND_SPECS.map((spec) => [spec.id, spec]));

export function getCommandSpec(id: string): CommandSpec | null {
  return byId.get(id) ?? null;
}

export function slashCommandSpecs(): CommandSpec[] {
  return COMMAND_SPECS.filter((spec) => spec.surfaces.includes('slash'));
}

export function cliCommandSpecs(): CommandSpec[] {
  return COMMAND_SPECS.filter((spec) => spec.surfaces.includes('cli'));
}

export function commandArgumentHint(spec: CommandSpec): string {
  if (!spec.arguments?.length) return '';
  return spec.arguments
    .map((argument) => (argument.required ? `<${argument.name}>` : `[${argument.name}]`))
    .join(' ');
}

export function commandReferenceLines(): string[] {
  const lines: string[] = [];
  let category: CommandCategory | null = null;
  for (const spec of slashCommandSpecs()) {
    if (spec.category !== category) {
      category = spec.category;
      if (lines.length) lines.push('');
      lines.push(category.toUpperCase());
    }
    const usage = spec.usage ?? `/${spec.id}`;
    const aliases = spec.aliases?.length
      ? ` (${spec.aliases.map((alias) => `/${alias}`).join(', ')})`
      : '';
    const shortcut = spec.shortcut ? ` [${spec.shortcut}]` : '';
    lines.push(`  ${usage.padEnd(24)} ${spec.summary}${aliases}${shortcut}`);
  }
  return lines;
}
