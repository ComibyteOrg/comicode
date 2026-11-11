import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ToolExecutor } from '../src/core/agent/tools/executor.js';
import { ProjectInspector } from '../src/core/project/inspector.js';
import { DEFAULT_SETTINGS } from '../src/core/settings.js';
import type { AgentAuthority } from '../src/core/types.js';

const cleanup: Array<() => void> = [];
afterEach(() => { while (cleanup.length) cleanup.pop()?.(); });

const AUTHORITY: AgentAuthority = {
  allowFileWrites: false,
  allowCommands: false,
  allowDangerousCommands: false,
  allowSecrets: false,
  allowGitWrite: false,
};

function makeExecutor(confirm?: () => Promise<'allow' | 'always' | 'deny'>) {
  const root = mkdtempSync(join(tmpdir(), 'comicode-uiv-'));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const tool = new ToolExecutor({
    root,
    settings: DEFAULT_SETTINGS,
    authority: AUTHORITY,
    inspector: new ProjectInspector(root),
    confirm: confirm ? async () => confirm() : undefined,
  });
  return { tool, root };
}

describe('verify_ui tool', () => {
  it('rejects non-http(s)/file URLs before any approval or browser launch', async () => {
    const { tool } = makeExecutor(async () => 'allow');
    const result = await tool.execute({
      id: 'v1',
      name: 'verify_ui',
      arguments: { url: 'javascript:alert(1)' },
    });
    expect(result.ok).toBe(false);
    expect(result.content).toContain('http://, https://, or file://');
  });

  it('requires approval before launching a browser', async () => {
    const { tool } = makeExecutor(async () => 'deny');
    const result = await tool.execute({
      id: 'v2',
      name: 'verify_ui',
      arguments: { url: 'https://example.com' },
    });
    expect(result.ok).toBe(false);
    expect(result.content).toContain('not approved');
  });

  it('verifies a local page or reports honestly when no browser exists', async () => {
    const { tool, root } = makeExecutor(async () => 'allow');
    const page = join(root, 'page.html');
    writeFileSync(page, '<html><body><h1>ok</h1></body></html>');
    const result = await tool.execute({
      id: 'v3',
      name: 'verify_ui',
      arguments: { url: `file:///${page.replace(/\\/g, '/')}`, wait_ms: 0 },
    });
    // Either a real browser ran (screenshot + report) or an honest message.
    if (result.ok) {
      expect(result.content).toContain('Screenshot');
    } else {
      expect(result.content).toMatch(/Playwright|browser|playwright install/i);
    }
  });
});
