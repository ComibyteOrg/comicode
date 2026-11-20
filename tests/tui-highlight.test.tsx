import React from 'react';
import { render } from 'ink';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { App } from '../src/tui/app.js';
import { openAppContext, type AppContext } from '../src/core/app.js';
import { sliceSelection } from '../src/tui/screens/workspace.js';
import { FakeStdout, flush, makeStdin, stripAnsi } from './helpers/tui.js';

const CTRL_Y = String.fromCharCode(25);

describe('terminal highlighting', () => {
  const originalHome = process.env.COMICODE_HOME;
  const originalDb = process.env.COMICODE_DB_PATH;
  let home: string;
  let context: AppContext;
  let stdin: ReturnType<typeof makeStdin>;
  let stdout: FakeStdout;
  let instance: ReturnType<typeof render>;

  beforeAll(async () => {
    home = mkdtempSync(join(tmpdir(), 'comicode-highlight-test-'));
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
  const enterSelectionMode = async (): Promise<void> => {
    stdin.write(CTRL_Y);
    for (let attempt = 0; attempt < 12 && !frame().includes('SELECT MODE'); attempt += 1) {
      await flush(80);
    }
  };

  it('sends the select-all key to the selection, not the composer', async () => {
    await enterSelectionMode();
    stdout.clear();
    stdin.write('a');
    await flush();
    expect(frame()).toContain('SELECT MODE');
    expect(frame()).not.toMatch(/❯\s*a+/);
  });

  it('does not arm quit when copying with ctrl+c in select mode', async () => {
    await enterSelectionMode();
    stdout.clear();
    stdin.write(String.fromCharCode(3));
    await flush();
    stdin.write(String.fromCharCode(3));
    await flush(180);
    expect(frame()).toContain('comicode workspace');
  });

  it('slices exactly the selected character range', () => {
    expect(sliceSelection('highlight me', 0, 9)).toBe('highlight');
    expect(sliceSelection('highlight me', 10, 12)).toBe('me');
    expect(sliceSelection('highlight me', 3, 3)).toBe('');
  });
});
