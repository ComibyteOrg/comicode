import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import ignore, { type Ignore } from 'ignore';
import { runProcess } from './process.js';

const DEFAULT_IGNORES = [
  'node_modules/',
  '.git/',
  '.comicode/',
  'dist/',
  'build/',
  'coverage/',
  '.next/',
  '.nuxt/',
  '.turbo/',
  '.cache/',
  '__pycache__/',
  '.venv/',
  'venv/',
  'target/',
  'vendor/',
  '*.min.js',
  '*.map',
  '*.lock',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  '*.log',
];

export interface FileEntry {
  path: string;
  size: number;
}

/** Load .gitignore + .comicodeignore rules for the project root. */
export function loadIgnoreMatcher(root: string): Ignore {
  const matcher = ignore().add(DEFAULT_IGNORES);
  for (const file of ['.gitignore', '.comicodeignore']) {
    try {
      const text = readFileSync(join(root, file), 'utf8');
      matcher.add(
        text.split(/\r?\n/).filter((line) => line.trim() && !line.trim().startsWith('#')),
      );
    } catch {
      // No ignore file.
    }
  }
  if (process.env.COMICODE_RESPECT_NESTED_GITIGNORE !== '0') {
    // Nested ignore files are honored by `git ls-files` below when available.
  }
  return matcher;
}

async function gitFiles(root: string, limit: number): Promise<FileEntry[] | null> {
  const result = await runProcess(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: root, timeoutMs: 15_000, maxOutputBytes: 8_000_000 },
  );
  if (result.spawnError || result.code !== 0) return null;
  const names = result.stdout.split('\0').filter(Boolean);
  const entries: FileEntry[] = [];
  for (const name of names) {
    if (entries.length >= limit) break;
    const path = name.replace(/\\/g, '/');
    try {
      const stats = statSync(join(root, name));
      if (!stats.isFile()) continue;
      entries.push({ path, size: stats.size });
    } catch {
      // File disappeared or is not accessible.
    }
  }
  return entries;
}

function walkFiles(root: string, limit: number): FileEntry[] {
  const matcher = loadIgnoreMatcher(root);
  const entries: FileEntry[] = [];
  const queue: string[] = [''];
  while (queue.length && entries.length < limit) {
    const relDir = queue.shift()!;
    let children;
    try {
      children = readdirSync(join(root, relDir), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const child of children) {
      const rel = (relDir ? `${relDir}/${child.name}` : child.name).split(sep).join('/');
      if (matcher.ignores(rel + (child.isDirectory() ? '/' : ''))) continue;
      if (child.isDirectory()) {
        queue.push(rel);
      } else if (child.isFile()) {
        try {
          const stats = statSync(join(root, rel));
          entries.push({ path: rel, size: stats.size });
        } catch {
          // Unreadable file.
        }
        if (entries.length >= limit) break;
      }
    }
  }
  return entries;
}

/**
 * List project files honoring git's ignore rules when the directory is a git
 * repository, with a dependency-free fallback walker.
 */
export async function listProjectFiles(root: string, limit = 3000): Promise<FileEntry[]> {
  const git = await gitFiles(root, limit);
  return git ?? walkFiles(root, limit);
}

export function isBinaryBuffer(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, 8000);
  return sample.includes(0);
}

export function relativePath(root: string, absolute: string): string {
  return relative(root, absolute).split(sep).join('/');
}
