import { describe, expect, it } from 'vitest';
import {
  buildHandoffNote,
  buildStagePrompt,
  selectTeamRoles,
  TEAM_ROLES,
} from '../src/core/agent/teams.js';
import { parseManifest, PluginManifestError } from '../src/core/plugins/manifest.js';
import { isImageModel, isImageOnlyModel } from '../src/core/providers/catalog.js';
import { TOOL_DEFINITIONS } from '../src/core/agent/tools/definitions.js';
import { getWebSession } from '../src/core/ui/browser-session.js';

describe('virtual company teams', () => {
  it('assembles the full organization for org-wide requests', () => {
    const roles = selectTeamRoles('build a full organization with a marketing team', 'build');
    expect(roles.length).toBe(11);
    expect(roles[0]!.id).toBe('research');
    expect(roles.some((role) => role.id === 'marketing')).toBe(true);
    expect(roles.some((role) => role.id === 'security')).toBe(true);
  });

  it('picks a focused pipeline for focused requests', () => {
    const roles = selectTeamRoles('audit this code for security vulnerabilities', 'auto');
    expect(roles.map((role) => role.id)).toEqual(['research', 'security', 'review']);
  });

  it('gives every role a mode, task type and handoff instructions', () => {
    for (const role of Object.values(TEAM_ROLES)) {
      expect(role.mode).toBeTruthy();
      expect(role.taskType).toBeTruthy();
      expect(role.instructions).toContain('STAGE_STATUS');
    }
  });

  it('builds a stage prompt that carries the previous handoff', () => {
    const prompt = buildStagePrompt(
      TEAM_ROLES.engineering!,
      'Build a feature',
      'Previous stage stopped after designing the schema.',
    );
    expect(prompt).toContain('Build a feature');
    expect(prompt).toContain('Previous stage stopped after designing the schema.');
    expect(prompt).toContain('SENIOR ENGINEER');
  });

  it('builds a compact handoff with changed files', () => {
    const note = buildHandoffNote(TEAM_ROLES.qa!, 'Implemented auth flow', ['src/auth.ts']);
    expect(note).toContain('Implemented auth flow');
    expect(note).toContain('src/auth.ts');
    expect(note.length).toBeLessThan(4_000);
  });
});

describe('plugin manifests', () => {
  it('parses a valid manifest', () => {
    const manifest = parseManifest({
      name: 'my-plugin',
      version: '1.0.0',
      description: 'Example',
      commands: [{ name: 'hello', description: 'Say hello', promptTemplate: 'Say hello' }],
      skills: [{ name: 'skill', description: 'A skill', body: '# Skill' }],
    });
    expect(manifest.name).toBe('my-plugin');
    expect(manifest.commands?.[0]?.name).toBe('hello');
  });

  it('rejects invalid manifests', () => {
    expect(() => parseManifest({ version: '1.0.0' })).toThrow(PluginManifestError);
  });
});

describe('web inspection tools', () => {
  it('registers browser tools for the agent', () => {
    const names = TOOL_DEFINITIONS.map((tool) => tool.name);
    expect(names).toContain('open_web');
    expect(names).toContain('web_action');
    expect(names).toContain('close_web');
  });

  it('fails clearly when no browser session is open', () => {
    expect(() => getWebSession('missing-session')).toThrow(/No open browser session/);
  });
});

describe('image model detection', () => {
  it('recognizes image models without breaking chat models', () => {
    expect(isImageModel('imagen-3.0-generate-002')).toBe(true);
    expect(isImageModel('gemini-2.0-flash-preview-image-generation')).toBe(true);
    expect(isImageModel('gpt-image-1')).toBe(true);
    expect(isImageModel('gemini-2.5-pro')).toBe(false);
    expect(isImageOnlyModel('imagen-3.0-generate-002')).toBe(true);
  });
});
