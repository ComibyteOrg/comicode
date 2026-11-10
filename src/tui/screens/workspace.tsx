import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { AppContext } from '../../core/app.js';
import type { AgentHooks, ConfirmationRequest } from '../../core/agent/types.js';
import { CodingAgent, DEFAULT_AUTHORITY } from '../../core/agent/agent.js';
import type { TaskPlan, TaskRecord } from '../../core/types.js';
import { resolveModel, resolveProfile } from '../../cli/shared.js';
import {
  clip,
  clipLines,
  ConfirmDialog,
  Empty,
  formatCount,
  PromptInput,
  Spinner,
  useLayout,
  type AgentStatus,
  type PromptSuggestion,
  type ScreenId,
} from '../components.js';
import { glyph, theme } from '../theme.js';

interface Entry {
  id: number;
  kind:
    | 'user'
    | 'assistant'
    | 'tool'
    | 'route'
    | 'notice'
    | 'error'
    | 'summary'
    | 'paused'
    | 'review'
    | 'plan';
  text: string;
  title?: string;
}

export interface ResumeRequest {
  taskId: string;
  nonce: number;
  resume: boolean;
}

interface WorkspaceProps {
  context: AppContext;
  active: boolean;
  onStatusChange: (status: AgentStatus) => void;
  onNavigate: (screen: ScreenId) => void;
  onCycleScreen: (direction: 1 | -1) => void;
  onQuit: () => void;
  resumeRequest: ResumeRequest | null;
  notify: (message: string) => void;
  refreshData: () => void;
}

const HELP = [
  'Commands',
  '  /help                 show this list',
  '  /new                  start a fresh task',
  '  /clear                clear this transcript',
  '  /resume               resume the paused task',
  '  /profile <name>       select a provider profile',
  '  /model <name>         select a model',
  '  /allow-paid on|off    allow or block paid fallbacks',
  '  /providers /models /history /usage /settings   switch screens',
  '  /workspace            return to the workspace',
  '  /exit                 quit ComiCode',
  '',
  'Keys',
  '  ←/→ or tab            switch screens when the composer is empty',
  '  shift+tab             previous screen',
  '  ctrl+k                command palette',
  '  pgup / pgdn           scroll the transcript',
  '  esc                   pause a running task',
].join('\n');

const COMMAND_CATALOG: PromptSuggestion[] = [
  { value: '/help', label: '/help', detail: 'Show commands and keys', submit: true },
  { value: '/new', label: '/new', detail: 'Start a fresh task', submit: true },
  { value: '/clear', label: '/clear', detail: 'Clear the transcript', submit: true },
  { value: '/resume', label: '/resume', detail: 'Resume the paused task', submit: true },
  { value: '/providers', label: '/providers', detail: 'Provider profiles', submit: true },
  { value: '/models', label: '/models', detail: 'Model catalog', submit: true },
  { value: '/history', label: '/history', detail: 'Task history', submit: true },
  { value: '/usage', label: '/usage', detail: 'Usage and limits', submit: true },
  { value: '/settings', label: '/settings', detail: 'Settings', submit: true },
  { value: '/workspace', label: '/workspace', detail: 'Back to the workspace', submit: true },
  { value: '/profile', label: '/profile', detail: 'Select a provider profile' },
  { value: '/model', label: '/model', detail: 'Select a model' },
  { value: '/allow-paid', label: '/allow-paid', detail: 'Toggle paid fallbacks' },
  { value: '/exit', label: '/exit', detail: 'Quit ComiCode', submit: true },
];

function slashSuggestions(context: AppContext, value: string): PromptSuggestion[] {
  if (!value.startsWith('/')) return [];
  const trimmed = value.trimStart();
  const [command, ...rest] = trimmed.split(/\s+/);
  const argument = rest.join(' ').trim();

  if (!trimmed.includes(' ')) {
    const needle = trimmed.toLowerCase();
    return COMMAND_CATALOG.filter((entry) => entry.value.startsWith(needle)).slice(0, 7);
  }

  if (command === '/profile') {
    const needle = argument.toLowerCase();
    return context.store
      .listProfiles()
      .filter(
        (profile) =>
          !needle ||
          profile.name.toLowerCase().includes(needle) ||
          profile.id.toLowerCase().startsWith(needle),
      )
      .slice(0, 6)
      .map((profile) => ({
        value: `/profile ${profile.name}`,
        label: profile.name,
        detail: `${profile.providerId} ${glyph.bullet} ${profile.defaultModel ?? 'no model'}`,
        submit: true,
      }));
  }

  if (command === '/model') {
    const needle = argument.toLowerCase();
    return context.store
      .listModels()
      .filter(
        (model) =>
          !needle ||
          model.modelId.toLowerCase().includes(needle) ||
          model.displayName.toLowerCase().includes(needle),
      )
      .sort((a, b) => b.codingSuitability - a.codingSuitability)
      .slice(0, 6)
      .map((model) => ({
        value: `/model ${model.modelId}`,
        label: model.modelId,
        detail: `${model.providerId} ${glyph.bullet} ${
          model.contextWindow ? `${Math.round(model.contextWindow / 1000)}k ctx` : 'ctx unknown'
        }`,
        submit: true,
      }));
  }

  if (command === '/allow-paid') {
    return ['on', 'off']
      .filter((option) => !argument || option.startsWith(argument.toLowerCase()))
      .map((option) => ({
        value: `/allow-paid ${option}`,
        label: option,
        detail: option === 'on' ? 'Allow paid fallbacks' : 'Block paid fallbacks',
        submit: true,
      }));
  }

  return [];
}

function taskToEntries(context: AppContext, task: TaskRecord): Entry[] {
  const stored = context.store.loadStoredMessages(task.id, 80);
  let id = 0;
  const entries: Entry[] = [];
  for (const message of stored) {
    if (message.role === 'user') {
      entries.push({ id: ++id, kind: 'user', text: clipLines(message.content, 3, 500) });
    } else if (message.role === 'assistant') {
      if (message.content.trim()) {
        entries.push({ id: ++id, kind: 'assistant', text: clipLines(message.content, 4, 800) });
      }
      for (const call of message.toolCalls ?? []) {
        entries.push({
          id: ++id,
          kind: 'tool',
          title: call.name,
          text: clip(JSON.stringify(call.arguments ?? {}), 120),
        });
      }
    } else if (message.role === 'tool') {
      entries.push({
        id: ++id,
        kind: 'tool',
        title: `${message.name ?? 'tool'} result`,
        text: clipLines(message.content, 2, 300),
      });
    }
  }
  entries.push({
    id: ++id,
    kind: 'notice',
    text: `Loaded task ${task.id.slice(0, 8)} (${task.status}, phase ${task.phase}). ${task.userRequest}`,
  });
  return entries;
}

function roleFor(entry: Entry): {
  label: string;
  color: string;
  marker: string;
  bodyColor: string;
  lines: number;
  chars: number;
} {
  switch (entry.kind) {
    case 'user':
      return {
        label: 'you',
        color: theme.warm,
        marker: '▌',
        bodyColor: theme.text,
        lines: 5,
        chars: 1200,
      };
    case 'assistant':
      return {
        label: 'comicode',
        color: theme.accent,
        marker: '◆',
        bodyColor: theme.text,
        lines: 8,
        chars: 4000,
      };
    case 'tool':
      return {
        label: entry.title ?? 'tool',
        color: theme.muted,
        marker: glyph.tool,
        bodyColor: theme.faint,
        lines: 3,
        chars: 600,
      };
    case 'route':
      return {
        label: 'route',
        color: theme.violet,
        marker: glyph.route,
        bodyColor: theme.faint,
        lines: 2,
        chars: 400,
      };
    case 'error':
      return {
        label: entry.title ?? 'error',
        color: theme.danger,
        marker: glyph.cross,
        bodyColor: theme.danger,
        lines: 5,
        chars: 1200,
      };
    case 'paused':
      return {
        label: entry.title ?? 'paused',
        color: theme.warning,
        marker: glyph.pause,
        bodyColor: theme.warning,
        lines: 5,
        chars: 1200,
      };
    case 'summary':
      return {
        label: entry.title ?? 'completed',
        color: theme.success,
        marker: glyph.check,
        bodyColor: theme.text,
        lines: 7,
        chars: 2400,
      };
    case 'review':
      return {
        label: entry.title ?? 'reviewer',
        color: theme.info,
        marker: '◇',
        bodyColor: theme.text,
        lines: 6,
        chars: 2000,
      };
    case 'plan':
      return {
        label: entry.title ?? 'plan',
        color: theme.accent,
        marker: '▤',
        bodyColor: theme.text,
        lines: 6,
        chars: 2000,
      };
    default:
      return {
        label: entry.title ?? 'notice',
        color: theme.faint,
        marker: glyph.bullet,
        bodyColor: theme.muted,
        lines: entry.title === 'help' ? 18 : 5,
        chars: entry.title === 'help' ? 5000 : 1200,
      };
  }
}

function EntryCard({ entry }: { entry: Entry }): React.ReactElement {
  const role = roleFor(entry);
  return (
    <Box flexDirection="column" marginBottom={1} flexShrink={0}>
      <Text color={role.color} bold>
        {role.marker} {role.label}
      </Text>
      <Box paddingLeft={2}>
        <Text color={role.bodyColor} wrap="wrap">
          {clipLines(entry.text, role.lines, role.chars)}
        </Text>
      </Box>
    </Box>
  );
}

export function Workspace({
  context,
  active,
  onStatusChange,
  onNavigate,
  onCycleScreen,
  onQuit,
  resumeRequest,
  notify,
  refreshData,
}: WorkspaceProps): React.ReactElement {
  const { rows } = useLayout();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<AgentStatus>('idle');
  const [taskId, setTaskId] = useState<string | null>(null);
  const [plan, setPlan] = useState<TaskPlan | null>(null);
  const [route, setRoute] = useState<string | null>(null);
  const [usage, setUsage] = useState({ inputTokens: 0, outputTokens: 0 });
  const [confirmRequest, setConfirmRequest] = useState<ConfirmationRequest | null>(null);
  const [frame, setFrame] = useState(0);
  const [pauseReason, setPauseReason] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<string | null>(null);

  const nextId = useRef(1);
  const abortRef = useRef<AbortController | null>(null);
  const confirmResolve = useRef<((approved: boolean) => void) | null>(null);
  const adoptedNonce = useRef(0);
  const streamingId = useRef<number | null>(null);

  const updateStatus = useCallback(
    (next: AgentStatus) => {
      setStatus(next);
      onStatusChange(next);
    },
    [onStatusChange],
  );

  const addEntry = useCallback((entry: Omit<Entry, 'id'>): number => {
    const id = nextId.current++;
    setEntries((previous) => [...previous.slice(-240), { ...entry, id }]);
    return id;
  }, []);

  const removeEntry = useCallback((id: number) => {
    setEntries((previous) => previous.filter((entry) => entry.id !== id));
  }, []);

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setFrame((value) => value + 1), 120);
    return () => clearInterval(timer);
  }, [running]);

  const respondConfirm = useCallback((approved: boolean) => {
    const resolve = confirmResolve.current;
    confirmResolve.current = null;
    setConfirmRequest(null);
    resolve?.(approved);
  }, []);

  const makeHooks = useCallback((): AgentHooks => {
    return {
      confirm: (request) =>
        new Promise<boolean>((resolve) => {
          confirmResolve.current = resolve;
          setConfirmRequest(request);
        }),
      onText: (delta) => {
        let id = streamingId.current;
        if (id === null) {
          id = nextId.current++;
          streamingId.current = id;
          setEntries((previous) => [
            ...previous.slice(-240),
            { id: id!, kind: 'assistant', text: '' },
          ]);
        }
        setEntries((previous) =>
          previous.map((entry) =>
            entry.id === id ? { ...entry, text: (entry.text + delta).slice(-80_000) } : entry,
          ),
        );
      },
      onAssistantMessage: (content) => {
        const id = streamingId.current;
        streamingId.current = null;
        if (!content.trim()) {
          if (id !== null) removeEntry(id);
          return;
        }
        if (id === null) {
          addEntry({ kind: 'assistant', text: clipLines(content, 8, 4000) });
        }
      },
      onToolStart: (call) => {
        addEntry({
          kind: 'tool',
          title: call.name,
          text: clip(JSON.stringify(call.arguments ?? {}), 180),
        });
      },
      onToolResult: (call, result) => {
        const firstLine = result.content.split(/\r?\n/).find((line) => line.trim()) ?? '';
        addEntry({
          kind: result.ok ? 'tool' : 'error',
          title: `${result.ok ? glyph.check : glyph.cross} ${call.name}`,
          text: clip(firstLine, 180),
        });
      },
      onRoute: (decision) => {
        setRoute(`${decision.candidate.profile.name}/${decision.candidate.model.modelId}`);
        addEntry({
          kind: 'route',
          text: `${decision.candidate.profile.name}/${decision.candidate.model.modelId} — ${decision.reason}`,
        });
      },
      onUsage: (turnUsage) => {
        setUsage((previous) => ({
          inputTokens: previous.inputTokens + turnUsage.inputTokens,
          outputTokens: previous.outputTokens + turnUsage.outputTokens,
        }));
      },
      onPlan: (value) => {
        const planValue = value as TaskPlan | undefined;
        if (planValue?.steps) setPlan(planValue);
      },
      onReview: (review) => {
        addEntry({ kind: 'review', title: 'reviewer', text: clipLines(review, 10, 3000) });
      },
      onNotice: (message) => {
        addEntry({ kind: 'notice', text: message });
      },
      onRetry: (info) => {
        addEntry({
          kind: 'notice',
          text: `retrying ${info.category} in ${(info.delayMs / 1000).toFixed(1)}s (attempt ${info.attempt})`,
        });
      },
      onPaused: (reason) => {
        setPauseReason(reason);
        addEntry({ kind: 'paused', title: 'paused', text: reason });
      },
      onTaskComplete: (summary) => {
        if (summary)
          addEntry({ kind: 'summary', title: 'completed', text: clipLines(summary, 10, 3000) });
      },
    };
  }, [addEntry, removeEntry]);

  const execute = useCallback(
    async (id: string, resume: boolean): Promise<void> => {
      if (running) return;
      updateStatus('running');
      setRunning(true);
      setPauseReason(null);
      setLastResult(null);
      setPlan(null);
      setRoute(null);
      setScrollOffset(0);
      streamingId.current = null;
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const agent = new CodingAgent({
          store: context.store,
          taskId: id,
          hooks: makeHooks(),
          authority: { ...DEFAULT_AUTHORITY },
          settings: context.store.getSettings(),
        });
        const result = await agent.run({
          resume,
          signal: controller.signal,
          maxSteps: context.store.getSettings().agent.maxSteps,
        });
        if (result.status === 'completed') {
          updateStatus('completed');
          setLastResult(result.summary ?? 'Task completed.');
        } else if (result.status === 'paused') {
          updateStatus('paused');
          setPauseReason(result.pauseReason ?? 'Paused.');
        } else {
          updateStatus('failed');
          setLastResult(result.summary ?? 'Task did not complete.');
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        addEntry({ kind: 'error', title: 'error', text: message });
        updateStatus('failed');
        setLastResult(message);
      } finally {
        abortRef.current = null;
        setRunning(false);
        streamingId.current = null;
        refreshData();
      }
    },
    [addEntry, context, makeHooks, refreshData, running, updateStatus],
  );

  const startRequest = useCallback(
    async (request: string): Promise<void> => {
      if (!request.trim() || running) return;
      try {
        const profiles = context.store.listProfiles();
        const selectedId = context.store.getSelectedProfileId();
        const profile =
          profiles.find((entry) => entry.id === selectedId) ??
          profiles.find((entry) => entry.enabled) ??
          null;
        if (!profile) {
          addEntry({
            kind: 'error',
            title: 'no provider',
            text: 'No provider profile is connected. Open providers and add one first.',
          });
          return;
        }
        const modelKey = context.store.getSelectedModelId();
        const model = modelKey
          ? (context.store.listModels().find((entry) => entry.id === modelKey) ?? null)
          : null;
        addEntry({ kind: 'user', text: request });
        if (!taskId) {
          const task = context.store.createTask({
            projectPath: context.cwd,
            projectName: context.cwd.split(/[\\/]/).filter(Boolean).pop() ?? 'project',
            userRequest: request,
            taskType: 'coding',
            currentProfileId: profile.id,
            currentModelId: model?.modelId ?? profile.defaultModel ?? null,
            metadata: { createdBy: 'tui', source: 'comicode' },
          });
          setTaskId(task.id);
          await execute(task.id, false);
          return;
        }
        const task = context.store.getTask(taskId);
        if (!task) {
          setTaskId(null);
          addEntry({
            kind: 'error',
            text: 'The active task no longer exists. Starting a new task.',
          });
          return;
        }
        context.store.appendMessage(task.id, { role: 'user', content: request });
        context.store.updateTask(task.id, {
          status: 'running',
          phase: task.phase === 'done' ? 'implement' : task.phase,
          completedAt: null,
        });
        await execute(task.id, task.status === 'paused' || task.status === 'failed');
      } catch (error) {
        addEntry({
          kind: 'error',
          text: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [addEntry, context, execute, running, taskId],
  );

  const adopt = useCallback(
    async (request: ResumeRequest): Promise<void> => {
      const task = context.store.getTask(request.taskId);
      if (!task) {
        notify('Task not found.');
        return;
      }
      setTaskId(task.id);
      setPlan(task.plan);
      setPauseReason(task.error ?? null);
      setEntries(taskToEntries(context, task));
      setUsage({ inputTokens: 0, outputTokens: 0 });
      setLastResult(task.summary);
      setScrollOffset(0);
      if (request.resume) await execute(task.id, true);
      else updateStatus(task.status === 'completed' ? 'completed' : 'idle');
    },
    [context, execute, notify, updateStatus],
  );

  useEffect(() => {
    if (!resumeRequest || resumeRequest.nonce === adoptedNonce.current) return;
    adoptedNonce.current = resumeRequest.nonce;
    void adopt(resumeRequest);
  }, [adopt, resumeRequest]);

  const handleCommand = useCallback(
    async (raw: string): Promise<void> => {
      const [command, ...rest] = raw.trim().split(/\s+/);
      const argument = rest.join(' ').trim();
      switch (command) {
        case '/help':
        case '/?':
          addEntry({ kind: 'notice', title: 'help', text: HELP });
          return;
        case '/exit':
        case '/quit':
          onQuit();
          return;
        case '/new':
          setTaskId(null);
          setPlan(null);
          setPauseReason(null);
          setLastResult(null);
          setUsage({ inputTokens: 0, outputTokens: 0 });
          setEntries([]);
          setScrollOffset(0);
          updateStatus('idle');
          notify('Ready for a new task.');
          return;
        case '/clear':
          setEntries([]);
          setScrollOffset(0);
          return;
        case '/providers':
          onNavigate('providers');
          return;
        case '/models':
          onNavigate('models');
          return;
        case '/history':
          onNavigate('history');
          return;
        case '/usage':
          onNavigate('usage');
          return;
        case '/settings':
          onNavigate('settings');
          return;
        case '/workspace':
        case '/home':
          onNavigate('workspace');
          return;
        case '/profile': {
          if (!argument) {
            onNavigate('providers');
            return;
          }
          try {
            const profile = resolveProfile(context.store, argument);
            context.store.setSelectedProfileId(profile.id);
            notify(`Using profile ${profile.name}.`);
            refreshData();
          } catch (error) {
            addEntry({
              kind: 'error',
              text: error instanceof Error ? error.message : String(error),
            });
          }
          return;
        }
        case '/model': {
          if (!argument) {
            onNavigate('models');
            return;
          }
          try {
            const resolved = resolveModel(context.store, argument);
            context.store.setSelectedProfileId(resolved.profile.id);
            context.store.setSelectedModelId(resolved.model.id);
            notify(`Using ${resolved.model.modelId} via ${resolved.profile.name}.`);
            refreshData();
          } catch (error) {
            addEntry({
              kind: 'error',
              text: error instanceof Error ? error.message : String(error),
            });
          }
          return;
        }
        case '/resume': {
          if (taskId) {
            await execute(taskId, true);
          } else {
            const tasks = context.store.listTasks({ projectPath: context.cwd, limit: 50 });
            const paused = tasks.find(
              (task) => task.status === 'paused' || task.status === 'failed',
            );
            if (paused) await adopt({ taskId: paused.id, nonce: Date.now(), resume: true });
            else addEntry({ kind: 'notice', text: 'No paused task to resume.' });
          }
          return;
        }
        case '/allow-paid': {
          const value = argument.toLowerCase();
          if (value !== 'on' && value !== 'off') {
            addEntry({ kind: 'notice', text: 'Usage: /allow-paid on|off' });
            return;
          }
          context.store.updateSettings((settings) => {
            settings.routing.allowPaid = value === 'on';
            return settings;
          });
          notify(`Paid fallbacks ${value === 'on' ? 'enabled' : 'disabled'}.`);
          refreshData();
          return;
        }
        default:
          addEntry({
            kind: 'error',
            text: `Unknown command "${command}". Type /help for the list.`,
          });
      }
    },
    [
      addEntry,
      adopt,
      context,
      execute,
      notify,
      onNavigate,
      onQuit,
      refreshData,
      taskId,
      updateStatus,
    ],
  );

  const submit = useCallback(
    (value: string): void => {
      const trimmed = value.trim();
      setInput('');
      if (!trimmed) return;
      setHistory((previous) =>
        [...previous.filter((item) => item !== trimmed), trimmed].slice(-60),
      );
      setScrollOffset(0);
      if (trimmed.startsWith('/')) {
        void handleCommand(trimmed);
        return;
      }
      void startRequest(trimmed);
    },
    [handleCommand, startRequest],
  );

  useInput(
    (input, key) => {
      if (key.escape && running) {
        abortRef.current?.abort();
        notify('Pausing after the current operation…');
        return;
      }
      if (key.pageUp) {
        setScrollOffset((value) => Math.min(Math.max(0, entries.length - 1), value + 4));
        return;
      }
      if (key.pageDown) {
        setScrollOffset((value) => Math.max(0, value - 4));
        return;
      }
      if (running) {
        if (key.leftArrow) onCycleScreen(-1);
        else if (key.rightArrow) onCycleScreen(1);
        else if (key.tab) onCycleScreen(key.shift ? -1 : 1);
      }
    },
    { isActive: active && !confirmRequest },
  );

  const task = taskId ? context.store.getTask(taskId) : null;
  const suggestions = slashSuggestions(context, input);
  // Keep the newest entries visible even when an older entry is very tall
  // (for example /help). We budget terminal lines rather than entry counts.
  const lineBudget = Math.max(5, rows - 18);
  const end = Math.max(0, entries.length - scrollOffset);
  let start = end;
  let used = 0;
  for (let index = end - 1; index >= 0; index -= 1) {
    const entry = entries[index]!;
    const role = roleFor(entry);
    const height = clipLines(entry.text, role.lines, role.chars).split(/\r?\n/).length + 2;
    if (start < end && used + height > lineBudget) break;
    used += height;
    start = index;
  }
  const visible = entries.slice(start, end);
  const statusColor =
    status === 'running'
      ? theme.accent
      : status === 'completed'
        ? theme.success
        : status === 'paused'
          ? theme.warning
          : status === 'failed'
            ? theme.danger
            : theme.faint;

  return (
    <Box flexDirection="column" flexGrow={1} overflow="hidden">
      <Box flexDirection="column" flexGrow={1} overflow="hidden" paddingTop={1}>
        {start > 0 ? (
          <Box flexShrink={0}>
            <Text color={theme.faint}>
              {glyph.arrowUp} {start} earlier {glyph.bullet} pgup to scroll back
            </Text>
          </Box>
        ) : null}
        {entries.length === 0 ? (
          <Box flexDirection="column" paddingY={1}>
            <Text bold color={theme.text}>
              Ready when you are.
            </Text>
            <Text color={theme.muted} wrap="wrap">
              Describe a coding task. ComiCode inspects the project, edits files, runs checks, and
              pauses safely when a provider runs out of quota.
            </Text>
            <Box flexDirection="column" marginTop={1}>
              <Text color={theme.faint}>
                <Text color={theme.accent}>/</Text> commands with completion
                <Text color={theme.faint}>{`  ${glyph.bullet}  `}</Text>
                <Text color={theme.accent}>{glyph.arrowLeft}</Text>/
                <Text color={theme.accent}>{glyph.arrowRight}</Text> switch screens
              </Text>
              <Text color={theme.faint}>
                <Text color={theme.accent}>enter</Text> send
                <Text color={theme.faint}>{`  ${glyph.bullet}  `}</Text>
                <Text color={theme.accent}>ctrl+k</Text> command palette
                <Text color={theme.faint}>{`  ${glyph.bullet}  `}</Text>
                <Text color={theme.accent}>/help</Text> all commands
              </Text>
            </Box>
          </Box>
        ) : (
          visible.map((entry) => <EntryCard key={entry.id} entry={entry} />)
        )}
        {scrollOffset > 0 && visible.length === 0 ? (
          <Empty>No more transcript above. Press pgdn to return to the latest output.</Empty>
        ) : null}
      </Box>

      {plan?.steps?.length ? (
        <Box flexDirection="column" flexShrink={0} marginBottom={1}>
          <Text color={theme.muted} wrap="truncate">
            <Text color={theme.accent}>▤ plan </Text>
            {plan.summary}
          </Text>
          <Text color={theme.faint}>
            {plan.steps.filter((step) => step.status === 'completed').length}/{plan.steps.length}{' '}
            steps complete
          </Text>
        </Box>
      ) : null}

      {confirmRequest ? (
        <ConfirmDialog request={confirmRequest} onDecision={respondConfirm} />
      ) : running ? (
        <Box flexDirection="column" flexShrink={0} borderStyle="round" borderColor={theme.border}>
          <Box paddingX={1} justifyContent="space-between">
            <Spinner frame={frame} label={route ? `working ${glyph.route} ${route}` : 'working'} />
            <Text color={theme.faint}>
              {formatCount(usage.inputTokens)} in / {formatCount(usage.outputTokens)} out
              {`  ${glyph.bullet}  `}esc pauses
            </Text>
          </Box>
        </Box>
      ) : (
        <Box
          flexDirection="column"
          flexShrink={0}
          borderStyle="round"
          borderColor={status === 'paused' ? theme.warning : theme.accentDim}
          paddingX={1}
        >
          <PromptInput
            value={input}
            onChange={setInput}
            onSubmit={submit}
            focus={active}
            suggestions={suggestions}
            history={history}
            onCycleScreen={onCycleScreen}
            placeholder={
              status === 'paused'
                ? 'Describe the next step, /resume, or /new'
                : 'Ask ComiCode to build, fix, test, or explain…'
            }
          />
          {suggestions.length === 0 ? (
            <Box>
              <Text color={theme.faint} wrap="truncate">
                enter send {glyph.bullet} / commands {glyph.bullet} tab next screen {glyph.bullet}{' '}
                {glyph.arrowLeft}/{glyph.arrowRight} screens
              </Text>
            </Box>
          ) : null}
        </Box>
      )}

      <Box flexShrink={0} justifyContent="space-between" paddingX={1} marginTop={1}>
        <Text wrap="truncate">
          <Text color={statusColor}>
            {status === 'running'
              ? `${glyph.dot} ${status}`
              : status === 'completed'
                ? `${glyph.check} ${status}`
                : status === 'failed'
                  ? `${glyph.cross} ${status}`
                  : `${glyph.ring} ${status}`}
          </Text>
          {route ? (
            <Text color={theme.violet}>
              {'  '}
              {glyph.route} {clip(route, 54)}
            </Text>
          ) : null}
          {task ? (
            <Text color={theme.faint}>
              {' '}
              {glyph.bullet} task {task.id.slice(0, 8)}
            </Text>
          ) : (
            <Text color={theme.faint}> {glyph.bullet} no task yet</Text>
          )}
        </Text>
        <Text color={theme.faint} wrap="truncate">
          {formatCount(usage.inputTokens + usage.outputTokens)} tokens
          {pauseReason
            ? ` ${glyph.bullet} ${clip(pauseReason, 48)}`
            : lastResult
              ? ` ${glyph.bullet} ${clip(lastResult, 48)}`
              : ''}
        </Text>
      </Box>
    </Box>
  );
}
