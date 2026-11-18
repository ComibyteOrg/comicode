/**
 * Persistent, headed browser sessions for agent-driven web inspection.
 *
 * The user can highlight an element in the opened page (click it, or drag to
 * select text) and the selection is reported back into the running agent
 * through a Playwright binding — no extra server or dependency required.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadChromium } from './browser-verify.js';

export interface WebSelection {
  selector: string;
  tag: string;
  text: string;
  id?: string;
  classes: string[];
  box: { x: number; y: number; width: number; height: number } | null;
  kind: 'element' | 'text';
  url: string;
  at: string;
}

export interface OpenWebOptions {
  url: string;
  resolveFrom?: string;
  waitMs?: number;
  timeoutMs?: number;
  /** Allow the user to highlight elements in the opened page. */
  enableSelection?: boolean;
}

export interface WebSessionInfo {
  id: string;
  url: string;
  title: string;
  screenshotPath: string | null;
  domSummary: string;
  consoleErrors: string[];
}

const SELECTION_BINDING = '__comicodeReportSelection';

function cssSelectorFor(element: any): string {
  if (element.id) return `#${String(element.id).replace(/[^a-zA-Z0-9_-]/g, '\\$&')}`;
  const parts: string[] = [];
  let node = element;
  while (node && node.nodeType === 1 && parts.length < 5) {
    const tag = String(node.tagName ?? '').toLowerCase();
    if (!tag) break;
    const parent = node.parentElement;
    const siblings = parent
      ? Array.from(parent.children as ArrayLike<any>).filter((child: any) => child.tagName === node.tagName)
      : [];
    const index = siblings.length > 1 ? siblings.indexOf(node) + 1 : 0;
    let part = tag;
    if (node.id) {
      part += `#${String(node.id).replace(/[^a-zA-Z0-9_-]/g, '\\$&')}`;
      parts.unshift(part);
      break;
    }
    const classes = String(node.className ?? '')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2);
    if (classes.length) part += classes.map((c) => `.${c.replace(/[^a-zA-Z0-9_-]/g, '\\$&')}`).join('');
    if (index) part += `:nth-of-type(${index})`;
    parts.unshift(part);
    node = parent;
  }
  return parts.join(' > ');
}

export class BrowserSession {
  private readonly selections: WebSelection[] = [];
  private selectionWaiters: Array<(selection: WebSelection) => void> = [];

  private constructor(
    readonly id: string,
    private readonly browser: any,
    readonly page: any,
    readonly url: string,
    private readonly resolveFrom?: string,
  ) {}

  static async open(options: OpenWebOptions): Promise<BrowserSession> {
    const chromium = await loadChromium(options.resolveFrom);
    if (!chromium) {
      throw new Error(
        'Playwright is not installed. Install it in this project: `npm i -D playwright && npx playwright install chromium`, or use an existing system browser via channel msedge/chrome.',
      );
    }
    const timeoutMs = options.timeoutMs ?? 30_000;
    let browser: any = null;
    let lastError: unknown = null;
    // Prefer an already-installed system browser — zero download. Only fall
    // back to Playwright's bundled Chromium if the user has installed it.
    for (const launch of [
      { headless: false, channel: 'msedge' },
      { headless: false, channel: 'chrome' },
      { headless: false },
      { headless: true, channel: 'msedge' },
      { headless: true, channel: 'chrome' },
      { headless: true },
    ]) {
      try {
        browser = await chromium.launch(launch);
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (!browser) {
      throw new Error(
        `Could not launch a browser: ${lastError instanceof Error ? lastError.message : String(lastError)}. Install with \`npx playwright install chromium\`.`,
      );
    }

    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const session = new BrowserSession(
      `web-${Date.now().toString(36)}`,
      browser,
      page,
      options.url,
      options.resolveFrom,
    );

    await page.exposeBinding(SELECTION_BINDING, (_source: unknown, payload: string) => {
      try {
        const selection = JSON.parse(payload) as WebSelection;
        session.selections.push(selection);
        for (const waiter of session.selectionWaiters.splice(0)) waiter(selection);
      } catch {
        // Ignore malformed payloads from the page.
      }
    });

    await page.goto(options.url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    if (options.waitMs) await page.waitForTimeout(options.waitMs);

    if (options.enableSelection !== false) await session.installSelectionOverlay();
    return session;
  }

  private async installSelectionOverlay(): Promise<void> {
    await this.page.evaluate(() => {
      const binding = (window as any)[SELECTION_BINDING];
      const report = (selection: unknown): void => {
        if (typeof binding === 'function') void binding(JSON.stringify(selection));
      };
      if ((window as any).__comicodeOverlayInstalled) return;
      (window as any).__comicodeOverlayInstalled = true;

      const badge = document.createElement('div');
      badge.textContent = 'ComiCode: click any element to highlight it for the agent · drag to select text';
      Object.assign(badge.style, {
        position: 'fixed',
        bottom: '12px',
        right: '12px',
        zIndex: '2147483647',
        padding: '8px 12px',
        font: '12px ui-monospace, monospace',
        color: '#06110d',
        background: '#7ce8c3',
        borderRadius: '8px',
        boxShadow: '0 8px 24px rgba(0,0,0,.35)',
        pointerEvents: 'none',
      });
      document.body.appendChild(badge);

      const outline = (element: Element | null, color: string): void => {
        if (!element || !(element instanceof HTMLElement)) return;
        element.style.outline = `3px solid ${color}`;
        setTimeout(() => {
          element.style.outline = '';
        }, 1800);
      };

      document.addEventListener(
        'click',
        (event) => {
          if (!(event.target instanceof Element)) return;
          const element = event.target;
          if (element.closest('[data-comicode-overlay]')) return;
          const rect = element.getBoundingClientRect();
          outline(element, '#f5c46b');
          const value = {
            selector: (window as any).__comicodeSelector?.(element) ?? element.tagName.toLowerCase(),
            tag: element.tagName.toLowerCase(),
            text: (element.textContent ?? '').trim().slice(0, 1_200),
            id: element.id || undefined,
            classes: String(element.className ?? '').split(/\s+/).filter(Boolean).slice(0, 8),
            box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            kind: 'element',
            url: location.href,
            at: new Date().toISOString(),
          };
          report(value);
        },
        true,
      );

      document.addEventListener('mouseup', () => {
        const text = String(window.getSelection() ?? '').trim();
        if (!text) return;
        const range = window.getSelection()?.rangeCount ? window.getSelection()!.getRangeAt(0) : null;
        const element = range?.startContainer instanceof Element
          ? range.startContainer
          : (range?.startContainer.parentElement ?? document.body);
        report({
          selector: (window as any).__comicodeSelector?.(element) ?? element.tagName.toLowerCase(),
          tag: element.tagName.toLowerCase(),
          text: text.slice(0, 2_000),
          id: element.id || undefined,
          classes: String(element.className ?? '').split(/\s+/).filter(Boolean).slice(0, 8),
          box: element instanceof HTMLElement ? { ...element.getBoundingClientRect().toJSON() } : null,
          kind: 'text',
          url: location.href,
          at: new Date().toISOString(),
        });
        window.getSelection()?.removeAllRanges();
      });
    });

    // Share the selector helper with the injected click handler.
    await this.page.evaluate((fn: string) => {
      (window as any).__comicodeSelector = new Function('element', `return (${fn})(element)`);
    }, cssSelectorFor.toString());
  }

  async info(): Promise<WebSessionInfo> {
    const title = await this.page.title().catch(() => '');
    let domSummary = '';
    try {
      domSummary = (await this.page.evaluate(() => {
        const pick = (element: Element): string => {
          const tag = element.tagName.toLowerCase();
          const name = element.getAttribute('aria-label') ?? element.id ?? '';
          const text = (element.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 80);
          return `- <${tag}${name ? ` ${name}` : ''}> ${text}`;
        };
        const interesting = Array.from(
          document.querySelectorAll('h1,h2,h3,button,a,input,textarea,[role=button]'),
        ).slice(0, 60);
        return `URL: ${location.href}\nTitle: ${document.title}\n` + interesting.map(pick).join('\n');
      })) as string;
    } catch {
      domSummary = `URL: ${this.url}`;
    }
    return {
      id: this.id,
      url: this.url,
      title,
      screenshotPath: null,
      domSummary: domSummary.slice(0, 8_000),
      consoleErrors: [],
    };
  }

  async screenshot(outDir: string): Promise<string> {
    mkdirSync(outDir, { recursive: true });
    const path = join(outDir, `web-${Date.now()}.png`);
    await this.page.screenshot({ path, fullPage: false });
    return path;
  }

  async action(
    action: string,
    args: Record<string, unknown>,
  ): Promise<string> {
    const selector = String(args.selector ?? 'body');
    switch (action) {
      case 'click':
        await this.page.click(selector, { timeout: 10_000 });
        return `Clicked ${selector}.`;
      case 'fill':
        await this.page.fill(selector, String(args.value ?? ''), { timeout: 10_000 });
        return `Filled ${selector}.`;
      case 'press':
        await this.page.press(selector, String(args.key ?? 'Enter'), { timeout: 10_000 });
        return `Pressed ${String(args.key ?? 'Enter')} on ${selector}.`;
      case 'scroll':
        await this.page.evaluate((y: number) => window.scrollBy(0, y), Number(args.y ?? 400));
        return `Scrolled.`;
      case 'read':
        return String(
          await this.page.evaluate((s: string) => {
            const element = document.querySelector(s);
            return element ? (element.textContent ?? '').trim().slice(0, 8_000) : `No element matches ${s}`;
          }, selector),
        );
      case 'html':
        return String(
          await this.page.evaluate((s: string) => {
            const element = document.querySelector(s);
            return element ? element.outerHTML.slice(0, 8_000) : `No element matches ${s}`;
          }, selector),
        );
      default:
        throw new Error(`Unknown web action "${action}". Use click, fill, press, scroll, read, html, screenshot, or select.`);
    }
  }

  async waitForSelection(timeoutMs = 60_000): Promise<WebSelection | null> {
    const existing = this.selections.shift();
    if (existing) return existing;
    if (timeoutMs <= 0) return null;
    return new Promise((resolveSelection) => {
      const timer = setTimeout(() => {
        this.selectionWaiters = this.selectionWaiters.filter((waiter) => waiter !== deliver);
        resolveSelection(null);
      }, timeoutMs);
      const deliver = (selection: WebSelection): void => {
        clearTimeout(timer);
        resolveSelection(selection);
      };
      this.selectionWaiters.push(deliver);
    });
  }

  async close(): Promise<void> {
    await this.browser.close().catch(() => undefined);
  }
}

/** Sessions stay alive across tool calls until closed or the process exits. */
const sessions = new Map<string, BrowserSession>();

export async function openWebSession(options: OpenWebOptions): Promise<BrowserSession> {
  const session = await BrowserSession.open(options);
  sessions.set(session.id, session);
  return session;
}

export function getWebSession(id?: string): BrowserSession {
  const key = id ?? [...sessions.keys()].at(-1);
  const session = key ? sessions.get(key) : null;
  if (!session) throw new Error('No open browser session. Use open_web first.');
  return session;
}

export function listWebSessions(): Array<{ id: string; url: string }> {
  return [...sessions.values()].map((session) => ({ id: session.id, url: session.url }));
}

export async function closeWebSession(id?: string): Promise<string> {
  const key = id ?? [...sessions.keys()].at(-1);
  const session = key ? sessions.get(key) : null;
  if (!session) return 'No open browser session.';
  await session.close();
  if (key) sessions.delete(key);
  return `Closed browser session ${session.id}.`;
}

export async function closeAllWebSessions(): Promise<void> {
  for (const session of sessions.values()) await session.close().catch(() => undefined);
  sessions.clear();
}

process.once('exit', () => {
  void closeAllWebSessions();
});
