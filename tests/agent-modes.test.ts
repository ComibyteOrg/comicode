import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ToolExecutor } from '../src/core/agent/tools/executor.js';
import { ProjectInspector } from '../src/core/project/inspector.js';
import { DEFAULT_SETTINGS } from '../src/core/settings.js';
import type { AppSettings } from '../src/core/settings.js';
import type { AgentAuthority } from '../src/core/types.js';
import {
  AGENT_MODES,
  classifyAgentMode,
  isAgentMode,
  nextAgentMode,
} from '../src/core/agent/modes.js';
import { findSkill, formatSkillsSection, loadSkills } from '../src/core/agent/skills.js';
import type { AgentMode } from '../src/core/agent/modes.js';

const AUTHORITY: AgentAuthority = {
  allowFileWrites: false,
  allowCommands: false,
  allowDangerousCommands: false,
  allowSecrets: false,
  allowGitWrite: false,
};

let root: string;
let home: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'comicode-modes-'));
  home = mkdtempSync(join(tmpdir(), 'comicode-home-'));
  process.env.COMICODE_HOME = home;
});

afterAll(() => {
  delete process.env.COMICODE_HOME;
  rmSync(root, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

function settingsWith(patch?: (settings: AppSettings) => void): AppSettings {
  const settings = structuredClone(DEFAULT_SETTINGS);
  patch?.(settings);
  return settings;
}

function executor(options: {
  mode?: AgentMode;
  settings?: AppSettings;
  confirm?: ConstructorParameters<typeof ToolExecutor>[0]['confirm'];
}): ToolExecutor {
  return new ToolExecutor({
    root,
    settings: options.settings ?? DEFAULT_SETTINGS,
    authority: AUTHORITY,
    inspector: new ProjectInspector(root),
    mode: options.mode,
    confirm: options.confirm,
  });
}

describe('agent modes', () => {
  it('cycles through all modes and wraps around', () => {
    expect(nextAgentMode('build', 1)).toBe('plan');
    expect(nextAgentMode('plan', 1)).toBe('debug');
    expect(nextAgentMode('debug', 1)).toBe('architect');
    expect(nextAgentMode('explain', 1)).toBe('review');
    expect(nextAgentMode('design', 1)).toBe('auto');
    expect(nextAgentMode('auto', 1)).toBe('build');
    expect(nextAgentMode('build', -1)).toBe('auto');
    expect(isAgentMode('plan')).toBe(true);
    expect(isAgentMode('review')).toBe(true);
    expect(isAgentMode('security')).toBe(true);
    expect(isAgentMode('nope')).toBe(false);
    expect(AGENT_MODES.plan.tools).toBe('read-only');
    expect(AGENT_MODES.review.tools).toBe('read-only');
    expect(AGENT_MODES.security.tools).toBe('read-only');
    expect(AGENT_MODES.explain.tools).toBe('read-only');
  });

  it('classifies tasks into the right mode for auto', () => {
    expect(classifyAgentMode('fix the crash in login')).toBe('debug');
    expect(classifyAgentMode('review this code for bugs')).toBe('review');
    expect(classifyAgentMode('check for security vulnerabilities')).toBe('security');
    expect(classifyAgentMode('refactor this module to remove duplication')).toBe('refactor');
    expect(classifyAgentMode('write unit tests for the parser')).toBe('test');
    expect(classifyAgentMode('design a landing page UI')).toBe('design');
    expect(classifyAgentMode('explain how the router works')).toBe('explain');
    expect(classifyAgentMode('add a settings endpoint')).toBe('build');
  });

  it('plan mode hides write tools and blocks them at execution', async () => {
    const plan = executor({ mode: 'plan' });
    const names = plan.definitions().map((tool) => tool.name);
    expect(names).toContain('read_file');
    expect(names).toContain('use_skill');
    expect(names).not.toContain('write_file');
    expect(names).not.toContain('run_command');

    const result = await plan.execute({
      id: 't1',
      name: 'write_file',
      arguments: { path: 'x.txt', content: 'hi' },
    });
    expect(result.ok).toBe(false);
    expect(result.content).toContain('plan mode');
    expect(existsSync(join(root, 'x.txt'))).toBe(false);
  });
});

describe('skills', () => {
  it('ships built-in skills and formats the system-prompt section', () => {
    const skills = loadSkills(root);
    const names = skills.map((skill) => skill.name);
    expect(names).toContain('debug-systematically');
    expect(names).toContain('test-driven-change');
    expect(names).toContain('safe-refactor');
    expect(names).toContain('code-review');

    const section = formatSkillsSection(skills);
    expect(section).toContain('# Skills');
    expect(section).toContain('use_skill');
    expect(findSkill(skills, 'debug')?.name).toBe('debug-systematically');
  });

  it('discovers project skills from .comicode/skills', () => {
    const dir = join(root, '.comicode', 'skills', 'deploy-check');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'SKILL.md'),
      '---\nname: deploy-check\ndescription: Verify deploy readiness.\n---\n# Deploy check\nRun the checklist.',
    );
    const skills = loadSkills(root);
    const skill = findSkill(skills, 'deploy-check');
    expect(skill?.source).toBe('project');
    expect(skill?.description).toBe('Verify deploy readiness.');
    expect(skill?.content).toContain('Run the checklist');
  });
});

describe('permission grants', () => {
  it('always-allow path grants skip the confirmation prompt', async () => {
    const settings = settingsWith((s) => {
      s.agent.permissions.allowPaths.push('granted/');
    });
    // No confirm callback: without a grant this would fail with "no interactive confirmation".
    const tool = executor({ settings });
    const result = await tool.execute({
      id: 't2',
      name: 'write_file',
      arguments: { path: 'granted/ok.txt', content: 'allowed' },
    });
    expect(result.ok).toBe(true);
    expect(readFileSync(join(root, 'granted', 'ok.txt'), 'utf8')).toBe('allowed');
  });

  it('denies writes outside granted paths when there is no confirmer', async () => {
    const settings = settingsWith((s) => {
      s.agent.permissions.allowPaths.push('granted/');
    });
    const tool = executor({ settings });
    const result = await tool.execute({
      id: 't3',
      name: 'write_file',
      arguments: { path: 'other/nope.txt', content: 'denied' },
    });
    expect(result.ok).toBe(false);
    expect(result.content).toContain('not approved');
    expect(existsSync(join(root, 'other', 'nope.txt'))).toBe(false);
  });

  it('use_skill returns builtin skill content', async () => {
    const withSkills = new ToolExecutor({
      root,
      settings: DEFAULT_SETTINGS,
      authority: AUTHORITY,
      inspector: new ProjectInspector(root),
      skills: loadSkills(root),
    });
    const result = await withSkills.execute({
      id: 't4',
      name: 'use_skill',
      arguments: { name: 'debug' },
    });
    expect(result.ok).toBe(true);
    expect(result.content).toContain('debug-systematically');
  });
});
