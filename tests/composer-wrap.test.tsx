import React from 'react';
import { render } from 'ink';
import { describe, expect, it } from 'vitest';
import { PromptInput } from '../src/tui/components.js';
import { FakeStdout, flush, makeStdin, stripAnsi } from './helpers/tui.js';

describe('composer wrapping', () => {
  it('wraps long input within the available pane width', async () => {
    const stdout = new FakeStdout(120, 34);
    const value = 'build an ecommerce site with product catalog checkout and admin dashboard';
    const instance = render(
      <PromptInput value={value} onChange={() => {}} onSubmit={() => {}} focus width={24} />,
      {
        stdout,
        stdin: makeStdin(),
        debug: true,
        exitOnCtrlC: false,
        patchConsole: false,
      },
    );
    await flush(100);
    const lines = stripAnsi(stdout.output)
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const textLines = lines.filter((line) => line.includes('ecommerce') || line.includes('checkout') || line.includes('dashboard'));
    expect(textLines.length).toBeGreaterThan(1);
    instance.unmount();
  });
});
