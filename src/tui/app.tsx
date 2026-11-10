import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Text, render, useApp, useInput } from 'ink';
import type { AppContext } from '../core/app.js';
import { openAppContext } from '../core/app.js';
import type { TaskRecord } from '../core/types.js';
import { refreshProfileModels } from '../core/providers/service.js';
import {
  Footer,
  Header,
  PromptInput,
  SCREENS,
  useLayout,
  type AgentStatus,
  type ScreenId,
} from './components.js';
import { Workspace, type ResumeRequest } from './screens/workspace.js';
import { ProvidersScreen } from './screens/providers.js';
import { ModelsScreen } from './screens/models.js';
import { HistoryScreen } from './screens/history.js';
import { UsageScreen } from './screens/usage.js';
import { SettingsScreen } from './screens/settings.js';
import { VERSION } from '../version.js';
import { glyph, theme } from './theme.js';

interface PaletteAction {
  label: string;
  detail: string;
  run: () => void | Promise<void>;
}

function App({ context }: { context: AppContext }): React.ReactElement {
  const { exit } = useApp();
  const { columns, rows } = useLayout();
  const [screen, setScreen] = useState<ScreenId>('workspace');
  const [status, setStatus] = useState<AgentStatus>('idle');
  const [tick, setTick] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [resumeRequest, setResumeRequest] = useState<ResumeRequest | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState('');
  const [paletteIndex, setPaletteIndex] = useState(0);

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

  const openTask = useCallback((taskId: string, resume: boolean) => {
    setResumeRequest({ taskId, nonce: Date.now(), resume });
    setScreen('workspace');
  }, []);

  const quit = useCallback(() => {
    exit();
  }, [exit]);

  const cycleScreen = useCallback((direction: 1 | -1) => {
    setScreen((current) => {
      const index = SCREENS.findIndex((entry) => entry.id === current);
      const next = (index + direction + SCREENS.length) % SCREENS.length;
      return SCREENS[next]?.id ?? 'workspace';
    });
  }, []);

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
      ...SCREENS.map((entry) => ({
        label: `Go to ${entry.label}`,
        detail: `screen ${SCREENS.findIndex((item) => item.id === entry.id) + 1}`,
        run: () => setScreen(entry.id),
      })),
      {
        label: 'Add a provider profile',
        detail: 'providers',
        run: () => {
          setScreen('providers');
          notify('In providers press a to add a profile.');
        },
      },
      {
        label: 'Refresh all model catalogs',
        detail: 'models',
        run: async () => {
          setScreen('models');
          const profiles = context.store.listProfiles().filter((profile) => profile.enabled);
          let discovered = 0;
          for (const profile of profiles) {
            try {
              const result = await refreshProfileModels(context.store, profile);
              discovered += result.discovered;
            } catch {
              // Per-profile failures are visible on the models/providers screens.
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
        label: 'Toggle paid fallbacks',
        detail: 'settings',
        run: () => togglePaid(),
      },
      {
        label: 'Start a fresh task',
        detail: 'workspace',
        run: () => {
          setScreen('workspace');
          notify('Use /new in the workspace to start fresh.');
        },
      },
      { label: 'Quit ComiCode', detail: 'exit', run: () => quit() },
    ],
    [context, latestPaused, notify, openTask, quit, refreshData, togglePaid],
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
    if (key.ctrl && input === 'c') {
      if (status === 'running') {
        notify('Pause the run with esc before quitting.');
        return;
      }
      quit();
      return;
    }
    if (key.ctrl && input === 'k') {
      setPaletteOpen((value) => !value);
      setPaletteQuery('');
      setPaletteIndex(0);
      return;
    }
  });

  useInput(
    (_input, key) => {
      if (key.escape) {
        setPaletteOpen(false);
        setPaletteQuery('');
        return;
      }
      if (key.upArrow) setPaletteIndex((value) => Math.max(0, value - 1));
      else if (key.downArrow) {
        setPaletteIndex((value) => Math.min(Math.max(0, filteredActions.length - 1), value + 1));
      }
    },
    { isActive: paletteOpen },
  );

  const runPaletteAction = (index: number): void => {
    const action = filteredActions[index];
    setPaletteOpen(false);
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

  const hints = paletteOpen
    ? ['type to filter', '↑/↓ choose', 'enter run', 'esc close']
    : screen === 'workspace'
      ? [
          '←/→ or tab screens',
          '/ commands',
          'enter send',
          'esc pause',
          'ctrl+k palette',
          'ctrl+c quit',
        ]
      : ['←/→ or tab screens', '↑/↓ move', 'enter open', 'esc back', 'ctrl+k palette'];

  void tick;

  const paletteRows = Math.max(4, rows - 11);
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
        screen={screen}
        version={VERSION}
        cwd={context.cwd}
        profileName={selectedProfile?.name ?? null}
        modelName={selectedModel?.modelId ?? selectedProfile?.defaultModel ?? null}
        status={status}
        allowPaid={allowPaid}
        taskId={resumeRequest?.taskId ?? null}
        columns={columns}
      />

      <Box flexDirection="column" flexGrow={1} overflow="hidden" paddingX={1}>
        <Box
          display={paletteOpen ? 'none' : 'flex'}
          flexDirection="column"
          flexGrow={1}
          overflow="hidden"
        >
          <Box
            display={screen === 'workspace' ? 'flex' : 'none'}
            flexDirection="column"
            flexGrow={1}
            overflow="hidden"
          >
            <Workspace
              context={context}
              active={!paletteOpen && screen === 'workspace'}
              onStatusChange={setStatus}
              onNavigate={setScreen}
              onCycleScreen={cycleScreen}
              onQuit={quit}
              resumeRequest={resumeRequest}
              notify={notify}
              refreshData={refreshData}
            />
          </Box>
          <Box
            display={screen === 'providers' ? 'flex' : 'none'}
            flexDirection="column"
            flexGrow={1}
            overflow="hidden"
          >
            <ProvidersScreen
              context={context}
              active={!paletteOpen && screen === 'providers'}
              notify={notify}
              refreshData={refreshData}
              onStatusChange={setStatus}
              onCycleScreen={cycleScreen}
              onBack={() => setScreen('workspace')}
            />
          </Box>
          <Box
            display={screen === 'models' ? 'flex' : 'none'}
            flexDirection="column"
            flexGrow={1}
            overflow="hidden"
          >
            <ModelsScreen
              context={context}
              active={!paletteOpen && screen === 'models'}
              notify={notify}
              refreshData={refreshData}
              onCycleScreen={cycleScreen}
              onBack={() => setScreen('workspace')}
            />
          </Box>
          <Box
            display={screen === 'history' ? 'flex' : 'none'}
            flexDirection="column"
            flexGrow={1}
            overflow="hidden"
          >
            <HistoryScreen
              context={context}
              active={!paletteOpen && screen === 'history'}
              notify={notify}
              refreshData={refreshData}
              onOpenTask={openTask}
              version={tick}
              onCycleScreen={cycleScreen}
              onBack={() => setScreen('workspace')}
            />
          </Box>
          <Box
            display={screen === 'usage' ? 'flex' : 'none'}
            flexDirection="column"
            flexGrow={1}
            overflow="hidden"
          >
            <UsageScreen
              context={context}
              active={!paletteOpen && screen === 'usage'}
              notify={notify}
              refreshData={refreshData}
              onCycleScreen={cycleScreen}
              onBack={() => setScreen('workspace')}
            />
          </Box>
          <Box
            display={screen === 'settings' ? 'flex' : 'none'}
            flexDirection="column"
            flexGrow={1}
            overflow="hidden"
          >
            <SettingsScreen
              context={context}
              active={!paletteOpen && screen === 'settings'}
              notify={notify}
              refreshData={refreshData}
              onCycleScreen={cycleScreen}
              onBack={() => setScreen('workspace')}
            />
          </Box>
        </Box>

        {paletteOpen ? (
          <Box
            flexDirection="column"
            flexGrow={1}
            height="100%"
            borderStyle="round"
            borderColor={theme.accentDim}
            paddingX={1}
            overflow="hidden"
          >
            <Box justifyContent="space-between" flexShrink={0}>
              <Text bold color={theme.text}>
                <Text color={theme.accent}>{glyph.brand} </Text>
                Command palette
              </Text>
              <Text color={theme.faint}>{filteredActions.length} actions</Text>
            </Box>
            <Box marginTop={1} flexShrink={0}>
              <PromptInput
                value={paletteQuery}
                onChange={(value) => {
                  setPaletteQuery(value);
                  setPaletteIndex(0);
                }}
                onSubmit={() => runPaletteAction(paletteIndex)}
                focus={paletteOpen}
                placeholder="Search screens, providers, models, tasks…"
              />
            </Box>
            <Box flexDirection="column" flexGrow={1} overflow="hidden" marginTop={1}>
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
            <Box flexShrink={0}>
              <Text color={theme.faint}>
                {glyph.arrowUp}/{glyph.arrowDown} choose {glyph.bullet} enter run {glyph.bullet} esc
                close
              </Text>
            </Box>
          </Box>
        ) : null}
      </Box>

      <Footer hints={hints} toast={toast} width={columns} />
    </Box>
  );
}

export async function runTui(): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('The ComiCode TUI needs an interactive terminal. Use `comicode run` instead.');
  }
  const context = openAppContext(process.cwd());
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
