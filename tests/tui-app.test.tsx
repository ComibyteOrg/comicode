import React from 'react';
import { render } from 'ink';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { App } from '../src/tui/app.js';
import { openAppContext, type AppContext } from '../src/core/app.js';
import { FakeStdout, flush, makeStdin, stripAnsi, type FakeStdin } from './helpers/tui.js';

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
  const WORKSPACE_MARKER = 'Ask ComiCode to build, fix, test, or explain';
  const goWorkspace = async (): Promise<void> => {
    for (let attempt = 0; attempt < 7; attempt += 1) {
      stdout.clear();
      await send('\u001b[D');
      if (frame().includes(WORKSPACE_MARKER)) return;
    }
  };

  it('renders the workspace welcome copy', () => {
    expect(frame()).toContain('Ready when you are.');
    expect(frame()).toContain('workspace');
  });

  it('switches screens with the right arrow from an empty composer', async () => {
    stdout.clear();
    await send('\u001b[C');
    expect(frame()).toContain('No providers yet.');
    expect(frame()).toContain('Providers');
  });

  it('switches screens with tab', async () => {
    await goWorkspace();
    stdout.clear();
    await send('\t');
    expect(frame()).toContain('No providers yet.');
  });

  it('cycles screens in both directions', async () => {
    await goWorkspace();
    stdout.clear();
    await send('\u001b[C');
    expect(frame()).toContain('No providers yet.');
    stdout.clear();
    await send('\u001b[D');
    expect(frame()).toContain(WORKSPACE_MARKER);
  });

  it('runs slash commands from the composer', async () => {
    await goWorkspace();
    stdout.clear();
    await send('/help');
    await send('\r');
    expect(frame()).toContain('Commands');
    expect(frame()).toContain('/allow-paid');
  });

  it('submits a request on LF and reports a missing provider', async () => {
    await goWorkspace();
    stdout.clear();
    await send('build a landing page');
    await send('\n');
    expect(frame()).toContain('build a landing page');
    expect(frame()).toContain('No provider profile is connected');
  });
});
