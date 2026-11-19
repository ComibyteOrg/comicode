import { describe, expect, it } from 'vitest';
import {
  buildStagePrompt,
  parseStageDirective,
  resolveTeamPlan,
  TEAM_ROLES,
} from '../src/core/agent/teams.js';

describe('dynamic team roles', () => {
  it('plans plan → frontend → backend → security → review for an ecommerce build', () => {
    expect(resolveTeamPlan('build me an ecommerce site', 'auto').roles).toEqual([
      'plan',
      'frontend',
      'backend',
      'security',
      'review',
    ]);
  });

  it('maps a debugging prompt to the debug specialist', () => {
    expect(resolveTeamPlan('fix this crash in the login flow', 'auto').roles).toEqual(['debug']);
  });

  it('parses revisit directives from a stage result', () => {
    expect(parseStageDirective('STAGE_STATUS: schema done\nNEEDS_REVISIT: frontend')).toEqual({
      status: 'schema done',
      revisit: 'frontend',
    });
  });

  it('embeds only the latest handoff in a stage prompt', () => {
    const prompt = buildStagePrompt(TEAM_ROLES.backend!, 'req', 'latest note');
    expect(prompt).toContain('latest note');
    expect(prompt).not.toContain('older note');
  });
});
