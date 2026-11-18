/** Agent tools for opening, inspecting and interactively highlighting web pages. */
import type { ToolDefinition } from '../../types.js';
import type { ToolResult } from '../types.js';
import {
  closeWebSession,
  getWebSession,
  listWebSessions,
  openWebSession,
} from '../../ui/browser-session.js';

const WEB_ROOT = '.comicode/shots';

export const OPEN_WEB_TOOL_NAME = 'open_web';
export const WEB_ACTION_TOOL_NAME = 'web_action';
export const CLOSE_WEB_TOOL_NAME = 'close_web';

export const openWebToolDefinition: ToolDefinition = {
  name: OPEN_WEB_TOOL_NAME,
  description:
    'Open a web page in a real browser for inspection. Launches a visible browser window, injects a highlight overlay, and returns the page title, a DOM summary and a screenshot path. Use this when the user asks to inspect a website or a locally running web app. After opening, ask the user to click/highlight the part they mean and use web_action with action "select" to receive it.',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'URL to open (e.g. http://localhost:3000).' },
      waitMs: { type: 'integer', description: 'Optional extra wait after load, in milliseconds.' },
      timeoutMs: { type: 'integer', description: 'Navigation timeout (default 30000).' },
      enableSelection: {
        type: 'boolean',
        description: 'Let the user highlight elements in the page (default true).',
      },
    },
    required: ['url'],
  },
};

export const webActionToolDefinition: ToolDefinition = {
  name: WEB_ACTION_TOOL_NAME,
  description:
    'Interact with an already-open browser session: click, fill, press a key, scroll, read text/HTML, take a screenshot, or wait for the user to highlight something. Use action "select" after telling the user what to highlight — it returns the exact element selector, text, position and any selected text so you can work on that specific part of the page.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['click', 'fill', 'press', 'scroll', 'read', 'html', 'screenshot', 'select', 'list'],
        description: 'The action to perform.',
      },
      selector: { type: 'string', description: 'CSS selector for click/fill/press/read/html.' },
      value: { type: 'string', description: 'Value for fill.' },
      key: { type: 'string', description: 'Key for press (default Enter).' },
      y: { type: 'integer', description: 'Vertical scroll amount for scroll.' },
      sessionId: { type: 'string', description: 'Browser session id (uses the latest if omitted).' },
      timeoutMs: { type: 'integer', description: 'How long to wait for a user highlight (default 60000).' },
    },
    required: ['action'],
  },
};

export const closeWebToolDefinition: ToolDefinition = {
  name: CLOSE_WEB_TOOL_NAME,
  description: 'Close an open browser session when finished inspecting a page.',
  parameters: {
    type: 'object',
    properties: {
      sessionId: { type: 'string', description: 'Session id (closes the latest if omitted).' },
    },
    required: [],
  },
};

export const WEB_TOOL_DEFINITIONS: ToolDefinition[] = [
  openWebToolDefinition,
  webActionToolDefinition,
  closeWebToolDefinition,
];

export interface WebToolContext {
  cwd: string;
}

function ok(content: string): ToolResult {
  return { ok: true, content };
}

function fail(content: string): ToolResult {
  return { ok: false, content };
}

export async function executeOpenWebTool(
  args: Record<string, unknown>,
  context: WebToolContext,
): Promise<ToolResult> {
  const url = String(args.url ?? '').trim();
  if (!url) return fail('A URL is required.');
  try {
    const session = await openWebSession({
      url,
      resolveFrom: context.cwd,
      waitMs: Number(args.waitMs ?? 0),
      timeoutMs: Number(args.timeoutMs ?? 30_000),
      enableSelection: args.enableSelection !== false,
    });
    const info = await session.info();
    const screenshotPath = await session.screenshot(`${context.cwd}/${WEB_ROOT}`).catch(() => null);
    const lines = [
      `Opened ${url} in a browser (session ${session.id}).`,
      `Title: ${info.title}`,
      screenshotPath ? `Screenshot: ${screenshotPath}` : 'Screenshot: unavailable',
      'The page has a highlight overlay: the user can click an element or drag to select text.',
      'DOM summary:',
      info.domSummary.slice(0, 4_000),
    ];
    return ok(lines.join('\n'));
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

export async function executeWebActionTool(
  args: Record<string, unknown>,
  context: WebToolContext,
): Promise<ToolResult> {
  const action = String(args.action ?? '').trim();
  try {
    if (action === 'list') {
      const sessions = listWebSessions();
      return ok(sessions.length ? sessions.map((s) => `${s.id}: ${s.url}`).join('\n') : 'No open browser sessions.');
    }
    const session = getWebSession(args.sessionId ? String(args.sessionId) : undefined);
    if (action === 'select') {
      const selection = await session.waitForSelection(Number(args.timeoutMs ?? 60_000));
      if (!selection) {
        return fail('No highlight was received before the timeout. Ask the user to click the element or drag to select text, then retry.');
      }
      return ok(
        [
          `User highlighted a ${selection.kind}:`,
          `Selector: ${selection.selector}`,
          `Text: ${selection.text.slice(0, 1_000)}`,
          `Position: ${selection.box ? `${Math.round(selection.box.x)},${Math.round(selection.box.y)} ${Math.round(selection.box.width)}x${Math.round(selection.box.height)}` : 'unknown'}`,
          `Page: ${selection.url}`,
        ].join('\n'),
      );
    }
    if (action === 'screenshot') {
      const path = await session.screenshot(`${context.cwd}/${WEB_ROOT}`);
      return ok(`Screenshot saved: ${path}`);
    }
    const result = await session.action(action, args);
    return ok(result);
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

export async function executeCloseWebTool(args: Record<string, unknown>): Promise<ToolResult> {
  try {
    return ok(await closeWebSession(args.sessionId ? String(args.sessionId) : undefined));
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}
