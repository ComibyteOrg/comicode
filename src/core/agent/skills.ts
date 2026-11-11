import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { getComicodeHome } from '../paths.js';

/**
 * Agent skills: reusable instruction packs the model can pull in on demand.
 *
 * Skills are Markdown files with optional frontmatter:
 *
 *   ---
 *   name: debug-systematically
 *   description: Reproduce, isolate, fix, and prove a bug fix.
 *   ---
 *   # Debugging
 *   ...instructions the agent follows when it calls `use_skill`...
 *
 * Discovery order (later sources override earlier ones by name):
 *   1. Built-in skills shipped with ComiCode.
 *   2. User skills in `<comicode-home>/skills/`.
 *   3. Project skills in `<project>/.comicode/skills/` and `.agents/skills/`.
 */
export interface AgentSkill {
  name: string;
  description: string;
  content: string;
  source: 'builtin' | 'user' | 'project';
  path: string | null;
}

interface BuiltinSkill {
  name: string;
  description: string;
  content: string;
}

const BUILTIN_SKILLS: BuiltinSkill[] = [
  {
    name: 'test-driven-change',
    description: 'Write a failing test first, implement the smallest fix, then verify it passes.',
    content: `# Test-driven change

1. Find the existing test setup (package scripts, test directories, frameworks) before writing anything.
2. Write or extend a test that reproduces the bug or specifies the new behavior. Run it and confirm it fails for the right reason.
3. Implement the smallest change that makes the test pass. Do not refactor unrelated code.
4. Run the focused test again, then the broader suite if it is fast enough.
5. Report exactly which tests were added or changed and their result.`,
  },
  {
    name: 'debug-systematically',
    description:
      'Diagnose bugs by reproducing, isolating the cause, fixing it, and adding a regression check.',
    content: `# Systematic debugging

1. Reproduce the failure reliably. If you cannot reproduce it, say so and gather evidence instead of guessing.
2. Read the error output and stack trace completely before forming a hypothesis.
3. Trace the code path with read_file/search_files. Check recent changes with git_diff/git_status when available.
4. Form one hypothesis at a time and verify it with a tool call or a focused experiment.
5. Fix the root cause, not the symptom. Avoid defensive patches that hide the real bug.
6. Add or update a regression test when the project has a test suite.
7. Summarize: root cause, fix applied, and how it was verified.`,
  },
  {
    name: 'safe-refactor',
    description:
      'Restructure code without changing behavior, in small verified steps.',
    content: `# Safe refactoring

1. Establish a safety net first: run the existing tests or a build so you know the starting state is green.
2. Make one mechanical change at a time (rename, extract, move). Prefer edit_file over write_file.
3. After each step, run the fastest relevant check (typecheck, focused test, lint) before continuing.
4. Never mix refactoring with behavior changes in the same edit.
5. If a step breaks something, revert that step immediately rather than layering fixes on top.
6. Finish with the full verification suite and a summary of what moved where.`,
  },
  {
    name: 'code-review',
    description:
      'Review a diff or change set for correctness, security, and maintainability before finishing.',
    content: `# Code review

Review the change as if someone else wrote it:

1. Correctness: edge cases, off-by-one errors, null/undefined handling, async mistakes.
2. Security: injection, path traversal, secret leakage, unsafe shell usage, missing validation.
3. Scope: unrelated changes, leftover debug code, commented-out blocks, dead code.
4. Consistency: does it follow the surrounding conventions, naming, and error-handling style?
5. Verification: are tests updated? Does anything claim to work without evidence?

Report findings ordered by severity with file references. Fix what is clearly wrong; flag judgment calls for the user.`,
  },
  {
    name: 'design-system',
    description:
      'Produce exceptional UI: pick one coherent visual direction, define tokens, hierarchy, and quality rules before coding.',
    content: `# Design intelligence

Never generate a generic AI dashboard. Before writing UI code, establish a design system.

## 1. Choose ONE visual direction

Pick the single direction that fits the product — never blend styles randomly:

- premium-saas: confident, minimal chrome, one strong accent, data-dense but calm
- minimalist: extreme restraint, whitespace as structure, near-monochrome
- editorial: serif display type, strong grid, generous margins, print-inspired
- luxury: dark or ivory palette, thin type, subtle texture, no bright accents
- fintech-modern: trust signals, tabular numbers, crisp borders, muted palette
- enterprise: dense, utilitarian, accessible, predictable patterns
- ecommerce: product-first imagery, clear CTAs, card grids done well
- dashboard: real data hierarchy, compact controls, no decoration
- brutalist: raw borders, monospace accents, deliberate roughness
- creative-portfolio: expressive type, asymmetric layouts, motion-aware
- mobile-app: thumb-first, native-feeling, platform conventions

State the chosen direction and why in one line before implementing.

## 2. Define tokens before components

- Color: 1 accent + neutral scale (bg/surface/text/muted/danger). No random hues, no rainbow gradients.
- Type: one display + one body face (system stack is fine). Establish the scale: display > h1 > body > caption.
- Spacing: a consistent scale (4/8/12/16/24/32/48). Every gap comes from the scale.
- Radius/shadow: one radius family, shadows only for elevation that means something.

## 3. Layout intelligence

- Establish hierarchy first: what does the eye hit first, second, third?
- Use whitespace intentionally — never empty space for its own sake.
- Responsive: define what collapses, stacks, or hides at small widths.
- Component architecture: reuse existing components; extract only when a pattern repeats 3+ times.

## 4. Quality rules — avoid

- Generic SaaS card grids, excessive gradients, random colors, inconsistent spacing
- Unnecessary rounded cards everywhere, repetitive components, poor typography
- Over-decoration, dead empty space, inconsistent button styles

## 5. Required states

Every interactive surface needs loading, empty, error, and disabled states — not just happy path.

## 6. Verification honesty

If you can build/lint, run it. Only claim visual verification if you actually captured and inspected a screenshot or rendered output — otherwise say "not visually verified".`,
  },
];

function parseSkillFile(path: string, source: AgentSkill['source']): AgentSkill | null {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return null;
  }
  const name = basename(path.replace(/\.md$/i, '')) === 'SKILL'
    ? basename(join(path, '..'))
    : basename(path).replace(/\.md$/i, '');

  let description = '';
  let content = raw;
  const frontmatter = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (frontmatter) {
    content = raw.slice(frontmatter[0].length);
    for (const line of frontmatter[1]!.split(/\r?\n/)) {
      const match = line.match(/^(\w[\w-]*)\s*:\s*(.+)$/);
      if (!match) continue;
      if (match[1] === 'name') continue; // name comes from the directory/file
      if (match[1] === 'description') description = match[2]!.trim();
    }
  }
  if (!description) {
    const heading = content.match(/^#\s+(.+)$/m);
    const firstLine = content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith('#') && !line.startsWith('---'));
    description = (heading?.[1] ?? firstLine ?? name).slice(0, 200);
  }
  return { name, description, content: content.trim(), source, path };
}

function scanSkillDir(dir: string, source: AgentSkill['source'], out: AgentSkill[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      const skillFile = join(full, 'SKILL.md');
      if (existsSync(skillFile)) {
        const skill = parseSkillFile(skillFile, source);
        if (skill) out.push(skill);
      }
      continue;
    }
    if (entry.toLowerCase() === 'skill.md' || entry.toLowerCase().endsWith('.md')) {
      const skill = parseSkillFile(full, source);
      if (skill) out.push(skill);
    }
  }
}

export function loadSkills(root: string): AgentSkill[] {
  const byName = new Map<string, AgentSkill>();
  for (const builtin of BUILTIN_SKILLS) {
    byName.set(builtin.name, {
      ...builtin,
      source: 'builtin',
      path: null,
      content: builtin.content,
    });
  }
  const userSkills: AgentSkill[] = [];
  scanSkillDir(join(getComicodeHome(), 'skills'), 'user', userSkills);
  for (const skill of userSkills) byName.set(skill.name, skill);
  const projectSkills: AgentSkill[] = [];
  scanSkillDir(join(root, '.comicode', 'skills'), 'project', projectSkills);
  scanSkillDir(join(root, '.agents', 'skills'), 'project', projectSkills);
  for (const skill of projectSkills) byName.set(skill.name, skill);
  return [...byName.values()];
}

export function findSkill(skills: AgentSkill[], name: string): AgentSkill | null {
  const needle = name.trim().toLowerCase();
  if (!needle) return null;
  return (
    skills.find((skill) => skill.name.toLowerCase() === needle) ??
    skills.find((skill) => skill.name.toLowerCase().startsWith(needle)) ??
    skills.find((skill) => skill.name.toLowerCase().includes(needle)) ??
    null
  );
}

export function formatSkillsSection(skills: AgentSkill[]): string {
  if (skills.length === 0) return '';
  const lines = [
    '# Skills',
    'Skills are reusable instruction packs. When a skill matches the task, call the `use_skill` tool with its name to load the full instructions, then follow them.',
    '',
  ];
  for (const skill of skills) {
    lines.push(`- ${skill.name}: ${skill.description}`);
  }
  return lines.join('\n');
}
