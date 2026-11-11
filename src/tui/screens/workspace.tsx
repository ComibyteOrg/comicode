import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { AppContext } from '../../core/app.js';
import type { AgentHooks, ConfirmationRequest, ConfirmDecision } from '../../core/agent/types.js';
import { CodingAgent, DEFAULT_AUTHORITY } from '../../core/agent/agent.js';
import { nextAgentMode, type AgentMode } from '../../core/agent/modes.js';
import type { TaskPlan, TaskRecord } from '../../core/types.js';
import {
  clip,
  clipLines,
  Empty,
  formatCount,
  PromptInput,
  Spinner,
  useLayout,
  wrapText,
  type AgentStatus,
  type ScreenId,
} from '../components.js';
import { ConfirmDialog } from '../dialogs/confirm-dialog.js';
import { ModalWindow } from '../dialogs/modal.js';
import { glyph, theme } from '../theme.js';
import { commandRegistry, type CommandContext } from '../commands/registry.js';
import { listProjectFiles } from '../../core/safety/files.js';
import { disableMouseTracking, enableMouseWheel, isMouseSequence, isSuppressedInput } from '../mouse.js';

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

export type WorkspaceDialogId =
  | 'palette'
  | 'model-picker'
  | 'connect'
  | 'providers'
  | 'tasks'
  | 'diff'
  | 'undo'
  | 'status'
  | 'usage'
  | 'settings'
  | 'shortcuts'
  | null;

interface WorkspaceProps {
  context: AppContext;
  active: boolean;
  onStatusChange: (status: AgentStatus) => void;
  onNavigate: (screen: ScreenId) => void;
  onCycleScreen: (direction: 1 | -1) => void;
  onOpenDialog?: (dialog: WorkspaceDialogId) => void;
  onQuit: () => void;
  resumeRequest: ResumeRequest | null;
  notify: (message: string) => void;
  refreshData: () => void;
  dimmed?: boolean;
  agentMode?: AgentMode;
  onAgentMode?: (mode: AgentMode) => void;
  onShowOutput?: (title: string, text: string) => void;
  /** Release mouse capture so the terminal can highlight and copy text. */
  selectionMode?: boolean;
  onToggleSelection?: () => void;
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
        entries.push({
          id: ++id,
          kind: 'assistant',
          text: clipLines(message.content, 100, 20_000),
        });
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

/**
 * Long answers keep both the beginning and the end visible — the conclusion
 * matters as much as the setup. Bounded so the transcript stays fast.
 */
function clipAnswer(text: string, headLines = 14, tailLines = 30): string {
  const maxChars = 20_000;
  let body = text;
  if (body.length > maxChars) {
    const headChars = Math.floor(maxChars * 0.4);
    body = `${body.slice(0, headChars)}\n…\n${body.slice(-(maxChars - headChars))}`;
  }
  const lines = body.split('\n');
  if (lines.length <= headLines + tailLines + 2) return body;
  const hidden = lines.length - headLines - tailLines;
  return [...lines.slice(0, headLines), `[+${hidden} lines]`, ...lines.slice(-tailLines)].join(
    '\n',
  );
}

function entryDisplay(entry: Entry): string {
  if (entry.kind === 'assistant') return clipAnswer(entry.text);
  if (entry.kind === 'summary') return clipAnswer(entry.text, 20, 40);
  if (entry.kind === 'review') return clipAnswer(entry.text, 12, 24);
  const role = roleFor(entry);
  return clipLines(entry.text, role.lines, role.chars);
}

/** Plain-text rendering of the transcript for clipboard export. */
function transcriptText(entries: Entry[]): string {
  return entries
    .map((entry) => {
      const role = roleFor(entry);
      return `${role.marker} ${role.label}\n${entryDisplay(entry)}`;
    })
    .join('\n\n');
}

/**
 * Wrap a multi-line transcript body while preserving the source line breaks.
 * The result is also used to measure entry height, so the scroll viewport can
 * move by terminal lines instead of jumping whole entries.
 */
function wrapBodyLines(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    if (raw.length === 0) {
      lines.push('');
      continue;
    }
    for (const wrapped of wrapText(raw, width)) lines.push(wrapped.text);
  }
  return lines.length > 0 ? lines : [''];
}

function EntryCard({
  entry,
  dimmed,
  bodyLines,
  fromLine = 0,
  toLine,
  showHeader = true,
  showMargin = true,
}: {
  entry: Entry;
  dimmed?: boolean;
  bodyLines?: string[];
  fromLine?: number;
  toLine?: number;
  showHeader?: boolean;
  showMargin?: boolean;
}): React.ReactElement {
  const role = roleFor(entry);
  const lines = bodyLines ?? wrapBodyLines(entryDisplay(entry), 80);
  const end = Math.max(0, Math.min(lines.length, toLine ?? lines.length));
  const start = Math.max(0, Math.min(end, fromLine));
  const visible = lines.slice(start, end);
  return (
    <Box flexDirection="column" marginBottom={showMargin ? 1 : 0} flexShrink={0}>
      {showHeader ? (
        <Text color={role.color} bold dimColor={dimmed}>
          {role.marker} {role.label}
        </Text>
      ) : null}
      {visible.length > 0 ? (
        <Box paddingLeft={2} flexDirection="column">
          {visible.map((line, index) => (
            <Text key={`${start + index}`} color={role.bodyColor} wrap="truncate" dimColor={dimmed}>
              {line.length > 0 ? line : ' '}
            </Text>
          ))}
        </Box>
      ) : null}
    </Box>
  );
}

export function Workspace({
  context,
  active,
  onStatusChange,
  onNavigate,
  onCycleScreen,
  onOpenDialog,
  onQuit,
  resumeRequest,
  notify,
  refreshData,
  dimmed = false,
  agentMode = 'build',
  onAgentMode,
  onShowOutput,
  selectionMode = false,
  onToggleSelection,
}: WorkspaceProps): React.ReactElement {
  const { rows, columns } = useLayout();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [input, setInput] = useState('');
  const [queue, setQueue] = useState<string[]>([]);
  const [history, setHistory] = useState<string[]>([]);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [jumpOpen, setJumpOpen] = useState(false);
  const [jumpIndex, setJumpIndex] = useState(0);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<AgentStatus>('idle');
  const [taskId, setTaskId] = useState<string | null>(null);
  const [plan, setPlan] = useState<TaskPlan | null>(null);
  const [route, setRoute] = useState<string | null>(null);
  const [usage, setUsage] = useState({ inputTokens: 0, outputTokens: 0 });
  const [lastInputTokens, setLastInputTokens] = useState(0);
  const [confirmRequest, setConfirmRequest] = useState<ConfirmationRequest | null>(null);
  const [frame, setFrame] = useState(0);
  const [pauseReason, setPauseReason] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<string | null>(null);

  const nextId = useRef(1);
  const abortRef = useRef<AbortController | null>(null);
  const confirmResolve = useRef<((decision: ConfirmDecision) => void) | null>(null);
  const adoptedNonce = useRef(0);
  const streamingId = useRef<number | null>(null);
  const maxOffsetRef = useRef(0);

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
    if (!running || selectionMode) return;
    const timer = setInterval(() => setFrame((value) => value + 1), 120);
    return () => clearInterval(timer);
  }, [running, selectionMode]);

  // Mouse wheel scrolls the transcript (wheel-up = older, wheel-down = newer).
  // Mouse capture is opt-in because it blocks the terminal's native
  // highlight/copy. It is also released while a dialog is open and in select
  // mode. Enable wheel support with settings ui.mouseScroll=true.
  useEffect(() => {
    if (selectionMode) {
      // Release immediately, even if a previous effect has not cleaned up yet.
      disableMouseTracking();
      return;
    }
    if (!active) return;
    // Always clear stale mouse modes first — a crashed previous session can
    // leave reporting enabled, which silently breaks native text selection.
    disableMouseTracking();
    if (context.store.getSettings().ui.mouseScroll !== true) return;
    return enableMouseWheel((direction) => {
      if (!active) return;
      setScrollOffset((value) =>
        Math.max(0, Math.min(maxOffsetRef.current, value - direction * 3)),
      );
    });
  }, [active, context, selectionMode]);

  const respondConfirm = useCallback((decision: ConfirmDecision) => {
    const resolve = confirmResolve.current;
    confirmResolve.current = null;
    setConfirmRequest(null);
    resolve?.(decision);
  }, []);

  const askConfirm = useCallback(
    (request: ConfirmationRequest) =>
      new Promise<ConfirmDecision>((resolve) => {
        confirmResolve.current = resolve;
        setConfirmRequest(request);
      }),
    [],
  );

  const makeHooks = useCallback((): AgentHooks => {
    return {
      confirm: askConfirm,
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
          addEntry({ kind: 'assistant', text: content.slice(-80_000) });
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
        setLastInputTokens(turnUsage.inputTokens);
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
          mode: agentMode,
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
    [addEntry, agentMode, askConfirm, context, makeHooks, refreshData, running, updateStatus],
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
        const mentions = [
          ...new Set(
            [...request.matchAll(/@([^\s@]+)/g)]
              .map((match) => match[1]!)
              .filter((path) => fileIndex.length === 0 || fileIndex.includes(path)),
          ),
        ];
        const withMentions = (task: TaskRecord): void => {
          if (!mentions.length) return;
          context.store.updateTask(task.id, {
            relevantFiles: [...new Set([...(task.relevantFiles ?? []), ...mentions])],
          });
        };
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
          withMentions(task);
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
        withMentions(task);
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
      setLastInputTokens(0);
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

  const [fileIndex, setFileIndex] = useState<string[]>([]);
  useEffect(() => {
    let active = true;
    void listProjectFiles(context.cwd, 4000)
      .then((files) => {
        if (active) setFileIndex(files.map((file) => file.path));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [context.cwd]);

  const suggestions = useMemo(() => {
    const mention = /(^|\s)@([^\s@]*)$/.exec(input);
    if (mention) {
      const atIndex = input.length - mention[0].length + (mention[1]?.length ?? 0);
      const prefix = input.slice(0, atIndex);
      const needle = mention[2]!.toLowerCase();
      return fileIndex
        .filter((path) => {
          const lower = path.toLowerCase();
          return (
            lower.includes(needle) || (path.split('/').pop() ?? '').toLowerCase().includes(needle)
          );
        })
        .slice(0, 8)
        .map((path) => ({
          value: `${prefix}@${path} `,
          label: path.split('/').pop() ?? path,
          detail: path,
          submit: false,
        }));
    }
    if (!input.startsWith('/')) return [];
    return commandRegistry.getSuggestions(context, input);
  }, [context, input, fileIndex]);

  const handleCommand = useCallback(
    async (raw: string): Promise<void> => {
      const commandContext: CommandContext = {
        context,
        notify,
        refreshData,
        openDialog: (d) => onOpenDialog?.(d as WorkspaceDialogId),
        closeDialog: () => onOpenDialog?.(null),
        navigateToScreen: (s) => onNavigate(s),
        setTaskId: (id) => {
          setTaskId(id);
          if (!id) {
            setPlan(null);
            setPauseReason(null);
            setLastResult(null);
            setUsage({ inputTokens: 0, outputTokens: 0 });
            setLastInputTokens(0);
            setEntries([]);
            setScrollOffset(0);
            updateStatus('idle');
          }
        },
        getActiveTaskId: () => taskId,
        getTranscriptText: () => transcriptText(entries),
        clearTranscript: () => {
          setEntries([]);
          setScrollOffset(0);
        },
        addNotice: (title, text) => {
          if (onShowOutput && ['help', 'skills', 'compact'].includes(title)) {
            onShowOutput(title, text);
          } else {
            addEntry({ kind: 'notice', title, text });
          }
        },
        showOutput: onShowOutput,
        addError: (text) => {
          addEntry({ kind: 'error', text });
        },
        executeTask: async (id, resume) => {
          await execute(id, resume);
        },
        toggleToolsExpanded: () => {},
        onQuit,
        agentMode,
        setAgentMode: (mode) => onAgentMode?.(mode),
        confirm: askConfirm,
      };

      const handled = await commandRegistry.execute(raw, commandContext);
      if (!handled) {
        addEntry({
          kind: 'error',
          text: `Unknown command "${raw.trim()}". Type /help for available commands.`,
        });
      }
    },
    [
      addEntry,
      agentMode,
      askConfirm,
      context,
      execute,
      notify,
      onAgentMode,
      onNavigate,
      onOpenDialog,
      onQuit,
      onShowOutput,
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
      if (running && !trimmed.startsWith('/')) {
        setQueue((previous) => [...previous, trimmed]);
        addEntry({
          kind: 'notice',
          title: 'queued',
          text: `Queued while the agent runs: ${clip(trimmed, 90)}`,
        });
        return;
      }
      if (trimmed.startsWith('/')) {
        void handleCommand(trimmed);
        return;
      }
      void startRequest(trimmed);
    },
    [addEntry, handleCommand, running, startRequest],
  );

  // Drain the prompt queue one message at a time after each run finishes.
  useEffect(() => {
    if (running || queue.length === 0) return;
    const [next, ...rest] = queue;
    setQueue(rest);
    if (next!.startsWith('/')) void handleCommand(next!);
    else void startRequest(next!);
  }, [running, queue, handleCommand, startRequest]);

  // ---------------------------------------------------------------- viewport
  // Measure the transcript in terminal lines. Scrolling then moves by lines,
  // so wheel/page keys feel continuous even when individual answers are tall.
  const bodyWidth = Math.max(24, columns - 8);
  const entryLayouts = useMemo(() => {
    let line = 0;
    return entries.map((entry) => {
      const lines = wrapBodyLines(entryDisplay(entry), bodyWidth);
      const height = 1 + lines.length + 1; // header + body + margin
      const layout = { entry, lines, start: line, height };
      line += height;
      return layout;
    });
  }, [entries, bodyWidth]);
  const totalLines = entryLayouts.reduce((sum, layout) => sum + layout.height, 0);
  const lineBudget = Math.max(5, rows - 18);
  const maxOffset = Math.max(0, totalLines - lineBudget);
  maxOffsetRef.current = maxOffset;
  const visibleOffset = Math.min(scrollOffset, maxOffset);
  const viewStart = Math.max(0, totalLines - lineBudget - visibleOffset);
  const viewEnd = viewStart + lineBudget;
  const visibleLayouts = entryLayouts
    .filter((layout) => layout.start < viewEnd && layout.start + layout.height > viewStart)
    .map((layout) => {
      const localStart = Math.max(0, viewStart - layout.start);
      const localEnd = Math.min(layout.height, viewEnd - layout.start);
      return {
        ...layout,
        localStart,
        localEnd,
        fromLine: Math.max(0, localStart - 1),
        toLine: Math.max(0, localEnd - 1),
      };
    });

  useEffect(() => {
    setScrollOffset((value) => Math.min(value, maxOffset));
  }, [maxOffset]);

  useInput(
    (input, key) => {
      if (isMouseSequence(input) || isSuppressedInput()) return;
      if (selectionMode) {
        if (key.escape) {
          onToggleSelection?.();
          return;
        }
        if (key.pageUp) {
          setScrollOffset((value) => Math.min(maxOffsetRef.current, value + lineBudget - 2));
          return;
        }
        if (key.pageDown) {
          setScrollOffset((value) => Math.max(0, value - (lineBudget - 2)));
          return;
        }
      }
      if (key.escape && running) {
        abortRef.current?.abort();
        notify('Pausing after the current operation…');
        return;
      }
      if (key.pageUp || (key.ctrl && key.upArrow)) {
        setScrollOffset((value) => Math.min(maxOffsetRef.current, value + lineBudget - 2));
        return;
      }
      if (key.pageDown || (key.ctrl && key.downArrow)) {
        setScrollOffset((value) => Math.max(0, value - (lineBudget - 2)));
        return;
      }
      if (key.ctrl && input === 'j') {
        const users = entries.flatMap((entry, index) => (entry.kind === 'user' ? [index] : []));
        if (users.length > 0) {
          setJumpIndex(users.length - 1);
          setJumpOpen(true);
        }
        return;
      }
      if (running) {
        if (key.leftArrow) onCycleScreen(-1);
        else if (key.rightArrow) onCycleScreen(1);
        else if (key.tab) onCycleScreen(key.shift ? -1 : 1);
      }
    },
    // Selection mode keeps esc/scroll keys live even while an inline approval
    // prompt is open, but a modal dialog still owns the keyboard.
    { isActive: selectionMode ? !dimmed : active && !dimmed && !confirmRequest },
  );

  const task = taskId ? context.store.getTask(taskId) : null;
  const selectedProfile = (() => {
    const profiles = context.store.listProfiles();
    const selectedId = context.store.getSelectedProfileId();
    return (
      profiles.find((profile) => profile.id === selectedId) ??
      profiles.find((profile) => profile.enabled) ??
      null
    );
  })();
  const effortLabel = selectedProfile?.config?.effort;
  const effortText =
    typeof effortLabel === 'string' && effortLabel.length > 0 ? effortLabel : 'default';

  // Indices of user prompts, for the ctrl+j jump popup.
  const jumpTargets = entries.flatMap((entry, index) => (entry.kind === 'user' ? [index] : []));
  const jumpTo = useCallback(
    (entryIndex: number): void => {
      // Scroll so the question sits near the top of the viewport.
      const layout = entryLayouts.find((candidate) => candidate.entry === entries[entryIndex]);
      const targetStart = layout?.start ?? 0;
      setScrollOffset(Math.max(0, totalLines - lineBudget - targetStart));
      setJumpOpen(false);
    },
    [entries, entryLayouts, totalLines, lineBudget],
  );

  useInput(
    (input, key) => {
      if (key.escape) {
        setJumpOpen(false);
        return;
      }
      const jumpCount = jumpTargets.length;
      if (key.upArrow) {
        setJumpIndex((value) => (jumpCount === 0 ? 0 : (value - 1 + jumpCount) % jumpCount));
        return;
      }
      if (key.downArrow || key.pageDown) {
        setJumpIndex((value) => (jumpCount === 0 ? 0 : (value + 1) % jumpCount));
        return;
      }
      if (key.return) {
        const target = jumpTargets[Math.min(jumpIndex, jumpTargets.length - 1)];
        if (target !== undefined) jumpTo(target);
      }
    },
    { isActive: jumpOpen },
  );

  // Scrollbar geometry — the thumb tracks the visible line window.
  const trackHeight = Math.max(6, lineBudget);
  const thumbHeight =
    totalLines > lineBudget
      ? Math.max(
          1,
          Math.min(trackHeight, Math.round((trackHeight * lineBudget) / Math.max(1, totalLines))),
        )
      : 0;
  const thumbTop =
    thumbHeight > 0
      ? Math.round(((trackHeight - thumbHeight) * viewStart) / Math.max(1, totalLines - lineBudget))
      : 0;
  const scrollbar =
    thumbHeight > 0 ? (
      <Box flexDirection="column" flexShrink={0} paddingLeft={1}>
        {Array.from({ length: trackHeight }, (_, i) => {
          const inThumb = i >= thumbTop && i < thumbTop + thumbHeight;
          return (
            <Text
              key={i}
              color={inThumb ? theme.accent : theme.faint}
              dimColor={dimmed && !inThumb}
            >
              {inThumb ? '█' : '░'}
            </Text>
          );
        })}
      </Box>
    ) : null;

  const jumpShown = jumpTargets.slice(-14);
  const jumpBase = jumpTargets.length - jumpShown.length;
  const jumpSel = Math.min(jumpIndex, Math.max(0, jumpTargets.length - 1));

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

  const composerArea = confirmRequest ? (
    <ConfirmDialog request={confirmRequest} onDecision={respondConfirm} />
  ) : (
    <>
      {running ? (
        <Box flexDirection="column" flexShrink={0} borderStyle="round" borderColor={theme.border}>
          <Box paddingX={1} justifyContent="space-between">
            <Spinner frame={frame} label={route ? `working ${glyph.route} ${route}` : 'working'} />
            <Text color={theme.faint} dimColor={dimmed}>
              {formatCount(usage.inputTokens)} in / {formatCount(usage.outputTokens)} out
              {lastInputTokens > 0 ? ` · ctx ~${formatCount(lastInputTokens)}` : ''}
              {queue.length > 0 ? ` · ${queue.length} queued` : ''}
              {`  ${glyph.bullet}  `}type to queue · esc pauses
            </Text>
          </Box>
        </Box>
      ) : null}
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
          focus={active && !dimmed}
          suggestions={suggestions}
          history={history}
          onCycleScreen={onCycleScreen}
          onCycleMode={(direction) => onAgentMode?.(nextAgentMode(agentMode, direction))}
          placeholder={
            status === 'paused'
              ? 'Describe the next step, /resume, or /new'
              : 'Ask ComiCode to build, fix, test, or explain…'
          }
        />
        {suggestions.length === 0 ? (
          <Box>
            <Text color={theme.faint} wrap="truncate" dimColor={dimmed}>
              enter send {glyph.bullet} / commands {glyph.bullet} ctrl+m model {glyph.bullet} ctrl+b
              provider {glyph.bullet} ctrl+p palette {glyph.bullet} ctrl+j questions
            </Text>
          </Box>
        ) : null}
      </Box>
    </>
  );

  const statusFooter = (
    <Box flexDirection="column" flexShrink={0} paddingX={1} marginTop={1}>
      <Text wrap="truncate" dimColor={dimmed}>
        <Text color={statusColor}>
          {status === 'running'
            ? `${glyph.dot} ${status}`
            : status === 'completed'
              ? `${glyph.check} ${status}`
              : status === 'failed'
                ? `${glyph.cross} ${status}`
                : `${glyph.ring} ${status}`}
        </Text>
        <Text
          color={
            agentMode === 'plan' ? theme.info : agentMode === 'debug' ? theme.warning : theme.muted
          }
        >
          {'  '}
          {glyph.route} {agentMode}
        </Text>
        <Text color={theme.faint}>
          {'  '}
          effort {effortText}
        </Text>
        {selectedProfile ? (
          <Text color={theme.muted}>
            {'  '}
            {glyph.route} {clip(selectedProfile.name, 24)}
          </Text>
        ) : (
          <Text color={theme.faint}>
            {'  '}
            {glyph.route} no profile
          </Text>
        )}
      </Text>
      <Text wrap="truncate" dimColor={dimmed}>
        {route ? (
          <Text color={theme.violet}>
            {glyph.route} {clip(route, 54)}
          </Text>
        ) : (
          <Text color={theme.faint}>{glyph.route} no route yet</Text>
        )}
        {task ? (
          <Text color={theme.faint}>
            {'  '}
            {glyph.bullet} task {task.id.slice(0, 8)}
          </Text>
        ) : (
          <Text color={theme.faint}> {glyph.bullet} no task yet</Text>
        )}
      </Text>
      <Text color={theme.faint} wrap="truncate" dimColor={dimmed}>
        {usage.inputTokens + usage.outputTokens > 0
          ? `${formatCount(usage.inputTokens)} in · ${formatCount(usage.outputTokens)} out`
          : `${formatCount(usage.inputTokens + usage.outputTokens)} tokens`}
        {lastInputTokens > 0 ? ` · ctx ~${formatCount(lastInputTokens)}` : ''}
        {pauseReason
          ? ` ${glyph.bullet} ${clip(pauseReason, 48)}`
          : lastResult
            ? ` ${glyph.bullet} ${clip(lastResult, 48)}`
            : ''}
      </Text>
    </Box>
  );

  const selectionBanner = selectionMode ? (
    <Box flexShrink={0} paddingTop={1}>
      <Text color={theme.success} wrap="truncate">
        ⌘ SELECT MODE {glyph.bullet} drag to highlight, then copy with your terminal
        {glyph.bullet} esc / ctrl+y exits
      </Text>
    </Box>
  ) : null;

  if (entries.length === 0) {
    return (
      <Box flexDirection="column" flexGrow={1} paddingX={2}>
        {selectionBanner}
        <Box flexDirection="column" flexGrow={1} justifyContent="center">
          <Box flexDirection="column" alignItems="center" width="100%">
            <Box flexDirection="column" alignItems="center" marginBottom={1}>
              <Text color={theme.accent} bold wrap="truncate">
                {' ██████╗   ██████╗  ███╗   ███╗ ██╗  ██████╗   ██████╗  ██████╗  ███████╗\n' +
                  '██╔════╝  ██╔═══██╗ ████╗ ████║ ██║ ██╔════╝  ██╔═══██╗ ██╔══██╗ ██╔════╝\n' +
                  '██║       ██║   ██║ ██╔████╔██║ ██║ ██║       ██║   ██║ ██║  ██║ █████╗  \n' +
                  '██║       ██║   ██║ ██║╚██╔╝██║ ██║ ██║       ██║   ██║ ██║  ██║ ██╔══╝  \n' +
                  '╚██████╗  ╚██████╔╝ ██║ ╚═╝ ██║ ██║ ╚██████╗  ╚██████╔╝ ██████╔╝ ███████╗\n' +
                  ' ╚═════╝   ╚═════╝  ╚═╝     ╚═╝ ╚═╝  ╚═════╝   ╚═════╝  ╚═════╝  ╚══════╝'}
              </Text>
              <Text color={theme.faint} dimColor={dimmed}>
                {glyph.route} what should we build?
              </Text>
              <Text color={theme.faint} dimColor={dimmed}>
                try: “fix a bug” {glyph.bullet} “build a feature” {glyph.bullet} “explain this code”
              </Text>
            </Box>
            <Box flexDirection="column" width="100%" maxWidth={84}>
              {composerArea}
            </Box>
            <Box flexDirection="column" width="100%" maxWidth={84}>
              {statusFooter}
            </Box>
          </Box>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" flexGrow={1} overflow="hidden">
      <Box flexDirection="row" flexGrow={1} overflow="hidden">
        <Box flexDirection="column" flexGrow={1} overflow="hidden" paddingTop={1}>
          {selectionBanner}
          {viewStart > 0 ? (
            <Box flexShrink={0}>
              <Text color={theme.faint} dimColor={dimmed}>
                {glyph.arrowUp} {viewStart} earlier {viewStart === 1 ? 'line' : 'lines'}{' '}
                {glyph.bullet} pgup to scroll back
              </Text>
            </Box>
          ) : null}
          {visibleLayouts.map((layout) => (
            <EntryCard
              key={layout.entry.id}
              entry={layout.entry}
              dimmed={dimmed}
              bodyLines={layout.lines}
              fromLine={layout.fromLine}
              toLine={layout.toLine}
              showHeader={layout.localStart === 0}
              showMargin={layout.localEnd >= layout.height}
            />
          ))}
          {visibleOffset > 0 && visibleLayouts.length === 0 ? (
            <Empty>No more transcript above. Press pgdn to return to the latest output.</Empty>
          ) : null}
        </Box>
        {scrollbar}
      </Box>

      {plan?.steps?.length ? (
        <Box flexDirection="column" flexShrink={0} marginBottom={1}>
          <Text color={theme.muted} wrap="truncate" dimColor={dimmed}>
            <Text color={theme.accent}>▤ plan </Text>
            {plan.summary}
          </Text>
          <Text color={theme.faint} dimColor={dimmed}>
            {plan.steps.filter((step) => step.status === 'completed').length}/{plan.steps.length}{' '}
            steps complete
          </Text>
        </Box>
      ) : null}

      {composerArea}

      {jumpOpen && jumpTargets.length > 0 ? (
        <ModalWindow
          title="JUMP TO QUESTION"
          subtitle={`${jumpTargets.length} prompt${jumpTargets.length === 1 ? '' : 's'} in this task`}
          width={72}
          height={Math.min(rows - 4, 20)}
          footer={['↑/↓ choose', 'enter jump to that point', 'esc close · pgdn latest']}
        >
          <Box flexDirection="column" flexGrow={1} overflow="hidden">
            {jumpShown.map((entryIndex, offset) => {
              const pos = jumpBase + offset;
              const selected = pos === jumpSel;
              const prompt = entries[entryIndex]?.text ?? '';
              return (
                <Box key={entryIndex}>
                  <Text
                    color={selected ? theme.black : theme.text}
                    backgroundColor={selected ? theme.accent : undefined}
                    wrap="truncate"
                  >
                    {selected ? `${glyph.active} ` : '  '}
                    {clip(prompt, 64)}
                  </Text>
                </Box>
              );
            })}
            {jumpTargets.length > jumpShown.length ? (
              <Text color={theme.faint}> ⋮ {jumpTargets.length - jumpShown.length} earlier</Text>
            ) : null}
          </Box>
        </ModalWindow>
      ) : null}

      {statusFooter}
    </Box>
  );
}
