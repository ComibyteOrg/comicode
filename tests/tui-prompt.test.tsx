import React, { useState } from 'react';
import { render } from 'ink';
import { describe, expect, it } from 'vitest';
import { PromptInput, isEnter } from '../src/tui/components.js';
import { FakeStdout, makeStdin, flush, type FakeStdin } from './helpers/tui.js';

interface Harness {
  stdin: FakeStdin;
  stdout: FakeStdout;
  submitted: string[];
  value: () => string;
  type: (text: string) => Promise<void>;
  press: (sequence: string) => Promise<void>;
  unmount: () => void;
}

function mountPrompt(history: string[] = []): Harness {
  const stdin = makeStdin();
  const stdout = new FakeStdout();
  const submitted: string[] = [];
  const state = { value: '' };

  function Probe(): React.ReactElement {
    const [value, setValue] = useState('');
    state.value = value;
    return (
      <PromptInput
        value={value}
        onChange={setValue}
        onSubmit={(next) => {
          submitted.push(next);
          setValue('');
        }}
        focus
        placeholder="type a request"
        history={history}
      />
    );
  }

  const instance = render(<Probe />, {
    stdin,
    stdout,
    debug: true,
    exitOnCtrlC: false,
    patchConsole: false,
    interactive: true,
  });

  const write = async (text: string): Promise<void> => {
    stdin.write(text);
    await flush();
  };

  return {
    stdin,
    stdout,
    submitted,
    value: () => state.value,
    type: (text) => write(text),
    press: (sequence) => write(sequence),
    unmount: () => instance.unmount(),
  };
}

describe('isEnter', () => {
  it('treats CR and LF as submit', () => {
    expect(isEnter('\r', { return: true })).toBe(true);
    expect(isEnter('\n', { return: false })).toBe(true);
    expect(isEnter('a', { return: false })).toBe(false);
  });
});

describe('PromptInput key handling', () => {
  it('appends characters typed one at a time', async () => {
    const harness = mountPrompt();
    try {
      await harness.type('h');
      await harness.type('i');
      expect(harness.value()).toBe('hi');
    } finally {
      harness.unmount();
    }
  });

  it('inserts a pasted chunk without dropping characters', async () => {
    const harness = mountPrompt();
    try {
      await harness.type('hello world');
      expect(harness.value()).toBe('hello world');
    } finally {
      harness.unmount();
    }
  });

  it('submits on LF instead of inserting a newline', async () => {
    const harness = mountPrompt();
    try {
      await harness.type('ship it');
      await harness.press('\n');
      expect(harness.submitted).toEqual(['ship it']);
      expect(harness.value()).toBe('');
    } finally {
      harness.unmount();
    }
  });

  it('submits on CR', async () => {
    const harness = mountPrompt();
    try {
      await harness.type('fix the bug');
      await harness.press('\r');
      expect(harness.submitted).toEqual(['fix the bug']);
    } finally {
      harness.unmount();
    }
  });

  it('backspaces from the end of the line', async () => {
    const harness = mountPrompt();
    try {
      await harness.type('abc');
      await harness.press('\u007f');
      expect(harness.value()).toBe('ab');
    } finally {
      harness.unmount();
    }
  });

  it('moves the cursor with arrows and inserts in the middle', async () => {
    const harness = mountPrompt();
    try {
      await harness.type('ac');
      await harness.press('\u001b[D');
      await harness.type('b');
      expect(harness.value()).toBe('abc');
    } finally {
      harness.unmount();
    }
  });

  it('recalls command history with the up arrow', async () => {
    const harness = mountPrompt(['/help', '/model gemini-2.5-pro']);
    try {
      await harness.type('/');
      await harness.press('\u001b[A');
      expect(harness.value()).toBe('/model gemini-2.5-pro');
    } finally {
      harness.unmount();
    }
  });
});
