/** The 14-agent software team exposed by the workspace sidebar. */
import type { AgentMode } from './modes.js';
import type { TeamRoleId } from './teams.js';
import type { AgentEvent } from '../events/types.js';
import type { TaskContract } from './task-contract.js';

export type AgentId =
  | 'team_lead'
  | 'planner'
  | 'research'
  | 'designer'
  | 'frontend'
  | 'backend'
  | 'database'
  | 'mobile'
  | 'debugger'
  | 'qa'
  | 'security'
  | 'reviewer'
  | 'devops'
  | 'docs';

export type AgentToolScope = 'all' | 'read-only' | 'frontend' | 'backend' | 'database' | 'mobile';

export interface AgentDefinition {
  id: AgentId;
  name: string;
  icon: string;
  description: string;
  responsibilities: string[];
  roleId: TeamRoleId | null;
  /** null means the coordinator, which never makes a model call. */
  mode: AgentMode | null;
  toolScope: AgentToolScope;
}

export interface AgentRuntimeState {
  status: 'idle' | 'working' | 'waiting' | 'completed' | 'failed' | 'needs_input';
  currentTaskId: string | null;
  assignedTaskCount: number;
  completedTaskCount: number;
  model: string | null;
  provider: string | null;
  lastError: string | null;
}

export const AGENT_REGISTRY: AgentDefinition[] = [
  {
    id: 'team_lead',
    name: 'Team Lead',
    icon: '◈',
    description: 'Coordinates the team, assigns work and consolidates results.',
    responsibilities: ['Understand the request', 'Build the plan', 'Assign specialists', 'Collect results'],
    roleId: null,
    mode: null,
    toolScope: 'read-only',
  },
  {
    id: 'planner',
    name: 'Project Planner',
    icon: '▤',
    description: 'Turns requests into ordered, testable plans.',
    responsibilities: ['Scope the work', 'Define acceptance criteria', 'Set step order'],
    roleId: 'plan',
    mode: 'plan',
    toolScope: 'read-only',
  },
  {
    id: 'research',
    name: 'Research Agent',
    icon: '◉',
    description: 'Maps the codebase and constraints before implementation.',
    responsibilities: ['Inspect existing code', 'Identify risks', 'Recommend approach'],
    roleId: 'research',
    mode: 'explain',
    toolScope: 'read-only',
  },
  {
    id: 'designer',
    name: 'UI/UX Designer',
    icon: '✦',
    description: 'Defines layout, tokens, states and visual assets.',
    responsibilities: ['Design system tokens', 'Responsive states', 'Image assets'],
    roleId: 'design',
    mode: 'design',
    toolScope: 'frontend',
  },
  {
    id: 'frontend',
    name: 'Frontend Developer',
    icon: '◇',
    description: 'Implements client-side UI and interactions.',
    responsibilities: ['Build screens', 'Handle states', 'Verify client builds'],
    roleId: 'frontend',
    mode: 'build',
    toolScope: 'frontend',
  },
  {
    id: 'backend',
    name: 'Backend Developer',
    icon: '⬡',
    description: 'Implements APIs, services and business rules.',
    responsibilities: ['Build endpoints', 'Business logic', 'Service tests'],
    roleId: 'backend',
    mode: 'build',
    toolScope: 'backend',
  },
  {
    id: 'database',
    name: 'Database Architect',
    icon: '▦',
    description: 'Owns schemas, migrations, indexes and queries.',
    responsibilities: ['Design schema', 'Safe migrations', 'Query performance'],
    roleId: 'database',
    mode: 'architect',
    toolScope: 'database',
  },
  {
    id: 'mobile',
    name: 'Mobile Developer',
    icon: '▤',
    description: 'Builds mobile screens and responsive behaviour.',
    responsibilities: ['Mobile UI', 'Navigation', 'Offline states'],
    roleId: 'mobile',
    mode: 'design',
    toolScope: 'mobile',
  },
  {
    id: 'debugger',
    name: 'Debugging Specialist',
    icon: '⌁',
    description: 'Isolates root causes and lands minimal fixes.',
    responsibilities: ['Reproduce', 'Root-cause analysis', 'Regression tests'],
    roleId: 'debug',
    mode: 'debug',
    toolScope: 'all',
  },
  {
    id: 'qa',
    name: 'QA / Testing Engineer',
    icon: '◉',
    description: 'Validates behaviour with real tests.',
    responsibilities: ['Write tests', 'Run suites', 'Report gaps'],
    roleId: 'qa',
    mode: 'test',
    toolScope: 'all',
  },
  {
    id: 'security',
    name: 'Security Specialist',
    icon: '⬢',
    description: 'Audits changes for security and secrets.',
    responsibilities: ['Auth review', 'Injection review', 'Secret handling'],
    roleId: 'security',
    mode: 'security',
    toolScope: 'read-only',
  },
  {
    id: 'reviewer',
    name: 'Code Reviewer',
    icon: '✓',
    description: 'Reviews correctness and maintainability.',
    responsibilities: ['Find bugs', 'Check conventions', 'Verdict'],
    roleId: 'review',
    mode: 'review',
    toolScope: 'read-only',
  },
  {
    id: 'devops',
    name: 'DevOps Engineer',
    icon: '⇧',
    description: 'Handles builds, CI, containers and releases.',
    responsibilities: ['CI config', 'Build scripts', 'Deployment safety'],
    roleId: 'devops',
    mode: 'build',
    toolScope: 'all',
  },
  {
    id: 'docs',
    name: 'Documentation Writer',
    icon: '▤',
    description: 'Keeps docs accurate and runnable.',
    responsibilities: ['Update README', 'Guides', 'Examples'],
    roleId: 'docs',
    mode: 'docs',
    toolScope: 'all',
  },
];

const byId = new Map(AGENT_REGISTRY.map((agent) => [agent.id, agent]));
const byRole = new Map(
  AGENT_REGISTRY.filter((agent) => agent.roleId).map((agent) => [agent.roleId!, agent.id]),
);

export function getAgentDefinition(id: AgentId): AgentDefinition {
  const definition = byId.get(id);
  if (!definition) throw new Error(`Unknown agent: ${id}`);
  return definition;
}

export function resolveAgentId(roleId: TeamRoleId): AgentId {
  return byRole.get(roleId) ?? 'backend';
}

/** Derive statuses only from real runtime events and task contracts. */
export function deriveAgentStates(
  events: AgentEvent[],
  contracts: TaskContract[],
): Record<AgentId, AgentRuntimeState> {
  const states = Object.fromEntries(
    AGENT_REGISTRY.map((agent) => [agent.id, idleAgentState()]),
  ) as Record<AgentId, AgentRuntimeState>;
  for (const contract of contracts) {
    const state = states[contract.assignee];
    if (!state) continue;
    state.assignedTaskCount += 1;
    if (contract.status === 'completed') state.completedTaskCount += 1;
  }
  for (const event of events) {
    if (!event.agentId) continue;
    const state = states[event.agentId as AgentId];
    if (!state) continue;
    switch (event.type) {
      case 'agent.started':
        state.status = 'working';
        state.currentTaskId = String(event.payload.contractId ?? '') || null;
        break;
      case 'agent.progress':
        state.status = 'working';
        break;
      case 'agent.handoff':
        state.status = 'completed';
        break;
      case 'agent.completed':
        state.status = 'completed';
        state.completedTaskCount += 1;
        break;
      case 'agent.failed':
        state.status = 'failed';
        state.lastError = String(event.payload.reason ?? '').slice(0, 200);
        break;
      case 'agent.needs_input':
        state.status = 'needs_input';
        break;
      case 'agent.waiting':
        state.status = 'waiting';
        break;
      default:
        break;
    }
  }
  return states;
}

export function idleAgentState(): AgentRuntimeState {
  return {
    status: 'idle',
    currentTaskId: null,
    assignedTaskCount: 0,
    completedTaskCount: 0,
    model: null,
    provider: null,
    lastError: null,
  };
}
