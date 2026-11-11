import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

export interface UiVerifyOptions {
  waitMs?: number;
  outDir: string;
  timeoutMs?: number;
  /** Project root used to resolve a project-local Playwright install. */
  resolveFrom?: string;
}

/**
 * Locate Playwright: first ComiCode's own install (dev/global), then the
 * user's project via createRequire so a globally-installed CLI can still use
 * a project's devDependency.
 */
async function loadChromium(resolveFrom?: string): Promise<any | null> {
  // Prefer the slim playwright-core; fall back to full playwright for projects
  // that installed it. Both are resolved next to ComiCode first, then inside
  // the user's project so a global CLI can reuse a project devDependency.
  for (const name of ['playwright-core', 'playwright']) {
    try {
      const mod = (await import(name)) as { chromium?: any };
      if (mod.chromium) return mod.chromium;
    } catch {
      // Not installed next to ComiCode — try the project below.
    }
    if (resolveFrom) {
      try {
        const require = createRequire(join(resolveFrom, 'package.json'));
        const mod = require(name) as {
          chromium?: any;
          default?: { chromium?: any };
        };
        const chromium = mod.chromium ?? mod.default?.chromium;
        if (chromium) return chromium;
      } catch {
        // No project-local install of this package either.
      }
    }
  }
  return null;
}

export interface UiVerifyResult {
  ok: boolean;
  message: string;
  screenshotPath?: string;
  title?: string;
  consoleErrors: string[];
  failedRequests: string[];
}

/**
 * Real browser verification via Playwright, loaded lazily so ComiCode stays
 * lightweight for users who never verify UI. When Playwright (and its
 * browsers) are not installed the result says so honestly instead of
 * pretending a screenshot happened.
 */
export async function verifyPage(url: string, options: UiVerifyOptions): Promise<UiVerifyResult> {
  const chromium = await loadChromium(options.resolveFrom);
  if (!chromium) {
    return {
      ok: false,
      message:
        'Playwright is not installed, so no browser verification ran. ' +
        'Install it in this project (`npm i -D playwright && npx playwright install chromium`) ' +
        'or set agent.uiVerifyCommand to your own screenshot/a11y script.',
      consoleErrors: [],
      failedRequests: [],
    };
  }

  const timeoutMs = options.timeoutMs ?? 30_000;
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  // Try bundled/installed Chromium first, then system Edge/Chrome so users
  // need zero browser downloads on machines that already have a browser.
  let browser: any = null;
  let lastLaunchError: unknown = null;
  for (const launchOptions of [
    { headless: true },
    { headless: true, channel: 'msedge' },
    { headless: true, channel: 'chrome' },
  ]) {
    try {
      browser = await chromium.launch(launchOptions);
      break;
    } catch (error) {
      lastLaunchError = error;
    }
  }
  if (!browser) {
    return {
      ok: false,
      message: `Could not launch a browser: ${lastLaunchError instanceof Error ? lastLaunchError.message : String(lastLaunchError)}. Install browsers with \`npx playwright install chromium\` or set agent.uiVerifyCommand.`,
      consoleErrors: [],
      failedRequests: [],
    };
  }

  try {
    const page = await browser.newPage();
    page.on('console', (msg: any) => {
      if (msg.type() === 'error') consoleErrors.push(String(msg.text()).slice(0, 300));
    });
    page.on('pageerror', (error: any) => {
      consoleErrors.push(String(error).slice(0, 300));
    });
    page.on('requestfailed', (request: any) => {
      const failure = request.failure()?.errorText ?? 'failed';
      failedRequests.push(`${request.url()} (${failure})`.slice(0, 300));
    });
    page.on('response', (response: any) => {
      if (response.status() >= 400) {
        failedRequests.push(`${response.status()} ${response.url()}`.slice(0, 300));
      }
    });

    await page.goto(url, { waitUntil: 'networkidle', timeout: timeoutMs });
    if (options.waitMs) await page.waitForTimeout(options.waitMs);

    mkdirSync(options.outDir, { recursive: true });
    const screenshotPath = join(options.outDir, `verify-${Date.now()}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: false });

    return {
      ok: true,
      message: `Browser verification completed for ${url}. Screenshot saved.`,
      screenshotPath,
      title: (await page.title().catch(() => null)) ?? undefined,
      consoleErrors: consoleErrors.slice(0, 20),
      failedRequests: failedRequests.slice(0, 20),
    };
  } catch (error) {
    return {
      ok: false,
      message: `Browser verification failed: ${error instanceof Error ? error.message : String(error)}`,
      consoleErrors: consoleErrors.slice(0, 20),
      failedRequests: failedRequests.slice(0, 20),
    };
  } finally {
    await browser.close().catch(() => undefined);
  }
}
