import React from 'react';
import { render } from 'ink';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { App } from '../src/tui/app.js';
import { openAppContext, type AppContext } from '../src/core/app.js';
import { FakeStdout, flush, makeStdin, stripAnsi, type FakeStdin } from './helpers/tui.js';

const ESC = String.fromCharCode(27);
const CTRL_G = String.fromCharCode(7);
const CTRL_B = String.fromCharCode(2);
const DOWN = `${ESC}[B`;
const ENTER = '\r';

// The header brand line stays visible above every centered modal.
const WORKSPACE_MARKER = 'comicode workspace';

describe('TUI application', () => {
  const originalHome = process.env.COMICODE_HOME;
  const originalDb = process.env.COMICODE_DB_PATH;
  let home: string;
  let context: AppContext;
  let stdin: FakeStdin;
  let stdout: FakeStdout;
  let instance: ReturnType<typeof render>;

  beforeAll(async () => {
    home = mkdtempSync(join(tmpdir(), 'comicode-tui-test-'));
    process.env.COMICODE_HOME = home;
    delete process.env.COMICODE_DB_PATH;
    context = openAppContext(process.cwd());
    stdin = makeStdin();
    stdout = new FakeStdout();
    instance = render(<App context={context} />, {
      stdin,
      stdout,
      debug: true,
      exitOnCtrlC: false,
      patchConsole: false,
      interactive: true,
    });
    await flush(120);
  });

  afterAll(() => {
    instance.unmount();
    context.close();
    rmSync(home, { recursive: true, force: true });
    if (originalHome === undefined) delete process.env.COMICODE_HOME;
    else process.env.COMICODE_HOME = originalHome;
    if (originalDb === undefined) delete process.env.COMICODE_DB_PATH;
    else process.env.COMICODE_DB_PATH = originalDb;
  });

  const frame = (): string => stripAnsi(stdout.output);
  const send = async (sequence: string): Promise<void> => {
    stdin.write(sequence);
    await flush();
  };
  const closeDialogs = async (): Promise<void> => {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      stdout.clear();
      await send(ESC);
      if (!frame().includes('esc close')) return;
    }
  };

  it('renders the workspace composer', () => {
    expect(frame()).toContain('Ask ComiCode');
    expect(frame()).toContain('workspace');
  });

  it('opens the model picker as a modal with ctrl+g and keeps the chat visible', async () => {
    await closeDialogs();
    stdout.clear();
    await send(CTRL_G);
    expect(frame()).toContain('Select model');
    expect(frame()).toContain(WORKSPACE_MARKER);
    stdout.clear();
    await send(ESC);
    expect(frame()).not.toContain('Select model');
    expect(frame()).toContain(WORKSPACE_MARKER);
  });

  it('opens the provider manager as a modal with ctrl+b', async () => {
    await closeDialogs();
    stdout.clear();
    await send(CTRL_B);
    expect(frame()).toContain('Providers');
    expect(frame()).toContain(WORKSPACE_MARKER);
    await closeDialogs();
  });

  it('opens the provider workflow from /connect without leaving the workspace', async () => {
    await closeDialogs();
    stdout.clear();
    await send('/connect');
    await send(ENTER);
    expect(frame()).toContain('CONNECT PROVIDER');
    expect(frame()).toContain(WORKSPACE_MARKER);
    await closeDialogs();
  });

  it('opens the model picker from /models', async () => {
    await closeDialogs();
    stdout.clear();
    await send('/models');
    await send(ENTER);
    expect(frame()).toContain('Select model');
    expect(frame()).toContain(WORKSPACE_MARKER);
    await closeDialogs();
  });

  it('opens settings and usage as modals from slash commands', async () => {
    await closeDialogs();
    stdout.clear();
    await send('/settings');
    await send(ENTER);
    expect(frame()).toContain('COMICODE SETTINGS');
    expect(frame()).toContain(WORKSPACE_MARKER);
    await closeDialogs();

    stdout.clear();
    await send('/usage');
    await send(ENTER);
    expect(frame()).toContain('TOKEN USAGE');
    expect(frame()).toContain(WORKSPACE_MARKER);
    await closeDialogs();
  });

  it('runs slash commands from the composer', async () => {
    await closeDialogs();
    stdout.clear();
    await send('/help');
    await send(ENTER);
    expect(frame()).toContain('HELP');
    expect(frame()).toContain('/model');
    await send(ESC);
  });

  it('shows filtered slash suggestions and executes the highlighted command', async () => {
    await closeDialogs();
    stdout.clear();
    await send('/');
    expect(frame()).toContain('COMMANDS');
    await send('m');
    expect(frame()).toContain('/model');
    expect(frame()).toContain('/models');
    expect(frame()).toContain('/mode');
    await send(DOWN);
    await send(DOWN);
    await send(ENTER);
    expect(frame()).toContain('Select model');
    await closeDialogs();
  });

  it('switches agent mode with /mode and shows it in the header', async () => {
    await closeDialogs();
    stdout.clear();
    await send('/mode plan');
    await send(ENTER);
    expect(frame()).toContain('Plan mode');
    expect(frame()).toContain('plan');
    await send('/mode build');
    await send(ENTER);
    expect(frame()).toContain('Build mode');
  });

  it('toggles select/copy mode so terminal text can be highlighted', async () => {
    await closeDialogs();
    stdout.clear();
    await send(String.fromCharCode(25));
    expect(frame()).toContain('SELECT MODE');
    expect(frame()).toContain('drag to highlight');
    stdout.clear();
    await send(ESC);
    expect(frame()).not.toContain('SELECT MODE');
  });

  it('requires a second ctrl+c before quitting', async () => {
    await closeDialogs();
    stdout.clear();
    await send(String.fromCharCode(3));
    expect(frame()).toContain('Press ctrl+c again to quit');
    expect(frame()).toContain(WORKSPACE_MARKER);
  });

  it('submits a request on LF and reports a missing provider', async () => {
    await closeDialogs();
    stdout.clear();
    await send('build a landing page');
    await send('\n');
    expect(frame()).toContain('build a landing page');
    expect(frame()).toContain('No provider profile is connected');
  });
});
