import { describe, expect, it } from 'vitest';
import {
  AGENT_REGISTRY,
  getAgentDefinition,
  resolveAgentId,
  type AgentId,
} from '../src/core/agent/registry.js';
import { TEAM_ROLES } from '../src/core/agent/teams.js';

describe('agent registry', () => {
  it('defines exactly the 14 sidebar agents', () => {
    expect(AGENT_REGISTRY).toHaveLength(14);
    expect(AGENT_REGISTRY.map((agent) => agent.id)).toEqual([
      'team_lead', 'planner', 'research', 'designer', 'frontend', 'backend',
      'database', 'mobile', 'debugger', 'qa', 'security', 'reviewer', 'devops', 'docs',
    ]);
  });

  it('treats the team lead as a coordinator with no model call', () => {
    expect(getAgentDefinition('team_lead').mode).toBeNull();
    expect(getAgentDefinition('team_lead').roleId).toBeNull();
  });

  it('maps legacy role ids to their sidebar agents', () => {
    expect(resolveAgentId('plan')).toBe('planner');
    expect(resolveAgentId('debug')).toBe('debugger');
    expect(resolveAgentId('review')).toBe('reviewer');
    expect(resolveAgentId('design')).toBe('designer');
  });

  it('has real database and mobile runtime roles', () => {
    const database = TEAM_ROLES.database!;
    const mobile = TEAM_ROLES.mobile!;
    expect(database.mode).toBeTruthy();
    expect(mobile.mode).toBeTruthy();
    expect(resolveAgentId('database')).toBe('database');
    expect(resolveAgentId('mobile')).toBe('mobile');
  });

  it('exposes non-empty responsibilities for every agent', () => {
    for (const agent of AGENT_REGISTRY as Array<{ id: AgentId; responsibilities: string[] }>) {
      expect(agent.responsibilities.length).toBeGreaterThan(0);
    }
  });
});
