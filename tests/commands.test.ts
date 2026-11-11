import { describe, expect, it } from 'vitest';
import { commandReferenceLines, slashCommandSpecs } from '../src/core/commands/catalog.js';
import { commandRegistry } from '../src/tui/commands/registry.js';

describe('shared command catalog', () => {
  it('registers a handler for each slash command', () => {
    expect(commandRegistry.all().map((command) => command.id)).toEqual(
      slashCommandSpecs().map((command) => command.id),
    );
  });

  it('generates help with arguments, aliases, and shortcuts from command metadata', () => {
    const help = commandReferenceLines().join('\n');
    expect(help).toContain('/model [model]');
    expect(help).toContain('/?');
    expect(help).toContain('/allow-paid on|off');
    expect(help).toContain('[ctrl+m]');
  });
});
