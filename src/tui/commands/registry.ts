/**
 * Interactive command registry for the ComiCode TUI.
 *
 * Connects shared CommandSpecs from `src/core/commands/catalog.ts` with real
 * execution handlers in the terminal UI, providing autocompletion, argument
 * hints, validation, and extensibility.
 */
import type { AppContext } from '../../core/app.js';
import type { ScreenId } from '../components.js';
import {
  COMMAND_SPECS,
  commandReferenceLines,
  slashCommandSpecs,
  type CommandSpec,
} from '../../core/commands/catalog.js';
import { resolveModel, resolveProfile } from '../../cli/shared.js';
import { compactTask } from '../../core/agent/compaction.js';
import { AGENT_MODE_IDS, isAgentMode, type AgentMode } from '../../core/agent/modes.js';
import { loadSkills } from '../../core/agent/skills.js';
import { glyph } from '../theme.js';
import type { ConfirmationRequest, ConfirmDecision } from '../../core/agent/types.js';

export interface CommandContext {
  context: AppContext;
  notify: (message: string) => void;
  refreshData: () => void;
  openDialog: (dialog: string) => void;
  closeDialog: () => void;
  navigateToScreen: (screen: ScreenId) => void;
  setTaskId: (taskId: string | null) => void;
  getActiveTaskId: () => string | null;
  /** Full transcript as plain text, for /copy all. */
  getTranscriptText?: () => string;
  clearTranscript: () => void;
  addNotice: (title: string, text: string) => void;
  showOutput?: (title: string, text: string) => void;
  addError: (text: string) => void;
  executeTask: (taskId: string, resume: boolean) => Promise<void>;
  toggleToolsExpanded: () => void;
  onQuit: () => void;
  agentMode?: AgentMode;
  setAgentMode?: (mode: AgentMode) => void;
  confirm?: (request: ConfirmationRequest) => Promise<ConfirmDecision>;
}

export type CommandAction = (args: string[], ctx: CommandContext) => Promise<void> | void;

export interface RegisteredCommand extends CommandSpec {
  handler: CommandAction;
}

export interface CommandSuggestion {
  value: string;
  label: string;
  detail: string;
  hint?: string;
  submit?: boolean;
}

class CommandRegistry {
  private commands = new Map<string, RegisteredCommand>();
  private aliasMap = new Map<string, string>();

  constructor() {
    this.registerDefaults();
  }

  register(spec: CommandSpec, handler: CommandAction): void {
    const registered: RegisteredCommand = { ...spec, handler };
    this.commands.set(spec.id, registered);
    if (spec.aliases) {
      for (const alias of spec.aliases) {
        this.aliasMap.set(alias, spec.id);
      }
    }
  }

  get(idOrAlias: string): RegisteredCommand | null {
    const canonical = this.aliasMap.get(idOrAlias) ?? idOrAlias;
    return this.commands.get(canonical) ?? null;
  }

  all(): RegisteredCommand[] {
    return Array.from(this.commands.values());
  }

  async execute(rawInput: string, ctx: CommandContext): Promise<boolean> {
    const trimmed = rawInput.trim();
    if (!trimmed.startsWith('/')) return false;

    const body = trimmed.slice(1).trim();
    const [name, ...args] = body.split(/\s+/);
    if (!name) return false;

    const command = this.get(name.toLowerCase());
    if (!command) {
      ctx.addError(`Unknown command "/${name}". Type /help for available commands.`);
      return true;
    }

    const requiredArguments =
      command.arguments?.filter((argument) => argument.required).length ?? 0;
    if (args.length < requiredArguments) {
      ctx.addError(`Usage: ${command.usage ?? `/${command.id}`}`);
      return true;
    }
    for (const [index, argument] of (command.arguments ?? []).entries()) {
      const value = args[index]?.toLowerCase();
      if (value && argument.values && !argument.values.includes(value)) {
        ctx.addError(
          `Invalid ${argument.name} "${args[index]}". Choose ${argument.values.join(' or ')}.`,
        );
        return true;
      }
    }

    try {
      await command.handler(args, ctx);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.addError(`Command /${name} failed: ${message}`);
    }
    return true;
  }

  getSuggestions(context: AppContext, input: string): CommandSuggestion[] {
    if (!input.startsWith('/')) return [];
    const trimmed = input.slice(1);
    const hasSpace = trimmed.includes(' ');
    const parts = trimmed.split(/\s+/);
    const commandName = parts[0]?.toLowerCase() ?? '';
    const argument = parts.slice(1).join(' ').trim();

    // If typing command name without argument
    if (!hasSpace) {
      const needle = commandName;
      const suggestions: CommandSuggestion[] = [];

      for (const cmd of this.all()) {
        if (!cmd.surfaces.includes('slash')) continue;
        const matchesName = cmd.id.startsWith(needle);
        const matchedAlias = cmd.aliases?.find((a) => a.startsWith(needle));
        if (!needle || matchesName || matchedAlias) {
          const display = `/${cmd.id}`;
          const argHint = cmd.arguments?.length
            ? ` ${cmd.arguments.map((a) => (a.required ? `<${a.name}>` : `[${a.name}]`)).join(' ')}`
            : '';
          suggestions.push({
            value: `/${cmd.id}`,
            label: display,
            detail: cmd.summary,
            hint: argHint,
            submit: !(cmd.arguments ?? []).some((a) => a.required),
          });
        }
      }

      return suggestions.sort((a, b) => a.label.localeCompare(b.label)).slice(0, 10);
    }

    // Command-specific argument suggestions
    const cmd = this.get(commandName);
    if (!cmd) return [];

    if (cmd.id === 'model') {
      if (!argument) return [];
      const needle = argument.toLowerCase();
      const profiles = context.store.listProfiles();
      return context.store
        .listModels()
        .filter((model) => profiles.some((p) => p.providerId === model.providerId))
        .filter(
          (model) =>
            !needle ||
            model.modelId.toLowerCase().includes(needle) ||
            model.displayName.toLowerCase().includes(needle),
        )
        .sort((a, b) => b.codingSuitability - a.codingSuitability)
        .slice(0, 8)
        .map((model) => ({
          value: `/model ${model.modelId}`,
          label: model.modelId,
          detail: `${model.providerId} ${glyph.bullet} ${model.displayName || model.modelId}`,
          submit: true,
        }));
    }

    if (cmd.id === 'profile') {
      const needle = argument.toLowerCase();
      return context.store
        .listProfiles()
        .filter(
          (profile) =>
            !needle ||
            profile.name.toLowerCase().includes(needle) ||
            profile.id.toLowerCase().startsWith(needle),
        )
        .slice(0, 8)
        .map((profile) => ({
          value: `/profile ${profile.name}`,
          label: profile.name,
          detail: `${profile.providerId} ${glyph.bullet} ${profile.defaultModel ?? 'no model'}`,
          submit: true,
        }));
    }

    if (cmd.id === 'resume') {
      const needle = argument.toLowerCase();
      return context.store
        .listTasks({ projectPath: context.cwd, limit: 20 })
        .filter((task) => !needle || task.id.toLowerCase().startsWith(needle))
        .slice(0, 6)
        .map((task) => ({
          value: `/resume ${task.id.slice(0, 8)}`,
          label: task.id.slice(0, 8),
          detail: `${task.status} · ${task.userRequest.slice(0, 40)}`,
          submit: true,
        }));
    }

    if (cmd.id === 'mode') {
      return AGENT_MODE_IDS.filter((mode) => !argument || mode.startsWith(argument.toLowerCase()))
        .map((mode) => ({
          value: `/mode ${mode}`,
          label: mode,
          detail:
            mode === 'build'
              ? 'Full coding agent'
              : mode === 'plan'
                ? 'Read-only planning'
                : 'Diagnosis-first debugging',
          submit: true,
        }));
    }

    if (cmd.id === 'allow-paid') {
      return ['on', 'off']
        .filter((opt) => !argument || opt.startsWith(argument.toLowerCase()))
        .map((opt) => ({
          value: `/allow-paid ${opt}`,
          label: opt,
          detail: opt === 'on' ? 'Allow paid model fallbacks' : 'Only use free-tier models',
          submit: true,
        }));
    }

    return [];
  }

  private registerDefaults(): void {
    const specs = slashCommandSpecs();
    const findSpec = (id: string): CommandSpec =>
      specs.find((s) => s.id === id) ??
      COMMAND_SPECS.find((s) => s.id === id) ?? {
        id,
        summary: id,
        description: id,
        category: 'system',
        surfaces: ['slash'],
      };

    this.register(findSpec('help'), (_args, ctx) => {
      const text = ['Commands', ...commandReferenceLines()].join('\n');
      if (ctx.showOutput) ctx.showOutput('help', text);
      else ctx.addNotice('help', text);
    });

    this.register(findSpec('model'), (args, ctx) => {
      const target = args.join(' ').trim();
      if (!target) {
        ctx.openDialog('model-picker');
        return;
      }
      try {
        const resolved = resolveModel(ctx.context.store, target);
        ctx.context.store.setSelectedProfileId(resolved.profile.id);
        ctx.context.store.setSelectedModelId(resolved.model.id);
        ctx.notify(`Using ${resolved.model.modelId} via ${resolved.profile.name}.`);
        ctx.refreshData();
      } catch (error) {
        ctx.addError(error instanceof Error ? error.message : String(error));
      }
    });

    this.register(findSpec('models'), (_args, ctx) => {
      ctx.openDialog('model-picker');
    });

    this.register(findSpec('connect'), (_args, ctx) => {
      ctx.openDialog('connect');
    });

    this.register(findSpec('providers'), (_args, ctx) => {
      ctx.openDialog('providers');
    });

    this.register(findSpec('status'), (_args, ctx) => {
      ctx.openDialog('status');
    });

    this.register(findSpec('usage'), (_args, ctx) => {
      ctx.openDialog('usage');
    });

    this.register(findSpec('tasks'), (_args, ctx) => {
      ctx.openDialog('tasks');
    });

    this.register(findSpec('resume'), async (args, ctx) => {
      const target = args[0]?.trim();
      if (target) {
        const tasks = ctx.context.store.listTasks({ projectPath: ctx.context.cwd, limit: 200 });
        const exact =
          tasks.find((t) => t.id === target) ?? tasks.find((t) => t.id.startsWith(target));
        if (!exact) {
          ctx.addError(`Task not found: ${target}`);
          return;
        }
        await ctx.executeTask(exact.id, true);
        return;
      }

      const activeId = ctx.getActiveTaskId();
      if (activeId) {
        await ctx.executeTask(activeId, true);
        return;
      }

      const tasks = ctx.context.store.listTasks({ projectPath: ctx.context.cwd, limit: 50 });
      const paused = tasks.find((t) => t.status === 'paused' || t.status === 'failed');
      if (paused) {
        await ctx.executeTask(paused.id, true);
      } else {
        ctx.addNotice('notice', 'No paused task to resume.');
      }
    });

    this.register(findSpec('clear'), (_args, ctx) => {
      ctx.clearTranscript();
    });

    this.register(findSpec('compact'), (_args, ctx) => {
      const activeId = ctx.getActiveTaskId();
      if (!activeId) {
        ctx.addNotice('notice', 'No active task to compact.');
        return;
      }
      try {
        const res = compactTask(ctx.context.store, activeId);
        const text = `Context compacted (${res.record.messagesCompacted} messages summarized).\n${res.record.summary.slice(0, 400)}…`;
        if (ctx.showOutput) ctx.showOutput('compact', text);
        else ctx.addNotice('compact', text);
        ctx.notify('Context compacted successfully.');
        ctx.refreshData();
      } catch (error) {
        ctx.addError(error instanceof Error ? error.message : String(error));
      }
    });

    this.register(findSpec('settings'), (_args, ctx) => {
      ctx.openDialog('settings');
    });

    this.register(findSpec('undo'), (_args, ctx) => {
      ctx.openDialog('undo');
    });

    this.register(findSpec('diff'), (_args, ctx) => {
      ctx.openDialog('diff');
    });

    this.register(findSpec('shortcuts'), (_args, ctx) => {
      ctx.openDialog('shortcuts');
    });

    this.register(findSpec('new'), (_args, ctx) => {
      ctx.setTaskId(null);
      ctx.clearTranscript();
      ctx.notify('Ready for a new task.');
    });

    this.register(findSpec('delete'), async (args, ctx) => {
      const store = ctx.context.store;
      const target = args.join(' ').trim();
      let task = null;
      if (target) {
        const tasks = store.listTasks({ projectPath: ctx.context.cwd, limit: 200 });
        task =
          tasks.find((t) => t.id === target) ?? tasks.find((t) => t.id.startsWith(target)) ?? null;
        if (!task) {
          ctx.addError(`Task not found: ${target}`);
          return;
        }
      } else {
        const activeId = ctx.getActiveTaskId();
        task = activeId ? store.getTask(activeId) : null;
        if (!task) {
          ctx.addError('No active task to delete. Open /tasks and press ctrl+d for saved history.');
          return;
        }
      }
      if (task.status === 'running') {
        ctx.addError('Cannot delete a running task. Pause it first.');
        return;
      }
      if (!ctx.confirm) {
        ctx.addError('Confirmation is unavailable in this context.');
        return;
      }
      const title =
        typeof task.metadata.title === 'string' && task.metadata.title.trim()
          ? task.metadata.title
          : task.userRequest;
      const decision = await ctx.confirm({
        kind: 'task-delete',
        title: 'Delete task?',
        description: `Permanently removes "${title.slice(0, 100)}" and its messages/checkpoints.`,
      });
      if (decision !== 'allow') return;
      store.deleteTask(task.id);
      if (ctx.getActiveTaskId() === task.id) ctx.setTaskId(null);
      ctx.notify(`Deleted task ${task.id.slice(0, 8)}.`);
      ctx.refreshData();
    });

    this.register(findSpec('profile'), (args, ctx) => {
      const name = args.join(' ').trim();
      if (!name) {
        ctx.openDialog('effort');
        return;
      }
      try {
        const profile = resolveProfile(ctx.context.store, name);
        ctx.context.store.setSelectedProfileId(profile.id);
        ctx.notify(`Using profile ${profile.name}.`);
        ctx.refreshData();
      } catch (error) {
        ctx.addError(error instanceof Error ? error.message : String(error));
      }
    });

    this.register(findSpec('storage'), (_args, ctx) => {
      const stats = ctx.context.store.storageStats();
      const lines = [
        `Database: ${stats.path ?? ''}`,
        `Size: ${(stats.dbBytes / 1024).toFixed(1)} KB`,
        '',
        ...Object.entries(stats.tables).map(([table, count]) =>
          `  ${table.padEnd(20)} ${count}`,
        ),
      ];
      const text = lines.join('\n');
      if (ctx.showOutput) ctx.showOutput('storage', text);
      else ctx.addNotice('storage', text);
    });

    this.register(findSpec('cleanup'), (args, ctx) => {
      const parsed = Number(args[0]);
      const days = Number.isFinite(parsed) && parsed > 0
        ? Math.floor(parsed)
        : ctx.context.store.getSettings().storage.retentionDays;
      const { deletedTasks } = ctx.context.store.cleanupCompletedOlderThan(days);
      ctx.notify(
        deletedTasks === 0
          ? `Nothing to clean — no completed/failed tasks older than ${days} days.`
          : `Removed ${deletedTasks} old task(s) and vacuumed the database.`,
      );
      ctx.refreshData();
    });

    this.register(findSpec('copy'), async (args, ctx) => {
      const mode = (args[0] ?? '').toLowerCase();
      if (mode === 'all' || mode === 'transcript') {
        const transcript = ctx.getTranscriptText?.().trim();
        if (!transcript) {
          ctx.addNotice('copy', 'The transcript is empty.');
          return;
        }
        const { copyToClipboard } = await import('../../core/clipboard.js');
        const ok = await copyToClipboard(transcript.slice(0, 500_000));
        ctx.notify(
          ok
            ? `Copied the full transcript (${transcript.length} chars) to clipboard.`
            : 'Clipboard unavailable. Use ctrl+y and your terminal copy shortcut.',
        );
        return;
      }
      const taskId = ctx.getActiveTaskId();
      const messages = taskId ? ctx.context.store.loadMessages(taskId, 60) : [];
      const last = [...messages]
        .reverse()
        .find((message) => message.role === 'assistant' || message.role === 'tool');
      const text = last?.content?.trim();
      if (!text) {
        ctx.addNotice('copy', 'Nothing to copy yet. Use /copy all for the transcript.');
        return;
      }
      const { copyToClipboard } = await import('../../core/clipboard.js');
      const ok = await copyToClipboard(text.slice(0, 200_000));
      ctx.notify(ok ? `Copied ${text.length} chars to clipboard.` : 'Clipboard unavailable.');
    });

    this.register(findSpec('allow-paid'), (args, ctx) => {
      const value = args[0]?.toLowerCase();
      if (value !== 'on' && value !== 'off') {
        ctx.addNotice('notice', 'Usage: /allow-paid on|off');
        return;
      }
      const isAllowed = value === 'on';
      ctx.context.store.updateSettings((settings) => {
        settings.routing.allowPaid = isAllowed;
        return settings;
      });
      ctx.notify(`Paid fallbacks ${isAllowed ? 'enabled' : 'disabled'}.`);
      ctx.refreshData();
    });

    this.register(findSpec('mode'), (args, ctx) => {
      const target = args[0]?.toLowerCase();
      if (!target) {
        ctx.notify(`Agent mode: ${ctx.agentMode ?? 'build'} (tab cycles, /mode build|plan|debug)`);
        return;
      }
      if (!isAgentMode(target)) {
        ctx.addError(`Unknown mode "${target}". Choose ${AGENT_MODE_IDS.join(', ')}.`);
        return;
      }
      ctx.setAgentMode?.(target);
      ctx.notify(
        target === 'plan'
          ? 'Plan mode: read-only. The agent will propose steps without changing files.'
          : target === 'debug'
            ? 'Debug mode: diagnosis-first with full tools.'
            : 'Build mode: full coding agent.',
      );
      ctx.refreshData();
    });

    this.register(findSpec('skills'), (_args, ctx) => {
      const skills = loadSkills(ctx.context.cwd);
      if (skills.length === 0) {
        ctx.addNotice('skills', 'No skills found. Add SKILL.md files under .comicode/skills/.');
        return;
      }
      const lines = skills.map(
        (skill) => `  ${skill.name.padEnd(28)} ${skill.description}  (${skill.source})`,
      );
      const text = ['Available skills (agent loads them via use_skill):', ...lines].join('\n');
      if (ctx.showOutput) ctx.showOutput('skills', text);
      else ctx.addNotice('skills', text);
    });

    this.register(findSpec('tools'), (_args, ctx) => {
      ctx.toggleToolsExpanded();
    });

    this.register(findSpec('workspace'), (_args, ctx) => {
      ctx.navigateToScreen('workspace');
    });

    this.register(findSpec('exit'), (_args, ctx) => {
      ctx.onQuit();
    });
  }
}

export const commandRegistry = new CommandRegistry();
