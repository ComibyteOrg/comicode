import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { runProcess } from '../safety/process.js';
import { listProjectFiles } from '../safety/files.js';
import { relativePath } from '../safety/files.js';

const LANGUAGE_MAP: Record<string, string> = {
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript',
  '.js': 'JavaScript',
  '.jsx': 'JavaScript',
  '.mjs': 'JavaScript',
  '.cjs': 'JavaScript',
  '.py': 'Python',
  '.rs': 'Rust',
  '.go': 'Go',
  '.java': 'Java',
  '.kt': 'Kotlin',
  '.cs': 'C#',
  '.cpp': 'C++',
  '.cc': 'C++',
  '.c': 'C',
  '.h': 'C/C++ headers',
  '.rb': 'Ruby',
  '.php': 'PHP',
  '.swift': 'Swift',
  '.dart': 'Dart',
  '.vue': 'Vue',
  '.svelte': 'Svelte',
  '.sh': 'Shell',
  '.ps1': 'PowerShell',
  '.md': 'Markdown',
  '.sql': 'SQL',
};

export interface ProjectSnapshot {
  name: string;
  root: string;
  files: number;
  topLevel: Array<{ name: string; type: 'file' | 'directory'; files: number }>;
  languages: Array<{ name: string; files: number }>;
  keyFiles: Array<{ path: string; excerpt: string }>;
  git: {
    isRepo: boolean;
    branch: string | null;
    status: string | null;
    lastCommit: string | null;
  };
  summaryText: string;
}

export interface DetectedCommands {
  packageManager: 'npm' | 'pnpm' | 'yarn' | 'bun' | null;
  test: string | null;
  lint: string | null;
  build: string | null;
  dev: string | null;
}

function readText(path: string, maxBytes = 40_000): string | null {
  try {
    if (!existsSync(path)) return null;
    if (statSync(path).size > maxBytes) {
      return readFileSync(path, 'utf8').slice(0, maxBytes) + '\n... [truncated]';
    }
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

export class ProjectInspector {
  constructor(readonly root: string) {}

  projectName(): string {
    const pkg = readText(join(this.root, 'package.json'), 100_000);
    if (pkg) {
      try {
        const parsed = JSON.parse(pkg) as { name?: unknown };
        if (typeof parsed.name === 'string' && parsed.name.trim()) return parsed.name.trim();
      } catch {
        // Invalid package.json; fall back to directory name.
      }
    }
    return basename(this.root);
  }

  async gitInfo(): Promise<ProjectSnapshot['git']> {
    const status = await runProcess('git', ['status', '--porcelain=v1', '-b'], {
      cwd: this.root,
      timeoutMs: 10_000,
      maxOutputBytes: 100_000,
    });
    if (status.spawnError || status.code !== 0) {
      return { isRepo: false, branch: null, status: null, lastCommit: null };
    }
    const lines = status.stdout.split(/\r?\n/).filter(Boolean);
    const branchLine = lines[0]?.startsWith('##') ? lines[0].slice(2) : null;
    const branch = branchLine ? (branchLine.split('...')[0]?.trim() ?? null) : null;
    const changed = lines
      .filter((line) => !line.startsWith('##'))
      .slice(0, 80)
      .join('\n');
    const log = await runProcess('git', ['log', '-1', '--pretty=%h %s'], {
      cwd: this.root,
      timeoutMs: 8000,
      maxOutputBytes: 5000,
    });
    return {
      isRepo: true,
      branch,
      status: changed || null,
      lastCommit: log.code === 0 ? log.stdout.trim() || null : null,
    };
  }

  async snapshot(): Promise<ProjectSnapshot> {
    const files = await listProjectFiles(this.root, 4000);
    const languages = new Map<string, number>();
    const topLevel = new Map<string, { type: 'file' | 'directory'; files: number }>();
    for (const file of files) {
      const language = LANGUAGE_MAP[extname(file.path).toLowerCase()];
      if (language) languages.set(language, (languages.get(language) ?? 0) + 1);
      const [head] = file.path.split('/');
      if (!head) continue;
      const isDir = file.path.includes('/');
      const entry = topLevel.get(head) ?? { type: isDir ? 'directory' : 'file', files: 0 };
      entry.files += 1;
      entry.type = isDir ? 'directory' : entry.type;
      topLevel.set(head, entry);
    }

    const keyFileCandidates = [
      'package.json',
      'pyproject.toml',
      'Cargo.toml',
      'go.mod',
      'README.md',
      'README',
      'tsconfig.json',
      'Makefile',
      'requirements.txt',
      'composer.json',
      'Gemfile',
      '.comicode/project.json',
    ];
    const keyFiles: Array<{ path: string; excerpt: string }> = [];
    for (const candidate of keyFileCandidates) {
      const text = readText(join(this.root, candidate), 12_000);
      if (text) {
        keyFiles.push({ path: candidate, excerpt: text.slice(0, 6000) });
        if (keyFiles.length >= 5) break;
      }
    }

    const git = await this.gitInfo();
    const languageList = [...languages.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, files: count }));
    const topLevelList = [...topLevel.entries()]
      .sort((a, b) => b[1].files - a[1].files)
      .slice(0, 24)
      .map(([name, entry]) => ({ name, type: entry.type, files: entry.files }));

    const summaryText = this.formatSummary({
      name: this.projectName(),
      root: this.root,
      files: files.length,
      topLevel: topLevelList,
      languages: languageList,
      keyFiles,
      git,
      summaryText: '',
    });

    return {
      name: this.projectName(),
      root: this.root,
      files: files.length,
      topLevel: topLevelList,
      languages: languageList,
      keyFiles,
      git,
      summaryText,
    };
  }

  private formatSummary(snapshot: ProjectSnapshot): string {
    const lines: string[] = [
      `Project: ${snapshot.name}`,
      `Root: ${snapshot.root}`,
      `Files (ignored files excluded): ${snapshot.files}`,
      `Languages: ${snapshot.languages.map((entry) => `${entry.name} (${entry.files})`).join(', ') || 'unknown'}`,
      `Top level: ${snapshot.topLevel.map((entry) => `${entry.name}${entry.type === 'directory' ? '/' : ''} [${entry.files}]`).join(', ')}`,
      `Git: ${snapshot.git.isRepo ? `${snapshot.git.branch ?? 'detached'}${snapshot.git.lastCommit ? `, last commit ${snapshot.git.lastCommit}` : ''}` : 'not a git repository'}`,
    ];
    if (snapshot.git.status) {
      lines.push(
        `Working tree changes:\n${snapshot.git.status.split('\n').slice(0, 30).join('\n')}`,
      );
    }
    for (const file of snapshot.keyFiles) {
      lines.push(`\n--- ${file.path} ---\n${file.excerpt}`);
    }
    return lines.join('\n');
  }

  async relevantFiles(
    request: string,
    options: { changedFiles?: string[]; extraFiles?: string[]; limit?: number } = {},
  ): Promise<Array<{ path: string; reason: string }>> {
    const limit = options.limit ?? 18;
    const files = await listProjectFiles(this.root, 4000);
    const tokens = request
      .toLowerCase()
      .split(/[^a-z0-9_./-]+/)
      .filter((token) => token.length >= 3 && !STOP_WORDS.has(token))
      .slice(0, 40);
    const scored: Array<{ path: string; score: number; reason: string }> = [];
    const changed = new Set((options.changedFiles ?? []).map((path) => path.replace(/\\/g, '/')));
    const extra = new Set((options.extraFiles ?? []).map((path) => path.replace(/\\/g, '/')));

    for (const file of files) {
      const lower = file.path.toLowerCase();
      let score = 0;
      const reasons: string[] = [];
      if (changed.has(file.path)) {
        score += 100;
        reasons.push('changed in this task');
      }
      if (extra.has(file.path)) {
        score += 80;
        reasons.push('previously relevant');
      }
      for (const token of tokens) {
        if (lower.includes(token)) {
          score += token.length >= 6 ? 8 : 4;
          reasons.push(`matches "${token}"`);
        } else {
          const base = lower.split('/').pop() ?? '';
          if (base.includes(token)) score += 6;
        }
      }
      if (
        /^(package\.json|tsconfig\.json|pyproject\.toml|Cargo\.toml|go\.mod|README\.md)$/i.test(
          file.path,
        )
      ) {
        score += 12;
        reasons.push('project manifest');
      }
      if (/(^|\/)(src|lib|app)\//.test(file.path)) score += 2;
      if (score > 0) {
        scored.push({
          path: file.path,
          score,
          reason: reasons.slice(0, 3).join('; ') || 'relevant',
        });
      }
    }
    scored.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
    const selected = scored.slice(0, limit).map(({ path, reason }) => ({ path, reason }));
    if (selected.length < 6) {
      for (const file of files) {
        if (selected.length >= 6) break;
        if (selected.some((entry) => entry.path === file.path)) continue;
        if (/\.(ts|tsx|js|jsx|py|rs|go|java|rb|php|cs|cpp|c|vue|svelte)$/i.test(file.path)) {
          selected.push({ path: file.path, reason: 'source file fallback' });
        }
      }
    }
    return selected;
  }

  async resumeState(changedFiles: string[]): Promise<string> {
    const git = await this.gitInfo();
    const lines: string[] = [];
    lines.push(`Git: ${git.isRepo ? (git.branch ?? 'detached') : 'not a repository'}`);
    if (git.status) lines.push(`Working tree:\n${git.status}`);
    const hashes: string[] = [];
    for (const path of changedFiles.slice(0, 20)) {
      try {
        const absolute = join(this.root, path);
        const content = readFileSync(absolute);
        hashes.push(`${path}: ${createHash('sha256').update(content).digest('hex').slice(0, 12)}`);
      } catch {
        hashes.push(`${path}: <missing>`);
      }
    }
    if (hashes.length) lines.push(`Changed file fingerprints:\n${hashes.join('\n')}`);
    return lines.join('\n');
  }

  detectCommands(): DetectedCommands {
    const pkgText = readText(join(this.root, 'package.json'), 200_000);
    const packageManager = existsSync(join(this.root, 'pnpm-lock.yaml'))
      ? 'pnpm'
      : existsSync(join(this.root, 'yarn.lock'))
        ? 'yarn'
        : existsSync(join(this.root, 'bun.lockb')) || existsSync(join(this.root, 'bun.lock'))
          ? 'bun'
          : 'npm';
    const run = (script: string) => {
      if (packageManager === 'yarn') return `yarn ${script}`;
      if (packageManager === 'pnpm') return `pnpm ${script}`;
      if (packageManager === 'bun') return `bun run ${script}`;
      return `npm run ${script}`;
    };
    if (pkgText) {
      try {
        const pkg = JSON.parse(pkgText) as { scripts?: Record<string, string> };
        const scripts = pkg.scripts ?? {};
        const pick = (...names: string[]) => names.find((name) => scripts[name]);
        const test = pick('test', 'test:unit', 'vitest');
        const lint = pick('lint', 'typecheck', 'check');
        const build = pick('build', 'compile');
        const dev = pick('dev', 'start');
        return {
          packageManager,
          test: test ? run(test) : packageManager === 'npm' ? 'npm test' : run('test'),
          lint: lint ? run(lint) : null,
          build: build ? run(build) : null,
          dev: dev ? run(dev) : null,
        };
      } catch {
        // Fall through to ecosystem detection.
      }
    }
    if (existsSync(join(this.root, 'Cargo.toml'))) {
      return {
        packageManager: null,
        test: 'cargo test',
        lint: 'cargo clippy',
        build: 'cargo build',
        dev: 'cargo run',
      };
    }
    if (existsSync(join(this.root, 'go.mod'))) {
      return {
        packageManager: null,
        test: 'go test ./...',
        lint: 'go vet ./...',
        build: 'go build ./...',
        dev: null,
      };
    }
    if (
      existsSync(join(this.root, 'pyproject.toml')) ||
      existsSync(join(this.root, 'requirements.txt'))
    ) {
      return {
        packageManager: null,
        test: 'pytest',
        lint: existsSync(join(this.root, 'pyproject.toml')) ? 'python -m ruff check .' : null,
        build: null,
        dev: null,
      };
    }
    return { packageManager: null, test: null, lint: null, build: null, dev: null };
  }

  fileHash(relative: string): string | null {
    try {
      return createHash('sha256')
        .update(readFileSync(join(this.root, relative)))
        .digest('hex');
    } catch {
      return null;
    }
  }

  relative(absolute: string): string {
    return relativePath(this.root, absolute);
  }
}

const STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'this',
  'that',
  'from',
  'have',
  'into',
  'your',
  'please',
  'make',
  'can',
  'you',
  'should',
  'would',
  'could',
  'fix',
  'add',
  'update',
  'change',
  'create',
  'build',
  'implement',
  'refactor',
  'task',
  'code',
  'file',
  'files',
  'project',
]);
