import React from 'react';
import { render } from 'ink';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from '../src/tui/dialogs/confirm-dialog.js';
import { FakeStdout, flush, makeStdin, stripAnsi } from './helpers/tui.js';

const ESC = String.fromCharCode(27);
const DOWN = `${ESC}[B`;
const ENTER = '\r';

describe('ConfirmDialog picker', () => {
  it('moves selection with arrows and submits with enter', async () => {
    const onDecision = vi.fn();
    const stdin = makeStdin();
    const stdout = new FakeStdout();
    render(
      <ConfirmDialog
        request={{ kind: 'command', title: 'Run command', description: 'test', command: 'ls' }}
        onDecision={onDecision}
      />,
      { stdin, stdout, debug: true, exitOnCtrlC: false },
    );
    await flush();
    stdout.clear();
    stdin.write(DOWN);
    await flush();
    stdin.write(ENTER);
    await flush();
    // 'command' kind supports always-allow, so down+enter picks 'always'.
    expect(onDecision).toHaveBeenCalledWith('always');
  });

  it('shows allow/always/deny options with hints', async () => {
    const stdin = makeStdin();
    const stdout = new FakeStdout();
    render(
      <ConfirmDialog
        request={{ kind: 'command', title: 'Run command', description: 'test', command: 'ls' }}
        onDecision={() => {}}
      />,
      { stdin, stdout, debug: true, exitOnCtrlC: false },
    );
    await flush();
    const text = stripAnsi(stdout.output);
    expect(text).toContain('Allow once');
    expect(text).toContain('Always allow');
    expect(text).toContain('Deny');
  });
});
