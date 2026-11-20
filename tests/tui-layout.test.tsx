import React from 'react';
import { render } from 'ink';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../src/tui/app.js';
import { openAppContext } from '../src/core/app.js';
import { FakeStdout, flush, makeStdin, stripAnsi } from './helpers/tui.js';

const instances: Array<{ unmount: () => void }> = [];
const contexts: Array<{ close: () => void }> = [];
const dirs: string[] = [];

function renderAt(columns: number) {
  const dir = mkdtempSync(join(tmpdir(), 'comicode-layout-test-'));
  dirs.push(dir);
  process.env.COMICODE_HOME = dir;
  delete process.env.COMICODE_DB_PATH;
  const context = openAppContext(process.cwd());
  contexts.push(context);
  const stdout = new FakeStdout(columns, 34);
  const stdin = makeStdin();
  const instance = render(<App context={context} />, {
    stdin,
    stdout,
    debug: true,
    exitOnCtrlC: false,
    patchConsole: false,
    interactive: true,
  });
  instances.push(instance);
  return {
    stdin,
    clear: () => stdout.clear(),
    frame: () => stripAnsi(stdout.output),
    send: async (sequence: string) => {
      stdin.write(sequence);
      await flush(320);
    },
  };
}

afterEach(() => {
  while (instances.length > 0) instances.pop()?.unmount();
  while (contexts.length > 0) contexts.pop()?.close();
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe('hybrid terminal layout', () => {
  it('shows the side panel on a wide terminal and hides it on a narrow one', async () => {
    const wide = renderAt(130);
    await flush(120);
    expect(wide.frame()).toContain('Team Lead');
    const narrow = renderAt(80);
    await flush(120);
    expect(narrow.frame()).not.toContain('Team Lead');
  });

  it('keeps the workspace usable when the panel is hidden', async () => {
    const view = renderAt(130);
    await flush(120);
    expect(view.frame()).toContain('Team Lead');
    expect(view.frame()).toContain('ACTIVITY');
  });
});
