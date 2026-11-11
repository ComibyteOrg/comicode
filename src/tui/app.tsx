import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, render, useApp, useInput } from 'ink';
import type { AppContext } from '../core/app.js';
import { openAppContext } from '../core/app.js';
import type { TaskRecord } from '../core/types.js';
import { refreshProfileModels } from '../core/providers/service.js';
import { gitBranch } from '../core/git/repository.js';
import {
  Footer,
  Header,
  PromptInput,
  useLayout,
  type AgentStatus,
} from './components.js';
import { Workspace, type ResumeRequest } from './screens/workspace.js';
import { ProvidersDialog } from './dialogs/providers-dialog.js';
import { ModelPicker } from './dialogs/model-picker.js';
import { ConnectDialog } from './dialogs/connect-dialog.js';
import { TasksDialog } from './dialogs/tasks-dialog.js';
import { DiffDialog } from './dialogs/diff-dialog.js';
import { UndoDialog } from './dialogs/undo-dialog.js';
import { StatusDialog } from './dialogs/status-dialog.js';
import { UsageDialog } from './dialogs/usage-dialog.js';
import { SettingsDialog } from './dialogs/settings-dialog.js';
import { ShortcutsDialog } from './dialogs/shortcuts-dialog.js';
import { OutputDialog } from './dialogs/output-dialog.js';
import { EffortDialog } from './dialogs/effort-dialog.js';
import { ModalWindow } from './dialogs/modal.js';
import { shortcutMatches } from './shortcuts/manager.js';
import { nextAgentMode, type AgentMode } from '../core/agent/modes.js';
import { VERSION } from '../version.js';
import { glyph, setActiveTheme, theme } from './theme.js';

export type DialogId =
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
  | 'output'
  | 'effort';

interface PaletteAction {
  label: string;
  detail: string;
  run: () => void | Promise<void>;
}

function App({ context }: { context: AppContext }): React.ReactElement {
  const { exit } = useApp();
  const { columns, rows } = useLayout();
  // Keep the live theme proxy in sync with the persisted setting.
  setActiveTheme(context.store.getSettings().ui.theme);
  const [status, setStatus] = useState<AgentStatus>('idle');
  const [tick, setTick] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [resumeRequest, setResumeRequest] = useState<ResumeRequest | null>(null);
  // Dialog stack: the top entry is the visible modal. Nested dialogs push
  // entries; closing pops back to the previous one.
  const [dialogStack, setDialogStack] = useState<DialogId[]>([]);
  const [paletteQuery, setPaletteQuery] = useState('');
  const [paletteIndex, setPaletteIndex] = useState(0);
  const [branch, setBranch] = useState<string | null>(null);
  const [agentMode, setAgentMode] = useState<AgentMode>('auto');
  const [outputContent, setOutputContent] = useState<{ title: string; text: string } | null>(
    null,
  );
  const quitArmedAt = useRef(0);
  const activeDialog = dialogStack.length > 0 ? dialogStack[dialogStack.length - 1]! : null;
  const isDialogOpen = activeDialog !== null;

  const openDialog = useCallback((id: DialogId) => {
    setDialogStack((stack) => (stack[stack.length - 1] === id ? stack : [...stack, id]));
  }, []);
  const closeDialog = useCallback(() => {
    setDialogStack((stack) => stack.slice(0, -1));
  }, []);
  const closeAllDialogs = useCallback(() => setDialogStack([]), []);
  const showOutput = useCallback(
    (title: string, text: string) => {
      setOutputContent({ title, text });
      openDialog('output');
    },
    [openDialog],
  );

  const refreshData = useCallback(() => setTick((value) => value + 1), []);

  const notify = useCallback((message: string) => {
    setToast(message);
    setTick((value) => value + 1);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    let active = true;
    void gitBranch(context.cwd).then((b) => {
      if (active) setBranch(b);
    });
    return () => {
      active = false;
    };
  }, [context.cwd, tick]);

  const openTask = useCallback((taskId: string, resume: boolean) => {
    setResumeRequest({ taskId, nonce: Date.now(), resume });
    closeAllDialogs();
  }, [closeAllDialogs]);

  const quit = useCallback(() => {
    exit();
  }, [exit]);

  const togglePaid = useCallback(() => {
    context.store.updateSettings((settings) => {
      settings.routing.allowPaid = !settings.routing.allowPaid;
      return settings;
    });
    const enabled = context.store.getSettings().routing.allowPaid;
    notify(`Paid fallbacks ${enabled ? 'enabled' : 'disabled'} for future runs.`);
    refreshData();
  }, [context, notify, refreshData]);

  const latestPaused = useCallback((): TaskRecord | null => {
    return (
      context.store
        .listTasks({ projectPath: context.cwd, limit: 100 })
        .find((task) => task.status === 'paused' || task.status === 'failed') ?? null
    );
  }, [context]);

  const paletteActions = useMemo<PaletteAction[]>(
    () => [
      {
        label: 'Select an AI model',
        detail: 'model-picker (ctrl+m)',
        run: () => openDialog('model-picker'),
      },
      {
        label: 'Choose reasoning effort',
        detail: 'effort (ctrl+e) or /profile',
        run: () => openDialog('effort'),
      },
      {
        label: 'Manage providers & profiles',
        detail: 'providers (ctrl+b)',
        run: () => openDialog('providers'),
      },
      {
        label: 'Connect a new provider',
        detail: 'connect',
        run: () => openDialog('connect'),
      },
      {
        label: 'Manage active & saved tasks',
        detail: 'tasks (ctrl+t)',
        run: () => openDialog('tasks'),
      },
      {
        label: 'View token usage & limits',
        detail: 'usage',
        run: () => openDialog('usage'),
      },
      {
        label: 'View git diff for task',
        detail: 'diff',
        run: () => openDialog('diff'),
      },
      {
        label: 'Safe undo task changes',
        detail: 'undo',
        run: () => openDialog('undo'),
      },
      {
        label: 'View system and quota status',
        detail: 'status (ctrl+s)',
        run: () => openDialog('status'),
      },
      {
        label: 'Open settings',
        detail: 'settings',
        run: () => openDialog('settings'),
      },
      {
        label: 'Show keyboard shortcuts',
        detail: 'shortcuts (?)',
        run: () => openDialog('shortcuts'),
      },
      {
        label: 'Refresh all model catalogs',
        detail: 'models',
        run: async () => {
          const profiles = context.store.listProfiles().filter((profile) => profile.enabled);
          let discovered = 0;
          for (const profile of profiles) {
            try {
              const result = await refreshProfileModels(context.store, profile);
              discovered += result.discovered;
            } catch {
              // Per-profile failures are visible in the model picker.
            }
          }
          notify(`Refreshed ${discovered} models across ${profiles.length} profiles.`);
          refreshData();
        },
      },
      {
        label: 'Resume the latest paused task',
        detail: 'history',
        run: () => {
          const task = latestPaused();
          if (!task) {
            notify('There is no paused task to resume.');
            return;
          }
          openTask(task.id, true);
        },
      },
      {
        label: 'Cycle agent mode (build/plan/debug)',
        detail: 'tab',
        run: () => setAgentMode((mode) => nextAgentMode(mode, 1)),
      },
      {
        label: 'Toggle paid fallbacks',
        detail: 'settings',
        run: () => togglePaid(),
      },
      {
        label: 'Start a fresh task',
        detail: 'new (ctrl+n)',
        run: () => {
          setResumeRequest(null);
          notify('Ready for a new task.');
          refreshData();
        },
      },
      { label: 'Quit ComiCode', detail: 'exit', run: () => quit() },
    ],
    [context, latestPaused, notify, openDialog, openTask, quit, refreshData, togglePaid],
  );

  const filteredActions = useMemo(() => {
    const needle = paletteQuery.trim().toLowerCase();
    if (!needle) return paletteActions;
    return paletteActions.filter(
      (action) =>
        action.label.toLowerCase().includes(needle) || action.detail.toLowerCase().includes(needle),
    );
  }, [paletteActions, paletteQuery]);

  useEffect(() => {
    setPaletteIndex((value) => Math.min(value, Math.max(0, filteredActions.length - 1)));
  }, [filteredActions.length]);

  useInput((input, key) => {
    // While a modal is open it owns the keyboard; nothing leaks into the chat.
    if (isDialogOpen) return;

    const shortcutOverrides = context.store.getSettings().ui.shortcuts;
    if (shortcutMatches('quit', input, key, shortcutOverrides)) {
      if (status === 'running') {
        notify('Pause the run with esc before quitting.');
        return;
      }
      // Ctrl+C is also the terminal's copy shortcut, so quitting takes two
      // presses within a short window (OpenCode-style).
      const now = Date.now();
      if (now - quitArmedAt.current < 2000) {
        quitArmedAt.current = 0;
        quit();
        return;
      }
      quitArmedAt.current = now;
      notify('Press ctrl+c again to quit.');
      return;
    }

    if (shortcutMatches('palette', input, key, shortcutOverrides)) {
      openDialog('palette');
      setPaletteQuery('');
      setPaletteIndex(0);
      return;
    }

    if (shortcutMatches('model', input, key, shortcutOverrides)) {
      openDialog('model-picker');
      return;
    }

    if (shortcutMatches('provider', input, key, shortcutOverrides)) {
      openDialog('providers');
      return;
    }

    if (shortcutMatches('tasks', input, key, shortcutOverrides)) {
      openDialog('tasks');
      return;
    }

    if (shortcutMatches('status', input, key, shortcutOverrides)) {
      openDialog('status');
      return;
    }

    if (shortcutMatches('effort', input, key, shortcutOverrides)) {
      openDialog('effort');
      return;
    }

    if (shortcutMatches('newTask', input, key, shortcutOverrides)) {
      setResumeRequest(null);
      notify('Ready for a new task.');
      refreshData();
      return;
    }
  });

  useInput(
    (_input, key) => {
      if (key.escape) {
        closeDialog();
        setPaletteQuery('');
        return;
      }
      const count = filteredActions.length;
      if (key.upArrow) {
        setPaletteIndex((value) => (count === 0 ? 0 : (value - 1 + count) % count));
      } else if (key.downArrow) {
        setPaletteIndex((value) => (count === 0 ? 0 : (value + 1) % count));
      }
    },
    { isActive: activeDialog === 'palette' },
  );

  const runPaletteAction = (index: number): void => {
    const action = filteredActions[index];
    closeDialog();
    setPaletteQuery('');
    if (action) void action.run();
  };

  const profiles = context.store.listProfiles();
  const selectedProfile =
    profiles.find((profile) => profile.id === context.store.getSelectedProfileId()) ??
    profiles.find((profile) => profile.enabled) ??
    null;
  const selectedModelKey = context.store.getSelectedModelId();
  const selectedModel = selectedModelKey
    ? (context.store.listModels().find((model) => model.id === selectedModelKey) ?? null)
    : null;
  const allowPaid = context.store.getSettings().routing.allowPaid;

  const hints = isDialogOpen
    ? ['↑/↓ navigate', 'enter select', 'esc close']
    : [
        '/ commands',
        'enter send',
        'tab mode',
        'esc pause',
        'ctrl+k palette',
        'ctrl+m model',
        'ctrl+b providers',
        'ctrl+c×2 quit',
      ];

  void tick;

  const paletteRows = Math.max(4, rows - 14);
  const paletteStart = Math.max(
    0,
    Math.min(
      paletteIndex - Math.floor(paletteRows / 2),
      Math.max(0, filteredActions.length - paletteRows),
    ),
  );

  return (
    <Box flexDirection="column" height={rows} width={columns} overflow="hidden">
      <Header
        version={VERSION}
        cwd={context.cwd}
        profileName={selectedProfile?.name ?? null}
        modelName={selectedModel?.modelId ?? selectedProfile?.defaultModel ?? null}
        status={status}
        allowPaid={allowPaid}
        taskId={resumeRequest?.taskId ?? null}
        branch={branch}
        columns={columns}
        dimmed={isDialogOpen}
        agentMode={agentMode}
      />

      <Box flexDirection="column" flexGrow={1} overflow="hidden" paddingX={1}>
        {/* The chat workspace stays mounted and visible behind every dialog. */}
        <Workspace
          context={context}
          active={!isDialogOpen}
          dimmed={isDialogOpen}
          onStatusChange={setStatus}
          onNavigate={() => {}}
          onCycleScreen={() => {}}
          onOpenDialog={(d) => {
            if (d) openDialog(d);
            else closeDialog();
          }}
          onQuit={quit}
          resumeRequest={resumeRequest}
          notify={notify}
          refreshData={refreshData}
          agentMode={agentMode}
          onAgentMode={setAgentMode}
          onShowOutput={showOutput}
        />
      </Box>

      {activeDialog === 'palette' ? (
        <ModalWindow
          title="COMMAND PALETTE"
          subtitle={`${filteredActions.length} actions`}
          width={76}
          height={Math.max(10, rows - 8)}
          footer={['type to filter', '↑/↓ choose', 'enter run', 'esc close']}
        >
          <Box marginBottom={1} flexShrink={0}>
            <PromptInput
              value={paletteQuery}
              onChange={(value) => {
                setPaletteQuery(value);
                setPaletteIndex(0);
              }}
              onSubmit={() => runPaletteAction(paletteIndex)}
              focus
              placeholder="Search commands, providers, models, tasks…"
            />
          </Box>
          <Box flexDirection="column" flexGrow={1} overflow="hidden">
            {filteredActions.length === 0 ? (
              <Text color={theme.muted}>No matching actions.</Text>
            ) : (
              filteredActions
                .slice(paletteStart, paletteStart + paletteRows)
                .map((action, offset) => {
                  const index = paletteStart + offset;
                  const selected = index === paletteIndex;
                  return (
                    <Box key={action.label}>
                      <Text
                        color={selected ? theme.black : theme.text}
                        backgroundColor={selected ? theme.accent : undefined}
                        bold={selected}
                      >
                        {selected ? ` ${glyph.active} ` : '   '}
                        {action.label}
                        {'  '}
                      </Text>
                      <Text color={selected ? theme.black : theme.faint}>{action.detail}</Text>
                    </Box>
                  );
                })
            )}
          </Box>
        </ModalWindow>
      ) : null}

      {activeDialog === 'model-picker' ? (
        <ModelPicker
          context={context}
          onClose={closeDialog}
          notify={notify}
          refreshData={refreshData}
        />
      ) : null}

      {activeDialog === 'connect' ? (
        <ConnectDialog
          context={context}
          onClose={closeDialog}
          onConnected={(profile) => {
            notify(`Connected ${profile.name}.`);
            refreshData();
          }}
          notify={notify}
          refreshData={refreshData}
        />
      ) : null}

      {activeDialog === 'providers' ? (
        <ProvidersDialog
          context={context}
          onClose={closeDialog}
          notify={notify}
          refreshData={refreshData}
          onStatusChange={setStatus}
          onRequestConnect={() =>
            setDialogStack((stack) => [...stack.slice(0, -1), 'connect'])
          }
        />
      ) : null}

      {activeDialog === 'tasks' ? (
        <TasksDialog
          context={context}
          onClose={closeDialog}
          onOpenTask={(taskId, resume) => openTask(taskId, resume)}
          onNewTask={() => {
            setResumeRequest(null);
            notify('Ready for a new task.');
          }}
          notify={notify}
          refreshData={refreshData}
        />
      ) : null}

      {activeDialog === 'diff' ? (
        <DiffDialog context={context} taskId={resumeRequest?.taskId ?? null} onClose={closeDialog} />
      ) : null}

      {activeDialog === 'undo' ? (
        <UndoDialog
          context={context}
          taskId={resumeRequest?.taskId ?? null}
          onClose={closeDialog}
          notify={notify}
          refreshData={refreshData}
        />
      ) : null}

      {activeDialog === 'status' ? (
        <StatusDialog
          context={context}
          taskId={resumeRequest?.taskId ?? null}
          onClose={closeDialog}
        />
      ) : null}

      {activeDialog === 'usage' ? (
        <UsageDialog
          context={context}
          onClose={closeDialog}
          notify={notify}
          refreshData={refreshData}
        />
      ) : null}

      {activeDialog === 'settings' ? (
        <SettingsDialog
          context={context}
          onClose={closeDialog}
          notify={notify}
          refreshData={refreshData}
        />
      ) : null}

      {activeDialog === 'shortcuts' ? <ShortcutsDialog onClose={closeDialog} /> : null}

      {activeDialog === 'output' && outputContent ? (
        <OutputDialog
          title={outputContent.title}
          text={outputContent.text}
          onClose={closeDialog}
        />
      ) : null}

      {activeDialog === 'effort' ? (
        <EffortDialog
          context={context}
          onClose={closeDialog}
          notify={notify}
          refreshData={refreshData}
        />
      ) : null}

      <Footer hints={hints} toast={toast} width={columns} />
    </Box>
  );
}

export async function runTui(): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('The ComiCode TUI needs an interactive terminal. Use `comicode run` instead.');
  }
  const context = openAppContext(process.cwd());
  setActiveTheme(context.store.getSettings().ui.theme);
  // Set the terminal window/tab title to the app name.
  process.stdout.write('\x1b]0;ComiCode\x07');
  let instance: ReturnType<typeof render> | null = null;
  try {
    instance = render(<App context={context} />, {
      alternateScreen: true,
      exitOnCtrlC: false,
      incrementalRendering: false,
      maxFps: 30,
    });
    await instance.waitUntilExit();
  } finally {
    try {
      instance?.unmount();
    } catch {
      // The instance may already be unmounted.
    }
    try {
      context.close();
    } catch {
      // The store may already be closed by an explicit quit.
    }
  }
}

export { App };
