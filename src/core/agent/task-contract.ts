/** Structured task contracts used by the Team Lead and the task board. */
import type { TeamRoleId } from './teams.js';
import type { AgentId } from './registry.js';
import { resolveAgentId } from './registry.js';
import { redactSecrets } from '../security/redact.js';

export type ContractStatus =
  | 'backlog'
  | 'ready'
  | 'in_progress'
  | 'blocked'
  | 'in_review'
  | 'completed'
  | 'failed';

export interface TaskContract {
  id: string;
  objective: string;
  assignee: AgentId;
  status: ContractStatus;
  dependencies: string[];
  priority: 'low' | 'normal' | 'high';
  relevantFiles: string[];
  expectedOutput: string;
  restrictions: string[];
  completionCriteria: string[];
  actualResult: string | null;
  error: string | null;
}

function sanitize(text: string): string {
  return redactSecrets(
    text.replace(/\b(?:sk|ghp|gho|glpat|AIza)[A-Za-z0-9_-]{8,}/gi, '[redacted]'),
  );
}

export function createStageContracts(roles: TeamRoleId[], request: string): TaskContract[] {
  const safeRequest = sanitize(request).slice(0, 4_000);
  let previous: string | null = null;
  return roles.map((roleId, index) => {
    const id = `contract-${index}-${roleId}`;
    const contract: TaskContract = {
      id,
      objective: `${safeRequest} — ${roleId} stage`,
      assignee: resolveAgentId(roleId),
      status: 'ready',
      dependencies: previous ? [previous] : [],
      priority: 'normal',
      relevantFiles: [],
      expectedOutput: `A completed ${roleId} stage report with changed files and verification.`,
      restrictions: ['Do not modify files outside the agreed task scope.'],
      completionCriteria: ['Stage returned completed', 'Verification checks passed'],
      actualResult: null,
      error: null,
    };
    previous = id;
    return contract;
  });
}

export function closeContract(
  contract: TaskContract,
  result: string,
  ok: boolean,
): TaskContract {
  const safeResult = sanitize(result).slice(0, 4_000);
  return {
    ...contract,
    status: ok ? 'completed' : 'failed',
    actualResult: ok ? safeResult : null,
    error: ok ? null : safeResult,
  };
}
