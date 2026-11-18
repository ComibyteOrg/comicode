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
  | 'research'
  | 'product'
  | 'architecture'
  | 'design'
  | 'engineering'
  | 'security'
  | 'qa'
  | 'review'
  | 'docs'
  | 'marketing'
  | 'devops';

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
const PIPELINE_KEYWORDS: Array<{ id: keyof typeof TEAM_PIPELINES; words: string[] }> = [
  { id: 'security', words: ['security', 'vulnerab', 'audit', 'exploit', 'injection', 'secret leak', 'xss', 'csrf'] },
  { id: 'website', words: ['website', 'landing page', 'marketing site', 'web app', 'homepage', 'brand', 'website requires', 'image', 'logo', 'illustration'] },
  { id: 'marketing', words: ['marketing', 'campaign', 'copy', 'release notes', 'changelog', 'positioning', 'social'] },
  { id: 'design', words: ['design', 'ui', 'ux', 'css', 'layout', 'style', 'mockup', 'visual'] },
  { id: 'devops', words: ['deploy', 'docker', 'ci', 'pipeline', 'infra', 'devops', 'release script'] },
  { id: 'test', words: ['test', 'coverage', 'spec', 'e2e', 'flaky'] },
  { id: 'docs', words: ['document', 'readme', 'docs', 'guide', 'changelog'] },
  { id: 'explain', words: ['explain', 'what does', 'how does', 'walk me through', 'understand'] },
  { id: 'build', words: ['build', 'fix', 'implement', 'add', 'feature', 'refactor', 'bug', 'create'] },
];

/** Deterministic, token-free selection of the team for a request. */
export function selectTeamRoles(text: string, mode: AgentMode): TeamRole[] {
  const lower = ` ${text.toLowerCase()} `;
  let ids: TeamRoleId[];
  if (ORG_WORDS.some((word) => lower.includes(word))) {
    ids = TEAM_PIPELINES.fullOrganization!;
  } else {
    let best: keyof typeof TEAM_PIPELINES = 'build';
    let bestScore = 0;
    for (const entry of PIPELINE_KEYWORDS) {
      const score = entry.words.reduce((sum, word) => sum + (lower.includes(word) ? 1 : 0), 0);
      if (score > bestScore) {
        bestScore = score;
        best = entry.id;
      }
    }
    // Mode context also guides the team when the prompt itself is short.
    if (mode === 'security') best = 'security';
    else if (mode === 'test') best = 'test';
    else if (mode === 'design') best = 'design';
    else if (mode === 'docs') best = 'docs';
    else if (mode === 'explain') best = 'explain';
    else if (mode === 'architect') best = 'build';
    ids = TEAM_PIPELINES[best] ?? TEAM_PIPELINES.build!;
  }
  return ids.map((id) => TEAM_ROLES[id]);
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
  handoffs: string[],
): string {
  const parts = [
    `# Team assignment: ${role.label} — ${role.department}`,
    role.instructions,
    '',
    `## Original user request\n${originalRequest.slice(0, 12_000)}`,
  ];
  if (handoffs.length) {
    parts.push('', '## Handoffs from previous team members (read carefully)', handoffs.join('\n\n---\n\n'));
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
