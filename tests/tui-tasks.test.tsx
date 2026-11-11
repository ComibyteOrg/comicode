import React from 'react';
import { Box, render } from 'ink';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppContext } from '../src/core/app.js';
import { openAppContext } from '../src/core/app.js';
import { TasksDialog } from '../src/tui/dialogs/tasks-dialog.js';
import { FakeStdout, flush, makeStdin, stripAnsi, type FakeStdin } from './helpers/tui.js';

describe('task manager dialog', () => {
  const originalHome = process.env.COMICODE_HOME;
  const originalDb = process.env.COMICODE_DB_PATH;
  let home: string;
  let context: AppContext;
  let stdin: FakeStdin;
  let stdout: FakeStdout;
  let instance: ReturnType<typeof render>;
  let taskId: string;

  beforeAll(async () => {
    home = mkdtempSync(join(tmpdir(), 'comicode-tasks-ui-'));
    process.env.COMICODE_HOME = home;
    delete process.env.COMICODE_DB_PATH;
    context = openAppContext(process.cwd());
    const task = context.store.createTask({
      projectPath: context.cwd,
      projectName: 'ComiCode',
      userRequest: 'Initial task request',
    });
    taskId = task.id;
    stdin = makeStdin();
    stdout = new FakeStdout();
    instance = render(
      <Box flexDirection="column" height={30} width={100}>
        <TasksDialog
          context={context}
          onClose={() => {}}
          onOpenTask={() => {}}
          onNewTask={() => {}}
          notify={() => {}}
          refreshData={() => {}}
        />
      </Box>,
      {
        stdin,
        stdout,
        debug: true,
        exitOnCtrlC: false,
        patchConsole: false,
        interactive: true,
      },
    );
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

  const send = async (input: string): Promise<void> => {
    stdin.write(input);
    await flush();
  };

  it('renames tasks and requires confirmation before deleting them', async () => {
    await send('\u0012');
    expect(stripAnsi(stdout.output)).toContain('RENAME TASK');
    await send('\u0015');
    await send('Readable task title');
    await send('\r');
    expect(context.store.getTask(taskId)?.metadata.title).toBe('Readable task title');

    await send('\u0004');
    expect(stripAnsi(stdout.output)).toContain('DELETE SAVED TASK?');
    expect(context.store.getTask(taskId)).not.toBeNull();
    await send('y');
    expect(context.store.getTask(taskId)).toBeNull();
  });
});
