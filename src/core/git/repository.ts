/**
 * Git integration used by the TUI and the agent.
 *
 * Design rules:
 * - Git is optional. Every function degrades to a structured "not a
 *   repository" result instead of throwing at the UI.
 * - Undo is snapshot based and refuses files that changed after ComiCode
 *   finished. Unrelated user changes are never reverted.
 * - Commands are executed with argument arrays (no shell interpolation).
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, unlinkSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { TaskRecord } from '../types.js';

export interface GitResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  code: number | null;
}

export type GitChangeStatus =
  'modified' | 'added' | 'deleted' | 'renamed' | 'copied' | 'untracked' | 'conflicted' | 'unknown';

export interface GitFileChange {
  path: string;
  originalPath?: string;
  status: GitChangeStatus;
  code: string;
  staged: boolean;
}

export interface GitSummary {
  repository: boolean;
  branch: string | null;
  detached: boolean;
  files: GitFileChange[];
  clean: boolean;
  ahead: number;
  behind: number;
  error?: string;
}

export interface GitBaseline {
  head: string | null;
  snapshot: string | null;
  snapshotRef: string | null;
  untracked: string[];
  at: string;
}

export interface GitFinalState {
  hashes: Record<string, string | null>;
  changedFiles: string[];
  at: string;
}

export type UndoAction = 'restore' | 'delete';

export interface UndoPlanItem {
  path: string;
  action: UndoAction;
  source: string | null;
  reason: string;
}

export interface UndoPlan {
  supported: boolean;
  reason: string | null;
  items: UndoPlanItem[];
  skipped: Array<{ path: string; reason: string }>;
  restoreCount: number;
  deleteCount: number;
}

export interface UndoResult {
  ok: boolean;
  restored: string[];
  deleted: string[];
  failed: Array<{ path: string; message: string }>;
}

export function runGit(
  root: string,
  args: string[],
  options: { timeoutMs?: number; maxBuffer?: number } = {},
): Promise<GitResult> {
  return new Promise((resolveResult) => {
    execFile(
      'git',
      args,
      {
        cwd: root,
        windowsHide: true,
        timeout: options.timeoutMs ?? 15_000,
        maxBuffer: options.maxBuffer ?? 8 * 1024 * 1024,
        encoding: 'utf8',
      },
      (error, stdout, stderr) => {
        const code =
          error && typeof (error as NodeJS.ErrnoException & { code?: unknown }).code === 'number'
            ? ((error as NodeJS.ErrnoException & { code?: number }).code ?? null)
            : error
              ? null
              : 0;
        resolveResult({
          ok: !error,
          stdout: String(stdout ?? ''),
          stderr: String(stderr ?? ''),
          code,
        });
      },
    );
  });
}

function classifyCode(code: string): GitChangeStatus {
  if (code === '??' || code === '? ') return 'untracked';
  if (code.includes('U') || code === 'AA' || code === 'DD') return 'conflicted';
  const worktree = code[1] ?? ' ';
  const index = code[0] ?? ' ';
  const chosen = worktree !== ' ' && worktree !== '?' ? worktree : index;
  switch (chosen) {
    case 'A':
      return 'added';
    case 'D':
      return 'deleted';
    case 'R':
      return 'renamed';
    case 'C':
      return 'copied';
    case 'M':
    case 'T':
      return 'modified';
    default:
      return 'unknown';
  }
}

export async function isGitRepository(root: string): Promise<boolean> {
  const result = await runGit(root, ['rev-parse', '--is-inside-work-tree']);
  return result.ok && result.stdout.trim() === 'true';
}

export async function gitSummary(root: string): Promise<GitSummary> {
  const inside = await isGitRepository(root);
  if (!inside) {
    return {
      repository: false,
      branch: null,
      detached: false,
      files: [],
      clean: true,
      ahead: 0,
      behind: 0,
    };
  }

  const branchResult = await runGit(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
  let branch = branchResult.ok ? branchResult.stdout.trim() : null;
  let detached = false;
  if (branch === 'HEAD') {
    detached = true;
    const sha = await runGit(root, ['rev-parse', '--short', 'HEAD']);
    branch = sha.ok ? `detached@${sha.stdout.trim()}` : 'detached';
  }
  if (!branch) branch = 'unborn';

  const statusResult = await runGit(root, [
    'status',
    '--porcelain=v1',
    '-z',
    '--untracked-files=all',
  ]);
  const files: GitFileChange[] = [];
  if (statusResult.ok) {
    const records = statusResult.stdout.split('\0');
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index];
      if (!record || record.length < 3) continue;
      const code = record.slice(0, 2);
      const path = record.slice(3);
      let originalPath: string | undefined;
      if (code[0] === 'R' || code[0] === 'C') {
        const next = records[index + 1];
        if (next) {
          originalPath = next;
          index += 1;
        }
      }
      files.push({
        path,
        ...(originalPath ? { originalPath } : {}),
        status: classifyCode(code),
        code,
        staged: code[0] !== ' ' && code[0] !== '?',
      });
    }
  }

  let ahead = 0;
  let behind = 0;
  const upstream = await runGit(root, [
    'rev-list',
    '--left-right',
    '--count',
    'HEAD...@{upstream}',
  ]);
  if (upstream.ok) {
    const [left, right] = upstream.stdout.trim().split(/\s+/);
    ahead = Number(left ?? 0) || 0;
    behind = Number(right ?? 0) || 0;
  }

  return {
    repository: true,
    branch,
    detached,
    files,
    clean: files.length === 0,
    ahead,
    behind,
    ...(statusResult.ok ? {} : { error: statusResult.stderr.trim() || 'git status failed' }),
  };
}

export async function gitBranch(root: string): Promise<string | null> {
  const summary = await gitSummary(root);
  return summary.repository ? summary.branch : null;
}

async function pathExistsInRevision(
  root: string,
  revision: string,
  path: string,
): Promise<boolean> {
  const result = await runGit(root, ['cat-file', '-e', `${revision}:${path}`]);
  return result.ok;
}

function safeRelative(root: string, path: string): string | null {
  if (!path || isAbsolute(path)) return null;
  const absolute = resolve(root, path);
  const rel = relative(root, absolute);
  if (!rel || rel.startsWith('..') || isAbsolute(rel) || rel.split(sep).includes('.git'))
    return null;
  return rel;
}

export function hashFile(root: string, path: string): string | null {
  const safe = safeRelative(root, path);
  if (!safe) return null;
  try {
    return createHash('sha256')
      .update(readFileSync(join(root, safe)))
      .digest('hex');
  } catch {
    return null;
  }
}

export function hashFiles(root: string, files: string[]): Record<string, string | null> {
  const hashes: Record<string, string | null> = {};
  for (const path of files) {
    const safe = safeRelative(root, path);
    if (safe) hashes[safe] = hashFile(root, safe);
  }
  return hashes;
}

export async function captureGitBaseline(
  root: string,
  taskId: string,
): Promise<GitBaseline | null> {
  if (!(await isGitRepository(root))) return null;
  const headResult = await runGit(root, ['rev-parse', 'HEAD']);
  const head = headResult.ok ? headResult.stdout.trim() || null : null;

  // `git stash create` snapshots the working tree without touching the index,
  // the working tree, or the stash list.
  const snapshotResult = await runGit(root, ['stash', 'create', `comicode-baseline-${taskId}`]);
  const snapshot = snapshotResult.ok ? snapshotResult.stdout.trim() || null : null;

  let snapshotRef: string | null = null;
  if (snapshot) {
    const ref = `refs/comicode/baseline/${taskId.replace(/[^A-Za-z0-9._-]/g, '-')}`;
    const update = await runGit(root, ['update-ref', ref, snapshot]);
    if (update.ok) snapshotRef = ref;
  }

  const status = await gitSummary(root);
  const untracked = status.files
    .filter((file) => file.status === 'untracked' || file.code === '??')
    .map((file) => file.path);

  return {
    head,
    snapshot,
    snapshotRef,
    untracked,
    at: new Date().toISOString(),
  };
}

export function recordGitFinalMetadata(
  root: string,
  task: TaskRecord,
): Record<string, unknown> | null {
  const baseline = task.metadata.gitBaseline as GitBaseline | undefined;
  if (!baseline) return null;
  const changedFiles = [...new Set(task.changedFiles)].filter((path) => safeRelative(root, path));
  const final: GitFinalState = {
    hashes: hashFiles(root, changedFiles),
    changedFiles,
    at: new Date().toISOString(),
  };
  return {
    ...task.metadata,
    gitBaseline: baseline,
    gitFinal: final,
  };
}

function untrackedDiff(root: string, path: string): string {
  const safe = safeRelative(root, path);
  if (!safe) return '';
  try {
    const buffer = readFileSync(join(root, safe));
    if (buffer.length > 240_000)
      return `--- /dev/null\n+++ b/${safe}\n[binary or large file omitted]\n`;
    const text = buffer.toString('utf8');
    if (text.includes('\u0000')) {
      return `--- /dev/null\n+++ b/${safe}\n[binary file omitted]\n`;
    }
    const lines = text.split(/\r?\n/);
    return [
      '--- /dev/null',
      `+++ b/${safe}`,
      `@@ untracked file (${lines.length} lines) @@`,
      ...lines.map((line) => `+${line}`),
    ].join('\n');
  } catch {
    return '';
  }
}

export async function gitDiffForFiles(
  root: string,
  files: string[],
  options: { maxChars?: number } = {},
): Promise<string> {
  const summary = await gitSummary(root);
  if (!summary.repository) return '';
  const paths = files.length ? files.filter((path) => safeRelative(root, path)) : [];
  const trackedArgs = ['diff', '--no-color', '--no-ext-diff', 'HEAD'];
  if (paths.length) trackedArgs.push('--', ...paths);
  const tracked = await runGit(root, trackedArgs);
  const pieces: string[] = [];
  if (tracked.ok && tracked.stdout.trim()) pieces.push(tracked.stdout.trimEnd());

  // Include staged changes when the repository has no commits yet.
  if (!tracked.ok) {
    const unstaged = await runGit(root, [
      'diff',
      '--no-color',
      '--no-ext-diff',
      ...(paths.length ? ['--', ...paths] : []),
    ]);
    const staged = await runGit(root, [
      'diff',
      '--no-color',
      '--no-ext-diff',
      '--cached',
      ...(paths.length ? ['--', ...paths] : []),
    ]);
    if (unstaged.ok && unstaged.stdout.trim()) pieces.push(unstaged.stdout.trimEnd());
    if (staged.ok && staged.stdout.trim()) pieces.push(staged.stdout.trimEnd());
  }

  const wanted = new Set(paths.length ? paths : summary.files.map((file) => file.path));
  for (const file of summary.files) {
    if (!wanted.has(file.path)) continue;
    if (file.status !== 'untracked' && file.code !== '??') continue;
    const diff = untrackedDiff(root, file.path);
    if (diff) pieces.push(diff);
  }

  const combined = pieces.join('\n\n');
  const maxChars = options.maxChars ?? 80_000;
  return combined.length > maxChars
    ? `${combined.slice(0, maxChars)}\n\n… diff truncated (${combined.length - maxChars} characters omitted)`
    : combined;
}

export async function planUndo(root: string, task: TaskRecord): Promise<UndoPlan> {
  const baseline = task.metadata.gitBaseline as GitBaseline | undefined;
  const final = task.metadata.gitFinal as GitFinalState | undefined;
  if (!baseline) {
    return {
      supported: false,
      reason:
        'This task has no git baseline snapshot. Undo would risk touching unrelated files, so it is unavailable.',
      items: [],
      skipped: [],
      restoreCount: 0,
      deleteCount: 0,
    };
  }
  if (!(await isGitRepository(root))) {
    return {
      supported: false,
      reason: 'The project is not a git repository. Safe undo requires git.',
      items: [],
      skipped: [],
      restoreCount: 0,
      deleteCount: 0,
    };
  }

  const summary = await gitSummary(root);
  if (!summary.repository) {
    return {
      supported: false,
      reason: 'Git is unavailable in this project.',
      items: [],
      skipped: [],
      restoreCount: 0,
      deleteCount: 0,
    };
  }

  const changed = [...new Set([...(final?.changedFiles ?? []), ...task.changedFiles])];
  const items: UndoPlanItem[] = [];
  const skipped: Array<{ path: string; reason: string }> = [];
  const untrackedBefore = new Set(baseline.untracked);

  for (const rawPath of changed) {
    const path = safeRelative(root, rawPath);
    if (!path) {
      skipped.push({ path: rawPath, reason: 'Path is outside the project or protected.' });
      continue;
    }
    const expected = final?.hashes[path];
    if (expected === undefined) {
      skipped.push({ path, reason: 'No post-task content hash was recorded.' });
      continue;
    }
    const current = hashFile(root, path);
    if (current !== expected) {
      skipped.push({
        path,
        reason: 'The file changed after ComiCode finished. It may contain your own work.',
      });
      continue;
    }
    if (untrackedBefore.has(path)) {
      skipped.push({
        path,
        reason: 'The file was untracked before this task; restoring it could discard your work.',
      });
      continue;
    }

    let action: UndoAction = 'delete';
    let source: string | null = null;
    if (baseline.snapshotRef && (await pathExistsInRevision(root, baseline.snapshotRef, path))) {
      action = 'restore';
      source = baseline.snapshotRef;
    } else if (baseline.head && (await pathExistsInRevision(root, baseline.head, path))) {
      action = 'restore';
      source = baseline.head;
    }

    items.push({
      path,
      action,
      source,
      reason:
        action === 'restore'
          ? `Restore from ${source === baseline.head ? 'the task baseline commit' : 'the task baseline snapshot'}.`
          : 'Delete a file created by this task.',
    });
  }

  return {
    supported: items.length > 0,
    reason:
      items.length > 0
        ? null
        : 'No files can be safely restored. Every changed file was modified after the task, was untracked before it, or has no recorded hash.',
    items,
    skipped,
    restoreCount: items.filter((item) => item.action === 'restore').length,
    deleteCount: items.filter((item) => item.action === 'delete').length,
  };
}

export async function performUndo(root: string, plan: UndoPlan): Promise<UndoResult> {
  const restored: string[] = [];
  const deleted: string[] = [];
  const failed: Array<{ path: string; message: string }> = [];

  for (const item of plan.items) {
    if (item.action === 'restore' && item.source) {
      const result = await runGit(root, [
        'restore',
        `--source=${item.source}`,
        '--worktree',
        '--',
        item.path,
      ]);
      if (result.ok) restored.push(item.path);
      else failed.push({ path: item.path, message: result.stderr.trim() || 'git restore failed' });
      continue;
    }
    try {
      const absolute = join(root, item.path);
      unlinkSync(absolute);
      deleted.push(item.path);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') deleted.push(item.path);
      else
        failed.push({
          path: item.path,
          message: error instanceof Error ? error.message : String(error),
        });
    }
  }

  return { ok: failed.length === 0, restored, deleted, failed };
}

export function formatGitStatus(change: GitFileChange): string {
  switch (change.status) {
    case 'added':
      return 'A';
    case 'deleted':
      return 'D';
    case 'renamed':
      return 'R';
    case 'copied':
      return 'C';
    case 'untracked':
      return '?';
    case 'conflicted':
      return 'U';
    default:
      return 'M';
  }
}
