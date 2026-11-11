import { mkdtempSync, rmSync } from 'node:fs';
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
  return new ToolExecutor({
    root,
    settings: DEFAULT_SETTINGS,
    authority: AUTHORITY,
    inspector: new ProjectInspector(root),
    confirm: confirm ? async () => confirm() : undefined,
  });
}

describe('verify_ui tool', () => {
  it('rejects non-http(s)/file URLs before any approval or browser launch', async () => {
    const tool = makeExecutor(async () => 'allow');
    const result = await tool.execute({
      id: 'v1',
      name: 'verify_ui',
      arguments: { url: 'javascript:alert(1)' },
    });
    expect(result.ok).toBe(false);
    expect(result.content).toContain('http://, https://, or file://');
  });

  it('requires approval before launching a browser', async () => {
    const tool = makeExecutor(async () => 'deny');
    const result = await tool.execute({
      id: 'v2',
      name: 'verify_ui',
      arguments: { url: 'https://example.com' },
    });
    expect(result.ok).toBe(false);
    expect(result.content).toContain('not approved');
  });

  it('reports honestly when Playwright is not installed', async () => {
    const tool = makeExecutor(async () => 'allow');
    const result = await tool.execute({
      id: 'v3',
      name: 'verify_ui',
      arguments: { url: 'https://example.com' },
    });
    // Either Playwright is absent (honest message) or present (real run).
    if (!result.ok) {
      expect(result.content).toMatch(/Playwright|browser|playwright install/i);
    } else {
      expect(result.content).toContain('Screenshot');
    }
  });
});
