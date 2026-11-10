import { spawn } from 'node:child_process';

export interface CommandSafety {
  dangerous: boolean;
  reasons: string[];
  blocked: boolean;
}

const CRITICAL_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /\brm\s+-[a-zA-Z]*r[a-zA-Z]*f?[a-zA-Z]*\s+(\/|~|\$HOME|\.\.?)(\s|$)/i,
    reason: 'Recursive deletion of /, home, or the current directory',
  },
  {
    pattern: /\brm\s+-[a-zA-Z]*f[a-zA-Z]*r?[a-zA-Z]*\s+(\/|~|\$HOME)(\s|$)/i,
    reason: 'Forced recursive deletion of / or home',
  },
  { pattern: /\b(del|erase)\s+.*\/[fsq]/i, reason: 'Windows forced recursive deletion' },
  { pattern: /\bformat\s+[a-z]:/i, reason: 'Disk format command' },
  { pattern: /\bmkfs(\.[a-z0-9]+)?\b/i, reason: 'Filesystem creation command' },
  { pattern: /\bdd\s+.*of=\/dev\//i, reason: 'Raw disk write' },
  { pattern: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, reason: 'Fork bomb' },
  { pattern: /\bshutdown\b|\breboot\b|\bhalt\b|\bpoweroff\b/i, reason: 'System power command' },
  { pattern: /\bchmod\s+-R\s+777\s+\//i, reason: 'World-writable permissions on root' },
  {
    pattern: /\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(ba)?sh\b/i,
    reason: 'Piping a remote script directly into a shell',
  },
  { pattern: /\bInvoke-Expression\b|\biex\s*\(/i, reason: 'PowerShell dynamic code execution' },
  {
    pattern: /powershell(\.exe)?\s+.*-e(nc|ncodedcommand)\b/i,
    reason: 'Encoded PowerShell command',
  },
  { pattern: /\bcipher\s+\/w\b/i, reason: 'Disk wiping command' },
  {
    pattern: /\bgit\s+clean\s+-[a-z]*x[a-z]*f|\bgit\s+clean\s+-[a-z]*f[a-z]*x/i,
    reason: 'Deleting all untracked files including ignored files',
  },
];

const HIGH_RISK_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /\bsudo\b|\brunas\b|\bStart-Process\b.*-Verb\s+RunAs/i,
    reason: 'Privilege escalation',
  },
  { pattern: /\bgit\s+push\b.*--force|\bgit\s+push\b.*-f\b/i, reason: 'Force-pushing git history' },
  { pattern: /\bgit\s+reset\s+--hard\b/i, reason: 'Discarding uncommitted work' },
  { pattern: /\bgit\s+checkout\s+--\s+\./i, reason: 'Discarding working tree changes' },
  {
    pattern: /\bnpm\s+publish\b|\byarn\s+publish\b|\bpnpm\s+publish\b/i,
    reason: 'Publishing a package',
  },
  { pattern: /\bdocker\s+(system\s+prune|volume\s+prune)\b/i, reason: 'Deleting Docker data' },
  { pattern: /\bkubectl\s+delete\b|\bhelm\s+uninstall\b/i, reason: 'Deleting cluster resources' },
  { pattern: /\bterraform\s+(destroy|apply)\b/i, reason: 'Infrastructure mutation' },
  {
    pattern: /\bprisma\s+migrate\s+reset\b|\bdrop\s+database\b|\btruncate\s+table\b/i,
    reason: 'Destructive database operation',
  },
  { pattern: />\s*(\/|~|[a-zA-Z]:[\\/])/, reason: 'Redirecting output to an absolute path' },
];

/** Detect commands that deserve an explicit, alarming confirmation. */
export function inspectCommand(command: string): CommandSafety {
  const reasons: string[] = [];
  let blocked = false;
  for (const entry of CRITICAL_PATTERNS) {
    if (entry.pattern.test(command)) {
      reasons.push(entry.reason);
      blocked = true;
    }
  }
  for (const entry of HIGH_RISK_PATTERNS) {
    if (entry.pattern.test(command)) reasons.push(entry.reason);
  }
  return { dangerous: reasons.length > 0, reasons, blocked };
}

const SECRET_ENV_PATTERN =
  /^(COMICODE_|.*_API_KEY$|.*_TOKEN$|.*_SECRET$|.*_PASSWORD$|.*_CREDENTIALS$|OPENAI_API_KEY|ANTHROPIC_API_KEY|GEMINI_API_KEY|GOOGLE_API_KEY|GROQ_API_KEY|OPENROUTER_API_KEY|AWS_SECRET_ACCESS_KEY|AWS_SESSION_TOKEN|GITHUB_TOKEN|GH_TOKEN|NPM_TOKEN)$/i;

export function sanitizedEnvironment(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (SECRET_ENV_PATTERN.test(key)) continue;
    env[key] = value;
  }
  for (const [key, value] of Object.entries(extra)) {
    if (SECRET_ENV_PATTERN.test(key)) continue;
    env[key] = value;
  }
  return env;
}

export interface ShellOptions {
  cwd: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  signal?: AbortSignal;
  env?: NodeJS.ProcessEnv;
}

export interface ShellResult {
  command: string;
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
  truncated: boolean;
}

function truncate(text: string, maxBytes: number): { text: string; truncated: boolean } {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return { text, truncated: false };
  const keepStart = Math.floor(maxBytes * 0.6);
  const keepEnd = Math.floor(maxBytes * 0.35);
  return {
    text:
      text.slice(0, keepStart) +
      `\n... [output truncated: ${text.length} characters total] ...\n` +
      text.slice(-keepEnd),
    truncated: true,
  };
}

/**
 * Execute a shell command in the project directory with a timeout, bounded
 * output, and secret-bearing environment variables removed.
 */
export function runShell(command: string, options: ShellOptions): Promise<ShellResult> {
  const timeoutMs = Math.min(Math.max(options.timeoutMs ?? 120_000, 1000), 600_000);
  const maxOutputBytes = Math.min(Math.max(options.maxOutputBytes ?? 60_000, 2000), 500_000);
  const started = Date.now();

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    const isWindows = process.platform === 'win32';
    const shellCommand = isWindows ? process.env.ComSpec || 'cmd.exe' : '/bin/sh';
    const shellArgs = isWindows ? ['/d', '/s', '/c', command] : ['-c', command];

    const child = spawn(shellCommand, shellArgs, {
      cwd: options.cwd,
      env: sanitizedEnvironment(options.env),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const out = truncate(stdout, maxOutputBytes);
      const err = truncate(stderr, Math.floor(maxOutputBytes * 0.5));
      resolve({
        command,
        code,
        stdout: out.text,
        stderr: err.text,
        timedOut,
        durationMs: Date.now() - started,
        truncated: out.truncated || err.truncated,
      });
    };

    const killTree = () => {
      timedOut = true;
      if (isWindows && child.pid) {
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore',
        });
      }
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!settled) child.kill('SIGKILL');
      }, 2000).unref();
    };

    const timer = setTimeout(killTree, timeoutMs);
    const abort = () => killTree();
    options.signal?.addEventListener('abort', abort, { once: true });

    child.stdout?.on('data', (chunk: Buffer) => {
      if (stdout.length < maxOutputBytes * 2) stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < maxOutputBytes) stderr += chunk.toString('utf8');
    });
    child.on('error', (error) => {
      stderr += `\n${error.message}`;
      finish(null);
    });
    child.on('close', (code) => {
      options.signal?.removeEventListener('abort', abort);
      finish(code);
    });
  });
}

export function summarizeShellResult(result: ShellResult): string {
  const parts: string[] = [];
  parts.push(`Exit code: ${result.code === null ? 'unknown' : result.code}`);
  parts.push(`Duration: ${(result.durationMs / 1000).toFixed(1)}s`);
  if (result.timedOut) parts.push('Timed out: yes');
  if (result.truncated) parts.push('Output truncated: yes');
  if (result.stdout.trim()) parts.push(`stdout:\n${result.stdout.trim()}`);
  if (result.stderr.trim()) parts.push(`stderr:\n${result.stderr.trim()}`);
  return parts.join('\n');
}
