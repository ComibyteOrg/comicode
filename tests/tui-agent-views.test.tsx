import React from 'react';
import { render } from 'ink';
import { describe, expect, it } from 'vitest';
import { AgentInspector, TaskBoard } from '../src/tui/screens/agent-views.js';
import { deriveAgentStates, getAgentDefinition } from '../src/core/agent/registry.js';
import { createStageContracts } from '../src/core/agent/task-contract.js';
import type { AgentEvent } from '../src/core/events/types.js';
import { FakeStdout, flush, stripAnsi } from './helpers/tui.js';

const event = (
  type: AgentEvent['type'],
  agentId: string,
  payload: Record<string, unknown> = {},
): AgentEvent => ({
  type,
  taskId: 't1',
  agentId,
  timestamp: new Date().toISOString(),
  payload,
});

describe('agent views', () => {
  it('marks exactly one agent as working from real events', () => {
    const states = deriveAgentStates([event('agent.started', 'backend')], []);
    expect(states.backend!.status).toBe('working');
    expect(Object.values(states).filter((state) => state.status === 'working')).toHaveLength(1);
  });

  it('moves an agent to completed on agent.completed', () => {
    const states = deriveAgentStates(
      [event('agent.started', 'qa'), event('agent.completed', 'qa')],
      [],
    );
    expect(states.qa!.status).toBe('completed');
    expect(states.qa!.completedTaskCount).toBe(0);
  });

  it('inspector shows role details but no API key', async () => {
    const stdout = new FakeStdout(120, 34);
    const states = deriveAgentStates([event('agent.started', 'backend')], []);
    const instance = render(
      <AgentInspector
        definition={getAgentDefinition('backend')}
        state={states.backend!}
        recentEvents={[event('agent.started', 'backend', { note: 'sk-secret-1234' })]}
      />,
      { stdout, stdin: undefined as never, debug: true, exitOnCtrlC: false, patchConsole: false },
    );
    await flush(80);
    const frame = stripAnsi(stdout.output);
    expect(frame).toContain('Backend Developer');
    expect(frame).not.toContain('sk-secret-1234');
    instance.unmount();
  });

  it('task board renders real contract statuses', async () => {
    const stdout = new FakeStdout(120, 34);
    const contracts = createStageContracts(['plan', 'backend'], 'build a site');
    const instance = render(<TaskBoard contracts={contracts} />, {
      stdout,
      stdin: undefined as never,
      debug: true,
      exitOnCtrlC: false,
      patchConsole: false,
    });
    await flush(80);
    const frame = stripAnsi(stdout.output);
    expect(frame).toContain('ready');
    expect(frame).toContain('backend');
    instance.unmount();
  });
});
