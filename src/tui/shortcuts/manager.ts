/**
 * Central keyboard shortcut definitions and matching.
 *
 * Ink exposes a small key object. Parsing strings such as `ctrl+p` here keeps
 * shortcut behaviour out of the app shell and makes overrides testable.
 */

export type ShortcutScope = 'global' | 'workspace' | 'dialog';

export interface ShortcutDefinition {
  id: string;
  label: string;
  keys: string[];
  description: string;
  scope: ShortcutScope;
  customizable: boolean;
}

export interface ShortcutKey {
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  return?: boolean;
  escape?: boolean;
  tab?: boolean;
  backspace?: boolean;
  delete?: boolean;
  upArrow?: boolean;
  downArrow?: boolean;
  leftArrow?: boolean;
  rightArrow?: boolean;
  pageUp?: boolean;
  pageDown?: boolean;
}

export const SHORTCUTS: ShortcutDefinition[] = [
  {
    id: 'palette',
    label: 'Command palette',
    keys: ['ctrl+p', 'ctrl+k'],
    description: 'Search and run every command.',
    scope: 'global',
    customizable: true,
  },
  {
    id: 'model',
    label: 'Model selector',
    keys: ['ctrl+m', 'ctrl+g'],
    description: 'Open the searchable model picker.',
    scope: 'global',
    customizable: true,
  },
  {
    id: 'provider',
    label: 'Provider manager',
    keys: ['ctrl+b'],
    description: 'Open the provider connection and profile manager.',
    scope: 'global',
    customizable: true,
  },
  {
    id: 'effort',
    label: 'Reasoning effort',
    keys: ['ctrl+e'],
    description: 'Choose low/medium/default/high/xhigh effort for the active profile.',
    scope: 'global',
    customizable: true,
  },
  {
    id: 'newTask',
    label: 'New task',
    keys: ['ctrl+n'],
    description: 'Start a fresh task in the workspace.',
    scope: 'global',
    customizable: true,
  },
  {
    id: 'clear',
    label: 'Clear transcript',
    keys: ['ctrl+l'],
    description: 'Clear the conversation view; history is kept.',
    scope: 'global',
    customizable: true,
  },
  {
    id: 'tasks',
    label: 'Task manager',
    keys: ['ctrl+t'],
    description: 'Search, resume, rename, and delete tasks.',
    scope: 'global',
    customizable: true,
  },
  {
    id: 'tools',
    label: 'Toggle tool details',
    keys: ['ctrl+o'],
    description: 'Expand or collapse tool arguments and output.',
    scope: 'workspace',
    customizable: true,
  },
  {
    id: 'status',
    label: 'Status',
    keys: ['ctrl+s'],
    description: 'Provider, quota, routing, and git status.',
    scope: 'global',
    customizable: true,
  },
  {
    id: 'cancel',
    label: 'Pause / cancel',
    keys: ['escape'],
    description: 'Pause the running task; close a dialog first.',
    scope: 'workspace',
    customizable: false,
  },
  {
    id: 'quit',
    label: 'Quit or cancel',
    keys: ['ctrl+c'],
    description: 'Cancel a running task or quit when idle.',
    scope: 'global',
    customizable: false,
  },
  {
    id: 'screens',
    label: 'Switch screens',
    keys: ['left', 'right', 'tab', 'shift+tab'],
    description: 'There is a single workspace; everything else opens as a dialog.',
    scope: 'workspace',
    customizable: false,
  },
  {
    id: 'scroll',
    label: 'Scroll transcript',
    keys: ['pageup', 'pagedown'],
    description: 'Move through conversation history.',
    scope: 'workspace',
    customizable: false,
  },
  {
    id: 'confirm',
    label: 'Approve / reject',
    keys: ['y', 'n'],
    description: 'Answer a confirmation or undo dialog.',
    scope: 'dialog',
    customizable: false,
  },
  {
    id: 'close',
    label: 'Close dialog',
    keys: ['escape'],
    description: 'Close any dialog without applying changes.',
    scope: 'dialog',
    customizable: false,
  },
];

const shortcutById = new Map(SHORTCUTS.map((shortcut) => [shortcut.id, shortcut]));

export function getShortcut(id: string): ShortcutDefinition | null {
  return shortcutById.get(id) ?? null;
}

export function shortcutsByScope(scope: ShortcutScope): ShortcutDefinition[] {
  return SHORTCUTS.filter((shortcut) => shortcut.scope === scope);
}

interface ParsedBinding {
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  key: string;
}

const NAMED_KEYS: Record<string, string> = {
  esc: 'escape',
  escape: 'escape',
  enter: 'return',
  return: 'return',
  tab: 'tab',
  backspace: 'backspace',
  delete: 'delete',
  del: 'delete',
  up: 'up',
  down: 'down',
  left: 'left',
  right: 'right',
  pageup: 'pageup',
  pgup: 'pageup',
  pagedown: 'pagedown',
  pgdn: 'pagedown',
  space: ' ',
  question: '?',
};

export function parseBinding(binding: string): ParsedBinding | null {
  const tokens = binding
    .trim()
    .toLowerCase()
    .split('+')
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.length === 0) return null;
  const key = tokens.pop()!;
  const parsed: ParsedBinding = { ctrl: false, meta: false, shift: false, key };
  for (const token of tokens) {
    if (token === 'ctrl' || token === 'control') parsed.ctrl = true;
    else if (token === 'meta' || token === 'alt' || token === 'option') parsed.meta = true;
    else if (token === 'shift') parsed.shift = true;
    else return null;
  }
  parsed.key = NAMED_KEYS[key] ?? key;
  return parsed;
}

function eventMatchesBinding(input: string, key: ShortcutKey, binding: ParsedBinding): boolean {
  const ctrl = Boolean(key.ctrl);
  const meta = Boolean(key.meta);
  const shift = Boolean(key.shift);
  if (binding.ctrl !== ctrl || binding.meta !== meta) return false;
  // Shift is often implied by the character itself (for example "?"). Only
  // require it when the binding explicitly asks for a non-character key.
  if (binding.shift && !shift) return false;

  switch (binding.key) {
    case 'return':
      return Boolean(key.return) || input === '\r' || input === '\n';
    case 'escape':
      return Boolean(key.escape);
    case 'tab':
      return Boolean(key.tab);
    case 'backspace':
      return Boolean(key.backspace);
    case 'delete':
      return Boolean(key.delete);
    case 'up':
      return Boolean(key.upArrow);
    case 'down':
      return Boolean(key.downArrow);
    case 'left':
      return Boolean(key.leftArrow);
    case 'right':
      return Boolean(key.rightArrow);
    case 'pageup':
      return Boolean(key.pageUp);
    case 'pagedown':
      return Boolean(key.pageDown);
    default:
      return input.toLowerCase() === binding.key;
  }
}

export type ShortcutOverrides = Record<string, string>;

/**
 * Resolve the bindings for a shortcut id. Unknown override ids are ignored and
 * malformed bindings fall back to the defaults.
 */
export function bindingsFor(id: string, overrides: ShortcutOverrides = {}): ParsedBinding[] {
  const definition = getShortcut(id);
  if (!definition) return [];
  const configured = overrides[id]?.trim();
  const candidates = configured ? [configured] : definition.keys;
  const parsed = candidates
    .map(parseBinding)
    .filter((entry): entry is ParsedBinding => entry !== null);
  return parsed.length
    ? parsed
    : definition.keys.map(parseBinding).filter((entry): entry is ParsedBinding => entry !== null);
}

export function shortcutMatches(
  id: string,
  input: string,
  key: ShortcutKey,
  overrides: ShortcutOverrides = {},
): boolean {
  return bindingsFor(id, overrides).some((binding) => eventMatchesBinding(input, key, binding));
}

export function shortcutLabel(id: string, overrides: ShortcutOverrides = {}): string {
  const definition = getShortcut(id);
  if (!definition) return '';
  return overrides[id]?.trim() || definition.keys.join(' / ');
}

export function shortcutLines(): string[] {
  const lines: string[] = [];
  const labels: Record<ShortcutScope, string> = {
    global: 'GLOBAL',
    workspace: 'WORKSPACE',
    dialog: 'DIALOGS',
  };
  for (const scope of ['global', 'workspace', 'dialog'] as ShortcutScope[]) {
    lines.push(labels[scope]);
    for (const shortcut of shortcutsByScope(scope)) {
      lines.push(`  ${shortcut.keys.join(' / ').padEnd(18)} ${shortcut.description}`);
    }
    lines.push('');
  }
  return lines;
}
