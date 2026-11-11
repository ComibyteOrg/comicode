import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export interface UiVerifyOptions {
  waitMs?: number;
  outDir: string;
  timeoutMs?: number;
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
  let chromium: any;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    return {
      ok: false,
      message:
        'Playwright is not installed, so no browser verification ran. ' +
        'Install it (`npm i -D playwright && npx playwright install chromium`) ' +
        'or set agent.uiVerifyCommand to your own screenshot/a11y script.',
      consoleErrors: [],
      failedRequests: [],
    };
  }

  const timeoutMs = options.timeoutMs ?? 30_000;
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  let browser: any;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (error) {
    return {
      ok: false,
      message: `Could not launch a browser: ${error instanceof Error ? error.message : String(error)}. Run \`npx playwright install chromium\` first.`,
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
