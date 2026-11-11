import React from 'react';
import { Box, render } from 'ink';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppContext } from '../src/core/app.js';
import { openAppContext } from '../src/core/app.js';
import { App } from '../src/tui/app.js';
import { ProvidersScreen } from '../src/tui/screens/providers.js';
import { ModelsScreen } from '../src/tui/screens/models.js';
import { HistoryScreen } from '../src/tui/screens/history.js';
import { UsageScreen } from '../src/tui/screens/usage.js';
import { SettingsScreen } from '../src/tui/screens/settings.js';
import { Workspace } from '../src/tui/screens/workspace.js';
import { FakeStdout, flush, makeStdin, screenWidths, stripAnsi } from './helpers/tui.js';

const noop = (): void => {};

const SIZES = [
  { columns: 80, rows: 24 },
  { columns: 120, rows: 36 },
  { columns: 160, rows: 48 },
];

describe('TUI layout', () => {
  const originalHome = process.env.COMICODE_HOME;
  const originalDb = process.env.COMICODE_DB_PATH;
  let home: string;
  let context: AppContext;
  let scrollTaskId: string;

  beforeAll(() => {
    home = mkdtempSync(join(tmpdir(), 'comicode-layout-'));
    process.env.COMICODE_HOME = home;
    delete process.env.COMICODE_DB_PATH;
    context = openAppContext(process.cwd());

    const gemini = context.store.createProfile({
      providerId: 'gemini',
      name: 'Gemini Free Tier',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      authType: 'api-key',
      defaultModel: 'gemini-2.5-pro',
      accessClassification: 'free-tier',
      enabled: true,
    });
    const custom = context.store.createProfile({
      providerId: 'custom',
      name: 'Local Ollama (no auth)',
      baseUrl: 'http://127.0.0.1:11434/v1',
      authType: 'bearer',
      defaultModel: 'qwen2.5-coder:32b',
      accessClassification: 'user-free',
      config: { apiStyle: 'openai-compatible', allowNoAuth: true },
      enabled: true,
    });
    context.store.setSelectedProfileId(gemini.id);
    context.store.seedModel('gemini', {
      id: 'gemini:gemini-2.5-pro',
      providerId: 'gemini',
      profileId: null,
      modelId: 'gemini-2.5-pro',
      displayName: 'Gemini 2.5 Pro',
      contextWindow: 1_048_576,
      maxOutputTokens: 65_536,
      supportsTools: true,
      supportsStreaming: true,
      supportsVision: true,
      codingSuitability: 92,
      reasoningSuitability: 90,
      inputPricePerMillion: 1.25,
      outputPricePerMillion: 10,
      access: 'free-tier',
      accessSource: 'seed',
      accessNotes: null,
      available: true,
      lastCheckedAt: null,
      userClassification: null,
      metadata: {},
    });
    context.store.seedModel('custom', {
      id: `custom:${custom.id}:qwen2.5-coder:32b`,
      providerId: 'custom',
      profileId: custom.id,
      modelId: 'qwen2.5-coder:32b',
      displayName: 'Qwen 2.5 Coder 32B',
      contextWindow: 131_072,
      maxOutputTokens: 8192,
      supportsTools: true,
      supportsStreaming: true,
      supportsVision: false,
      codingSuitability: 85,
      reasoningSuitability: 70,
      inputPricePerMillion: null,
      outputPricePerMillion: null,
      access: 'user-free',
      accessSource: 'user',
      accessNotes: 'local',
      available: true,
      lastCheckedAt: null,
      userClassification: 'user-free',
      metadata: {},
    });

    const scrollTask = context.store.createTask({
      projectPath: context.cwd,
      projectName: 'Comicode',
      userRequest: 'Show a long transcript and scroll it by line.',
      currentProfileId: gemini.id,
      currentModelId: 'gemini-2.5-pro',
    });
    scrollTaskId = scrollTask.id;
    for (let index = 0; index < 24; index += 1) {
      context.store.appendMessage(scrollTask.id, {
        role: 'assistant',
        content: `Step ${index + 1}: ${'wrapped transcript line '.repeat(12)}`,
      });
    }

    for (const [index, status] of ['completed', 'paused', 'failed'].entries()) {
      const task = context.store.createTask({
        projectPath: context.cwd,
        projectName: 'Comicode',
        userRequest: `Refactor the routing engine and add regression coverage (task ${index + 1})`,
        currentProfileId: gemini.id,
        currentModelId: 'gemini-2.5-pro',
      });
      context.store.updateTask(task.id, {
        status: status as 'completed' | 'paused' | 'failed',
        phase: index === 0 ? 'done' : 'implement',
        summary: index === 0 ? 'Updated the router and added tests.' : null,
        error: index === 2 ? 'Provider quota exhausted; retry later.' : null,
      });
    }
  });

  afterAll(() => {
    context.close();
    rmSync(home, { recursive: true, force: true });
    if (originalHome === undefined) delete process.env.COMICODE_HOME;
    else process.env.COMICODE_HOME = originalHome;
    if (originalDb === undefined) delete process.env.COMICODE_DB_PATH;
    else process.env.COMICODE_DB_PATH = originalDb;
  });

  const screens = (): Record<string, React.ReactElement> => ({
    providers: (
      <ProvidersScreen
        context={context}
        active
        notify={noop}
        refreshData={noop}
        onStatusChange={noop}
        onCycleScreen={noop}
        onBack={noop}
      />
    ),
    models: (
      <ModelsScreen
        context={context}
        active
        notify={noop}
        refreshData={noop}
        onCycleScreen={noop}
        onBack={noop}
      />
    ),
    history: (
      <HistoryScreen
        context={context}
        active
        notify={noop}
        refreshData={noop}
        onOpenTask={noop}
        onCycleScreen={noop}
        onBack={noop}
        version={0}
      />
    ),
    usage: (
      <UsageScreen
        context={context}
        active
        notify={noop}
        refreshData={noop}
        onCycleScreen={noop}
        onBack={noop}
      />
    ),
    settings: (
      <SettingsScreen
        context={context}
        active
        notify={noop}
        refreshData={noop}
        onCycleScreen={noop}
        onBack={noop}
      />
    ),
  });

  async function renderAndMeasure(
    element: React.ReactElement,
    columns: number,
    rows: number,
  ): Promise<{ widths: number[]; text: string }> {
    const stdin = makeStdin();
    const stdout = new FakeStdout(columns, rows);
    const instance = render(
      <Box flexDirection="column" height={rows} width={columns} paddingX={1}>
        {element}
      </Box>,
      {
        stdin,
        stdout,
        debug: false,
        exitOnCtrlC: false,
        patchConsole: false,
        interactive: false,
      },
    );
    await flush(120);
    instance.unmount();
    return { widths: screenWidths(stdout.output), text: stdout.output };
  }

  for (const { columns, rows } of SIZES) {
    it(`keeps every screen inside ${columns}x${rows}`, async () => {
      for (const [name, element] of Object.entries(screens())) {
        const { widths } = await renderAndMeasure(element, columns, rows);
        expect(Math.max(...widths), `${name} width at ${columns}x${rows}`).toBeLessThanOrEqual(
          columns,
        );
        expect(widths.length, `${name} height at ${columns}x${rows}`).toBeLessThanOrEqual(rows + 1);
      }
    });
  }

  it('scrolls a long transcript by line inside 80x24', async () => {
    const stdin = makeStdin();
    const stdout = new FakeStdout(80, 24);
    const instance = render(
      <Box height={24} width={80} flexDirection="column" paddingX={1}>
        <Workspace
          context={context}
          active
          onStatusChange={noop}
          onNavigate={noop}
          onCycleScreen={noop}
          onQuit={noop}
          resumeRequest={{ taskId: scrollTaskId, nonce: 1, resume: false }}
          notify={noop}
          refreshData={noop}
        />
      </Box>,
      {
        stdin,
        stdout,
        debug: false,
        exitOnCtrlC: false,
        patchConsole: false,
        interactive: true,
      },
    );
    const earlierCount = (text: string): number => {
      const match = /(\d+) earlier/.exec(stripAnsi(text));
      return match ? Number(match[1]) : 0;
    };

    await flush(250);
    const initial = stripAnsi(stdout.output);
    expect(initial).toContain('Loaded task');
    expect(earlierCount(initial)).toBeGreaterThan(0);

    stdout.clear();
    stdin.write(`${String.fromCharCode(27)}[5~`);
    await flush(250);
    const scrolledUp = stripAnsi(stdout.output);
    expect(scrolledUp).toMatch(/earlier/);
    expect(scrolledUp).toContain('pgup');
    // 24 rows → 6-line viewport → page keys move 4 lines, not whole entries.
    expect(earlierCount(initial) - earlierCount(scrolledUp)).toBe(4);

    stdout.clear();
    stdin.write(`${String.fromCharCode(27)}[6~`);
    await flush(250);
    expect(earlierCount(stdout.output)).toBe(earlierCount(initial));
    instance.unmount();
  });

  it('keeps the full app shell inside 80x24', async () => {
    const stdin = makeStdin();
    const stdout = new FakeStdout(80, 24);
    const instance = render(<App context={context} />, {
      stdin,
      stdout,
      debug: false,
      exitOnCtrlC: false,
      patchConsole: false,
      interactive: false,
    });
    await flush(120);
    instance.unmount();
    const widths = screenWidths(stdout.output);
    expect(Math.max(...widths)).toBeLessThanOrEqual(80);
    expect(widths.length).toBeLessThanOrEqual(25);
  });
});
