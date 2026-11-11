/**
 * Agent modes control what the agent is allowed and encouraged to do.
 * Modeled on OpenCode's build/plan agent split, extended with a debug focus.
 */
export type AgentMode =
  | 'auto'
  | 'build'
  | 'plan'
  | 'debug'
  | 'architect'
  | 'review'
  | 'refactor'
  | 'test'
  | 'docs'
  | 'design'
  | 'security'
  | 'explain';

export interface AgentModeSpec {
  id: AgentMode;
  label: string;
  description: string;
  /** Tools the model may see and call in this mode. */
  tools: 'all' | 'read-only';
  /** Extra system-prompt guidance appended to the context. */
  promptAddendum: string;
}

export const AGENT_MODES: Record<AgentMode, AgentModeSpec> = {
  auto: {
    id: 'auto',
    label: 'auto',
    description:
      'Classifies the task and selects the best workflow automatically (default).',
    tools: 'all',
    promptAddendum: '',
  },
  build: {
    id: 'build',
    label: 'build',
    description: 'Full coding agent: inspect, edit, run commands, and verify.',
    tools: 'all',
    promptAddendum: '',
  },
  plan: {
    id: 'plan',
    label: 'plan',
    description: 'Read-only planning: inspect the project and produce a plan without changing files.',
    tools: 'read-only',
    promptAddendum: `# Agent mode: plan
You are in PLAN MODE. You must not modify the project.

- Use only read-only tools (list_files, read_file, search_files, git_status, git_diff, environment_info).
- Do not call write_file, edit_file, apply_patch, delete_file, run_command, run_tests, run_lint, run_build, or update_plan with implementation intent.
- Instead: inspect the relevant code, then call update_plan with concrete implementation steps, and finish with task_complete summarizing the plan and open questions.
- If the user asks you to implement anyway, explain that they must switch to build mode (tab or /mode build) first.`,
  },
  debug: {
    id: 'debug',
    label: 'debug',
    description:
      'Diagnosis-first agent: reproduce, isolate the root cause, fix it, and prove the fix.',
    tools: 'all',
    promptAddendum: `# Agent mode: debug
You are in DEBUG MODE. The user is trying to fix a defect.

- Reproduce or isolate the failure before changing anything. Read full error output and stack traces.
- Trace the code path with tools; check git_diff/git_status for recent changes when relevant.
- Prefer the smallest fix that addresses the root cause. Add a regression test when a test suite exists.
- Use the debug-systematically skill if it helps structure the investigation.
- Verify the fix actually resolves the reported symptom before calling task_complete.`,
  },
  architect: {
    id: 'architect',
    label: 'architect',
    description:
      'System design and planning: analyze structure, schema, dependencies, and risks before any changes.',
    tools: 'all',
    promptAddendum: `# Agent mode: architect
You are in ARCHITECT MODE. Think before touching code.

- First map the existing architecture: entry points, modules, data flow, dependencies, and conventions.
- Identify problems, risks, edge cases, and scalability/security concerns explicitly.
- Produce a concrete implementation plan via update_plan before writing code — data model, API surface, file changes, migration steps.
- Only implement after the plan is solid; keep changes consistent with existing architecture.
- Call out trade-offs and alternatives rather than silently picking one.`,
  },
  security: {
    id: 'security',
    label: 'security',
    description:
      'Security audit: auth, validation, secrets, injection, and unsafe operations — read-only.',
    tools: 'read-only',
    promptAddendum: `# Agent mode: security
You are in SECURITY MODE. Audit the code — do not modify files.

- Inspect authentication/authorization, input validation, secret handling, file operations, injection surfaces (SQL, command, XSS), and insecure configuration.
- Check dependencies and lockfiles for known-risk patterns where visible.
- Report findings ordered by severity with file:line evidence and concrete remediation.
- Never claim the project is "completely secure" — state coverage and limitations honestly.`,
  },
  explain: {
    id: 'explain',
    label: 'explain',
    description:
      'Read-only explainer: walk through code, architecture, errors, and concepts clearly.',
    tools: 'read-only',
    promptAddendum: `# Agent mode: explain
You are in EXPLAIN MODE. Teach, don't touch.

- Use only read-only tools to inspect the relevant code before answering.
- Explain at the right level: concrete file references, data flow, and why things work the way they do.
- For errors, connect the symptom to the root cause in the code.
- Never modify files; if the user wants changes, suggest switching to build mode.`,
  },
  review: {
    id: 'review',
    label: 'review',
    description: 'Read-only code review: find bugs, risks, and improvements without editing.',
    tools: 'read-only',
    promptAddendum: `# Agent mode: review
You are in REVIEW MODE. Analyze the code and report findings — do not modify anything.

- Use only read-only tools. Load the code-review skill for a structured checklist.
- Report concrete findings ordered by severity: file, line, problem, suggested fix.
- Cover correctness bugs, security issues, error handling, and unnecessary complexity.
- If nothing is wrong, say so plainly — do not invent findings.
- Finish with task_complete summarizing the verdict.`,
  },
  refactor: {
    id: 'refactor',
    label: 'refactor',
    description: 'Safe incremental restructuring: simplify and modernize without behavior changes.',
    tools: 'all',
    promptAddendum: `# Agent mode: refactor
You are in REFACTOR MODE. Improve structure while preserving behavior exactly.

- Load the safe-refactor skill before starting.
- Make small, verifiable steps. Run tests/build after each meaningful change.
- Never change external behavior, APIs, or output formats unless the user asked.
- Prefer deleting dead code and reducing duplication over adding abstractions.
- If a change cannot be verified, revert it and note why.`,
  },
  test: {
    id: 'test',
    label: 'test',
    description: 'Test-first agent: write failing tests, implement, and prove coverage.',
    tools: 'all',
    promptAddendum: `# Agent mode: test
You are in TEST MODE. Your job is to make the requested behavior provably correct.

- Load the test-driven-change skill before writing code.
- Write or update tests first where a test suite exists; run them to see them fail, then implement.
- Cover edge cases and error paths, not just the happy path.
- Run the project's test/lint/build commands to verify; report exact results.`,
  },
  docs: {
    id: 'docs',
    label: 'docs',
    description: 'Documentation agent: write and improve README, guides, and comments.',
    tools: 'all',
    promptAddendum: `# Agent mode: docs
You are in DOCS MODE. Your job is clear, accurate written documentation.

- Read the actual code before documenting it — never guess at behavior.
- Prefer updating existing docs over creating new files; match the project's doc style.
- Keep examples runnable and commands copy-pasteable.
- Do not change implementation code unless a doc fix requires a trivial correction the user asked for.`,
  },
  design: {
    id: 'design',
    label: 'design',
    description:
      'UI/design agent: improve layout, styling, and interaction — including web-app conversion.',
    tools: 'all',
    promptAddendum: `# Agent mode: design
You are in DESIGN MODE. Focus on visual quality, layout, and interaction.

- For web/UI work, load the design-system skill FIRST and follow its direction/token/rules process.
- Keep the existing stack and conventions; improve composition, spacing, typography, and states.
- Handle loading, empty, error, and responsive states — not just the happy path.
- Verify with build/lint; if a dev server or screenshot check is possible, use it.`,
  },
};

export const AGENT_MODE_IDS = Object.keys(AGENT_MODES) as AgentMode[];

export function isAgentMode(value: string): value is AgentMode {
  return value in AGENT_MODES;
}

export function nextAgentMode(current: AgentMode, direction: 1 | -1): AgentMode {
  const index = AGENT_MODE_IDS.indexOf(current);
  const next = (index + direction + AGENT_MODE_IDS.length) % AGENT_MODE_IDS.length;
  return AGENT_MODE_IDS[next]!;
}

const MODE_KEYWORDS: Array<{ mode: AgentMode; words: string[] }> = [
  {
    mode: 'security',
    words: [
      'security', 'vulnerab', 'exploit', 'injection', 'xss', 'csrf', 'auth', 'secret',
      'permission', 'sanitize', 'encrypt',
    ],
  },
  {
    mode: 'review',
    words: ['review', 'audit code', 'code review', 'inspect code', 'check code'],
  },
  {
    mode: 'debug',
    words: [
      'bug', 'error', 'crash', 'fail', 'broken', 'fix', 'debug', 'exception', 'stack',
      'regression', 'not working', 'issue',
    ],
  },
  {
    mode: 'refactor',
    words: ['refactor', 'clean up', 'simplify', 'restructure', 'dedupe', 'modernize'],
  },
  {
    mode: 'test',
    words: ['test', 'coverage', 'unit test', 'e2e', 'spec'],
  },
  {
    mode: 'docs',
    words: ['document', 'readme', 'docs', 'changelog', 'comment', 'explain in docs'],
  },
  {
    mode: 'design',
    words: [
      'design', 'ui', 'ux', 'css', 'style', 'layout', 'page', 'landing', 'component',
      'convert', 'website', 'mockup', 'frontend look',
    ],
  },
  {
    mode: 'architect',
    words: [
      'architect', 'system design', 'database schema', 'scalab', 'structure',
      'migration plan', 'high-level design',
    ],
  },
  {
    mode: 'explain',
    words: ['explain', 'what does', 'how does', 'walk me through', 'understand'],
  },
];

/**
 * Deterministic task classifier for auto mode. Scores keyword hits and picks
 * the best-matching workflow; defaults to build for implementation requests.
 */
export function classifyAgentMode(text: string): AgentMode {
  const lower = text.toLowerCase();
  let best: AgentMode = 'build';
  let bestScore = 0;
  for (const { mode, words } of MODE_KEYWORDS) {
    const score = words.reduce((sum, word) => sum + (lower.includes(word) ? 1 : 0), 0);
    if (score > bestScore) {
      bestScore = score;
      best = mode;
    }
  }
  return best;
}

/** Tool names available in plan (read-only) mode. */
export const PLAN_MODE_TOOLS = new Set([
  'list_files',
  'read_file',
  'search_files',
  'git_status',
  'git_diff',
  'environment_info',
  'use_skill',
  'update_plan',
  'task_complete',
]);
