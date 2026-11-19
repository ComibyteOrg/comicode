import React from 'react';
import { render } from 'ink';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MissionControl } from '../src/tui/screens/mission-control.js';
import { openAppContext } from '../src/core/app.js';
import { EventBus } from '../src/core/events/bus.js';
import { FakeStdout, flush, makeStdin, stripAnsi } from './helpers/tui.js';

const instances: Array<{ unmount: () => void }> = [];
const contexts: Array<{ close: () => void }> = [];
const dirs: string[] = [];

function renderAt(columns: number) {
  const dir = mkdtempSync(join(tmpdir(), 'comicode-mission-test-'));
  dirs.push(dir);
  process.env.COMICODE_HOME = dir;
  delete process.env.COMICODE_DB_PATH;
  const context = openAppContext(process.cwd());
  contexts.push(context);
  const stdout = new FakeStdout(columns, 36);
  const stdin = makeStdin();
  const bus = new EventBus();
  const instance = render(
    <MissionControl
      context={context}
      active={true}
      eventBus={bus}
      agentMode="auto"
      onAgentMode={() => {}}
    />,
    { stdin, stdout, debug: true, exitOnCtrlC: false, patchConsole: false, interactive: true },
  );
  instances.push(instance);
  return { stdin, bus, frame: () => stripAnsi(stdout.output) };
}

afterEach(() => {
  while (instances.length > 0) instances.pop()?.unmount();
  while (contexts.length > 0) contexts.pop()?.close();
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe('mission control shell', () => {
  it('renders agent and activity areas on a wide terminal', async () => {
    const view = renderAt(130);
    await flush(120);
    expect(view.frame()).toContain('TEAM');
    expect(view.frame()).toContain('ACTIVITY');
  });

  it('collapses the sidebar on a narrow terminal', async () => {
    const view = renderAt(80);
    await flush(120);
    expect(view.frame()).not.toContain('TEAM LEAD');
  });

  it('shows real bus events in the activity feed', async () => {
    const view = renderAt(130);
    await flush(120);
    view.bus.emit({ type: 'agent.started', taskId: 't1', agentId: 'backend', payload: { label: 'Backend' } });
    await flush(120);
    expect(view.frame()).toContain('Backend');
  });
});
