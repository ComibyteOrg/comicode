/**
 * "ComiCode Company" — a virtual software organization.
 *
 * A team run is a sequence of focused agent stages. Each stage is a normal
 * `CodingAgent` run in its own mode, so it inherits every existing capability:
 * multi-key/multi-provider failover, quota handoff, tools, plans/todos,
 * compaction and token-effort profiles. This module only defines WHO works,
 * in WHAT ORDER, and WHAT each member is told — it never re-implements the
 * agent loop.
 */

import type { AgentMode } from './modes.js';
import type { TaskType } from '../types.js';

export type TeamRoleId =
  | 'plan'
  | 'research'
  | 'product'
  | 'architecture'
  | 'design'
  | 'frontend'
  | 'engineering'
  | 'backend'
  | 'devops'
  | 'security'
  | 'qa'
  | 'review'
  | 'docs'
  | 'marketing'
  | 'debug';

export interface TeamPlan {
  roles: TeamRoleId[];
  source: 'rules' | 'planner';
  revisitLimit: number;
}

export interface TeamRunState {
  roles: TeamRoleId[];
  cursor: number;
  revisits: Record<string, number>;
  stepsUsed: number;
  tokensUsed: number;
  /** Budgets are persisted so a resume grants a fresh allowance. */
  stepBudget?: number;
  tokenBudget?: number;
}

export interface TeamRole {
  id: TeamRoleId;
  label: string;
  department: string;
  icon: string;
  /** Existing agent mode used for this stage. */
  mode: AgentMode;
  /** Drives capability-aware model selection across ALL connected APIs. */
  taskType: TaskType;
  /** Human-readable reason this model class is preferred for this role. */
  capabilityHint: string;
  /** Let the router pick the most capable available model for this stage. */
  autoModel: boolean;
  instructions: string;
}

export const TEAM_ROLES: Record<TeamRoleId, TeamRole> = {
  plan: {
    id: 'plan',
    label: 'Plan',
    department: 'Product & Planning',
    icon: '▤',
    mode: 'plan',
    taskType: 'reasoning',
    capabilityHint: 'planning model with read-only tools',
    autoModel: true,
    instructions: `You are the PLANNING AGENT. Break the request into an ordered, testable plan.
- Inspect what exists with read-only tools; define scope, acceptance criteria and non-goals.
- Call update_plan with concrete steps the delivery agents will follow. Do not implement.
- End with: STAGE_STATUS: <what is planned and where the next agent should start>.`,
  },
  frontend: {
    id: 'frontend',
    label: 'Frontend',
    department: 'Engineering / Frontend',
    icon: '◈',
    mode: 'design',
    taskType: 'vision',
    capabilityHint: 'vision-capable model for UI, layout and assets',
    autoModel: true,
    instructions: `You are the FRONTEND AGENT. Own the user-facing side of the product.
- Implement UI, layout, states and accessibility from the handed-off plan.
- If an image/illustration/logo is needed, call generate_image and reference the saved path.
- Verify with the project's build/lint where possible.
- End with: STAGE_STATUS: <what you built, files changed, and what backend/security must do>.`,
  },
  backend: {
    id: 'backend',
    label: 'Backend',
    department: 'Engineering / Backend',
    icon: '⬡',
    mode: 'build',
    taskType: 'coding',
    capabilityHint: 'strong coding model for services, data and APIs',
    autoModel: true,
    instructions: `You are the BACKEND AGENT. Own server logic, data models, APIs and integrations.
- Implement against the handed-off plan and the frontend's stated needs.
- Keep interfaces explicit; add or update tests for behaviour you add.
- Verify with the project's test/build commands.
- End with: STAGE_STATUS: <what you built, files changed, and what remains>.`,
  },
  debug: {
    id: 'debug',
    label: 'Debug',
    department: 'Engineering / Diagnostics',
    icon: '⌁',
    mode: 'debug',
    taskType: 'reasoning',
    capabilityHint: 'diagnosis-first model with full tool use',
    autoModel: true,
    instructions: `You are the DEBUG AGENT. Find and fix the reported failure.
- Reproduce or isolate the failure from real output before changing anything.
- Trace the code path, identify the root cause, apply the smallest fix, add a regression test.
- Prove the fix with the project's test/lint/build commands.
- End with: STAGE_STATUS: <root cause, fix, verification result, and any remaining risk>.`,
  },
  research: {
    id: 'research',
    label: 'Research',
    department: 'Research & Discovery',
    icon: '🔎',
    mode: 'explain',
    taskType: 'reasoning',
    capabilityHint: 'strong reasoning + read-only codebase exploration',
    autoModel: true,
    instructions: `You are the RESEARCH LEAD of the engineering organization.
- Investigate the request against the ACTUAL codebase using read-only tools. Do not change files.
- Identify the real constraints, existing patterns, edge cases, risks and open questions.
- Produce a short research brief: what exists, what is missing, what must be decided, and the recommended approach.
- End your response with a single line: STAGE_STATUS: <one sentence on exactly where you stopped and what the next team must do>.`,
  },
  product: {
    id: 'product',
    label: 'Product',
    department: 'Product & Strategy',
    icon: '🧭',
    mode: 'plan',
    taskType: 'reasoning',
    capabilityHint: 'planning and requirement decomposition',
    autoModel: true,
    instructions: `You are the PRODUCT MANAGER of the organization.
- Turn the request into clear, testable requirements and acceptance criteria.
- Define scope, non-goals, priorities and the smallest shippable increment.
- Use update_plan to record the concrete stepped plan. Do not implement.
- End with: STAGE_STATUS: <where you stopped and the next team's mandate>.`,
  },
  architecture: {
    id: 'architecture',
    label: 'Architecture',
    department: 'Engineering / Architecture',
    icon: '🏗',
    mode: 'architect',
    taskType: 'reasoning',
    capabilityHint: 'system design and high-context reasoning',
    autoModel: true,
    instructions: `You are the PRINCIPAL ARCHITECT.
- Map the current structure, data flow and dependencies from the code itself.
- Decide the design: modules, data model, API surface, migration and rollout steps. Name trade-offs.
- Use update_plan for the implementation steps other teams will follow. Do not write code yet.
- End with: STAGE_STATUS: <decisions made, what remains, and what implementation must do first>.`,
  },
  design: {
    id: 'design',
    label: 'Design',
    department: 'Design / UX',
    icon: '🎨',
    mode: 'design',
    taskType: 'vision',
    capabilityHint: 'vision-capable, design-literate model',
    autoModel: true,
    instructions: `You are the DESIGN LEAD.
- For UI work, follow the project's design-system guidance and define tokens, layout, states and accessibility requirements.
- If the request needs an image, logo, illustration or visual asset, CALL the generate_image tool (a capable image model will be selected from the connected APIs). Save assets under the project and reference their paths.
- Do not change application logic outside styling/markup.
- End with: STAGE_STATUS: <design decisions, generated asset paths, and what implementation must do>.`,
  },
  engineering: {
    id: 'engineering',
    label: 'Engineering',
    department: 'Engineering / Delivery',
    icon: '⚙️',
    mode: 'build',
    taskType: 'coding',
    capabilityHint: 'top coding model with full tool use',
    autoModel: true,
    instructions: `You are the SENIOR ENGINEER responsible for implementation.
- Implement the plan handed to you. Make small, verifiable changes that match existing conventions.
- Keep the plan/todos updated with update_plan as you work.
- Run the project's checks before calling task_complete and fix what you introduced.
- End with: STAGE_STATUS: <files changed, checks run, and any known limitation for the next team>.`,
  },
  devops: {
    id: 'devops',
    label: 'DevOps',
    department: 'Platform / Reliability',
    icon: '🚀',
    mode: 'build',
    taskType: 'coding',
    capabilityHint: 'coding model comfortable with scripts, CI and config',
    autoModel: true,
    instructions: `You are the DEVOPS / RELIABILITY ENGINEER.
- Review and improve build, scripts, CI config, container and deployment concerns relevant to the change.
- Prefer minimal, safe configuration edits. Never print or write secrets.
- Verify with the available commands where possible.
- End with: STAGE_STATUS: <config changed, verification result, remaining operational risk>.`,
  },
  security: {
    id: 'security',
    label: 'Security',
    department: 'Security & Compliance',
    icon: '🛡',
    mode: 'security',
    taskType: 'review',
    capabilityHint: 'security-audit capable reviewer',
    autoModel: true,
    instructions: `You are the SECURITY ENGINEER. Read-only audit — do not edit files.
- Review the change for authn/authz, injection, secret leakage, validation, unsafe file/command use and dependency risk.
- Report findings by severity with file:line evidence and a concrete fix.
- If you find no issues, say so plainly and state what you covered.
- End with: STAGE_STATUS: <findings summary and what must be fixed before release>.`,
  },
  qa: {
    id: 'qa',
    label: 'QA',
    department: 'Quality Assurance',
    icon: '🧪',
    mode: 'test',
    taskType: 'coding',
    capabilityHint: 'test-writing and verification model',
    autoModel: true,
    instructions: `You are the QA ENGINEER.
- Add or update tests for the delivered behavior, including edge and error paths.
- Run the test/lint/build commands and report exact results.
- If a test fails because of a product bug, fix the smallest cause or hand it back clearly.
- End with: STAGE_STATUS: <tests added, commands run, pass/fail and any remaining gap>.`,
  },
  review: {
    id: 'review',
    label: 'Review',
    department: 'Engineering / Best Practice',
    icon: '✅',
    mode: 'review',
    taskType: 'review',
    capabilityHint: 'rigorous code reviewer',
    autoModel: true,
    instructions: `You are the BEST-PRACTICE REVIEWER. Read-only — do not edit files.
- Review the full change for correctness, maintainability, error handling, duplication and convention drift.
- Give a verdict: APPROVE or ISSUES, with concrete file:line findings.
- End with: STAGE_STATUS: <verdict and the single most important follow-up>.`,
  },
  docs: {
    id: 'docs',
    label: 'Docs',
    department: 'Documentation',
    icon: '📚',
    mode: 'docs',
    taskType: 'general',
    capabilityHint: 'precise technical writer',
    autoModel: true,
    instructions: `You are the TECHNICAL WRITER.
- Update README/docs and comments to match what was actually built. Read the code first.
- Prefer editing existing docs; keep examples runnable. Do not change implementation code.
- End with: STAGE_STATUS: <docs updated and anything still undocumented>.`,
  },
  marketing: {
    id: 'marketing',
    label: 'Marketing',
    department: 'Marketing & Growth',
    icon: '📣',
    mode: 'docs',
    taskType: 'general',
    capabilityHint: 'clear persuasive copywriter',
    autoModel: true,
    instructions: `You are the MARKETING LEAD.
- Produce user-facing copy: positioning, landing-page messaging, release notes, changelog entries and social snippets as appropriate to the request.
- Ground every claim in what the product actually does. Do not invent features.
- If a visual asset is needed, use the generate_image tool and reference the saved path.
- Write copy into the appropriate project files only when the user asked for site/docs content.
- End with: STAGE_STATUS: <copy produced, files touched, and what remains>.`,
  },
};

/** Ordered pipelines chosen from the user's intent. */
export const TEAM_PIPELINES: Record<string, TeamRoleId[]> = {
  fullOrganization: [
    'research', 'product', 'architecture', 'design', 'engineering', 'devops',
    'security', 'qa', 'review', 'docs', 'marketing',
  ],
  build: ['research', 'architecture', 'engineering', 'security', 'qa', 'review', 'docs'],
  website: ['research', 'product', 'design', 'engineering', 'qa', 'security', 'marketing'],
  security: ['research', 'security', 'review'],
  test: ['research', 'qa', 'review'],
  design: ['research', 'design', 'engineering', 'qa'],
  docs: ['research', 'docs', 'marketing'],
  explain: ['research', 'review'],
  marketing: ['research', 'product', 'marketing', 'design'],
  devops: ['research', 'devops', 'security', 'qa'],
};

const ORG_WORDS = [
  'full team', 'whole team', 'full organization', 'whole organization', 'entire organization',
  'full company', 'whole company', 'all teams', 'marketing team', 'full software team',
  'everything', 'end to end', 'end-to-end', 'complete product', 'whole product',
];
const DEBUG_WORDS = ['debug', 'crash', 'exception', 'stack trace', 'not working', 'broken', 'error'];
const ECOMMERCE_WORDS = [
  'ecommerce', 'e-commerce', 'online shop', 'storefront', 'checkout', 'shopping cart',
  'product catalog', 'online store',
];

/**
 * Deterministic, token-free selection of the team for a request. The LLM
 * planner is only used for vague/org-wide requests and is executed by the
 * agent, not here.
 */
export function resolveTeamPlan(text: string, mode: AgentMode): TeamPlan {
  const lower = ` ${text.toLowerCase()} `;
  const has = (words: string[]): boolean => words.some((word) => lower.includes(word));

  if (mode === 'debug' || has(DEBUG_WORDS)) {
    return { roles: ['debug'], source: 'rules', revisitLimit: 2 };
  }
  if (has(ECOMMERCE_WORDS)) {
    return {
      roles: ['plan', 'frontend', 'backend', 'security', 'review'],
      source: 'rules',
      revisitLimit: 2,
    };
  }
  if (ORG_WORDS.some((word) => lower.includes(word))) {
    return { roles: [...TEAM_PIPELINES.fullOrganization!], source: 'rules', revisitLimit: 2 };
  }
  if (has(['security', 'vulnerab', 'exploit', 'injection', 'xss', 'csrf']) || mode === 'security') {
    return { roles: ['research', 'security', 'review'], source: 'rules', revisitLimit: 2 };
  }
  if (has(['test', 'coverage', 'e2e', 'flaky']) || mode === 'test') {
    return { roles: ['research', 'qa', 'review'], source: 'rules', revisitLimit: 2 };
  }
  if (has(['document', 'readme', 'docs', 'guide']) || mode === 'docs') {
    return { roles: ['research', 'docs', 'marketing'], source: 'rules', revisitLimit: 2 };
  }
  if (has(['explain', 'what does', 'how does', 'walk me through']) || mode === 'explain') {
    return { roles: ['research', 'review'], source: 'rules', revisitLimit: 2 };
  }
  if (has(['deploy', 'docker', 'ci/cd', 'pipeline', 'infra', 'devops'])) {
    return { roles: ['research', 'devops', 'security', 'qa'], source: 'rules', revisitLimit: 2 };
  }
  if (has(['marketing', 'campaign', 'landing page', 'brand'])) {
    return { roles: ['plan', 'design', 'frontend', 'marketing'], source: 'rules', revisitLimit: 2 };
  }
  if (has(['design', 'ui', 'ux', 'layout', 'mockup']) || mode === 'design') {
    return { roles: ['research', 'design', 'engineering', 'qa'], source: 'rules', revisitLimit: 2 };
  }
  if (has(['build', 'implement', 'add ', 'feature', 'refactor', 'create'])) {
    return { roles: [...TEAM_PIPELINES.build!], source: 'rules', revisitLimit: 2 };
  }
  // Vague or org-wide: let the agent run a cheap planner pass.
  return {
    roles: ['research', 'architecture', 'engineering', 'security', 'review'],
    source: 'planner',
    revisitLimit: 2,
  };
}

/** Compatibility wrapper used by tests and older call sites. */
export function selectTeamRoles(text: string, mode: AgentMode): TeamRole[] {
  return resolveTeamPlan(text, mode).roles.map((id) => TEAM_ROLES[id]!);
}

/** Parse the handoff directives a stage is asked to emit. */
export function parseStageDirective(text: string): {
  status: string | null;
  revisit: TeamRoleId | null;
} {
  const status = /\bSTAGE_STATUS:\s*(.+)/i.exec(text)?.[1]?.trim().slice(0, 300) ?? null;
  const revisitRaw = /\bNEEDS_REVISIT:\s*([a-z-]+)/i.exec(text)?.[1]?.toLowerCase();
  const revisit =
    revisitRaw && revisitRaw in TEAM_ROLES ? (revisitRaw as TeamRoleId) : null;
  return { status, revisit };
}

/** The compact "where the former AI stopped" note handed to the next member. */
export function buildHandoffNote(
  role: TeamRole,
  summary: string,
  changedFiles: string[],
): string {
  const parts = [
    `[ComiCode team handoff → ${role.department} / ${role.label}]`,
    `Previous stage status:\n${clip(summary, 2_000)}`,
    'The full transcript, plan, checkpoints and tool history are preserved in this task. ' +
      'Read the current project state before acting. Do NOT redo work already completed.',
  ];
  if (changedFiles.length) {
    parts.push(`Files already changed by earlier stages: ${changedFiles.slice(0, 40).join(', ')}`);
  }
  return parts.join('\n\n').slice(0, 3_500);
}

/** The user message that assigns a stage to a team member. */
export function buildStagePrompt(
  role: TeamRole,
  originalRequest: string,
  latestHandoff: string | null,
): string {
  const parts = [
    `# Team assignment: ${role.label} — ${role.department}`,
    role.instructions,
    '',
    `## Original user request\n${originalRequest.slice(0, 12_000)}`,
  ];
  if (latestHandoff) {
    parts.push('', '## Handoff from the previous team member (read carefully)', latestHandoff);
  }
  parts.push(
    '',
    `You are stage ${role.label}. Stay in your role. Finish this stage with the STAGE_STATUS line.`,
  );
  return parts.join('\n').slice(0, 40_000);
}

function clip(text: string, max: number): string {
  const value = text.trim();
  return value.length <= max ? value : `${value.slice(0, max)}\n… [truncated]`;
}
