import { describe, expect, it, vi } from 'vitest';
import { commandRegistry } from '../src/tui/commands/registry.js';
import type { CommandContext } from '../src/tui/commands/registry.js';

function ctx(): CommandContext {
  return {
    context: {} as never,
    notify: vi.fn(),
    refreshData: vi.fn(),
    openDialog: vi.fn(),
    closeDialog: vi.fn(),
    navigateToScreen: vi.fn(),
    setTaskId: vi.fn(),
    getActiveTaskId: () => null,
    clearTranscript: vi.fn(),
    addNotice: vi.fn(),
    addError: vi.fn(),
    executeTask: vi.fn(),
    toggleToolsExpanded: vi.fn(),
    onQuit: vi.fn(),
  };
}

describe('team slash commands', () => {
  for (const command of ['agents', 'agent', 'plan', 'tasks', 'activity', 'review', 'test']) {
    it(`registers /${command}`, () => {
      expect(commandRegistry.get(command)).not.toBeNull();
    });
  }

  it('/agent backend reports the selected specialist', async () => {
    const context = ctx();
    await commandRegistry.get('agent')!.handler(['backend'], context);
    expect(context.addNotice).toHaveBeenCalledWith(
      'agent',
      expect.stringContaining('Backend Developer'),
    );
  });

  for (const command of ['tasks', 'history', 'session']) {
    it(`/${command} opens the task history popup`, async () => {
      const context = ctx();
      await commandRegistry.get(command)!.handler([], context);
      expect(context.openDialog).toHaveBeenCalledWith('tasks');
    });
  }

  it('/agents lists the roster', async () => {
    const context = ctx();
    await commandRegistry.get('agents')!.handler([], context);
    expect(context.addNotice).toHaveBeenCalledWith(
      'agents',
      expect.stringContaining('Team Lead'),
    );
  });
});
