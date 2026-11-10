import { spawn } from 'node:child_process';

export interface ProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  spawnError: string | null;
}

export interface ProcessOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  maxOutputBytes?: number;
  stdin?: string;
  signal?: AbortSignal;
}

/**
 * Run a process without a shell, with bounded output and a hard timeout.
 * Used for OS credential helpers, git, and other trusted system tools.
 */
export function runProcess(
  command: string,
  args: string[],
  options: ProcessOptions = {},
): Promise<ProcessResult> {
  const { cwd, env, timeoutMs = 15_000, maxOutputBytes = 256_000, stdin, signal } = options;

  return new Promise((resolve) => {
    let settled = false;
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let spawnError: string | null = null;

    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut, spawnError });
    };

    let child;
    try {
      child = spawn(command, args, {
        cwd,
        env: env ?? process.env,
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      spawnError = error instanceof Error ? error.message : String(error);
      resolve({ code: null, stdout: '', stderr: '', timedOut: false, spawnError });
      return;
    }

    const timer = setTimeout(
      () => {
        timedOut = true;
        child.kill('SIGTERM');
        setTimeout(() => {
          if (!settled) child.kill('SIGKILL');
        }, 1500).unref();
      },
      Math.max(100, timeoutMs),
    );

    const abort = () => {
      timedOut = true;
      child.kill('SIGTERM');
    };
    signal?.addEventListener('abort', abort, { once: true });

    child.stdout?.on('data', (chunk: Buffer) => {
      if (stdout.length < maxOutputBytes) stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < maxOutputBytes) stderr += chunk.toString('utf8');
    });
    child.on('error', (error) => {
      spawnError = error.message;
      finish(null);
    });
    child.on('close', (code) => {
      signal?.removeEventListener('abort', abort);
      finish(code);
    });

    if (stdin !== undefined && child.stdin) {
      child.stdin.end(stdin);
    } else if (child.stdin) {
      child.stdin.end();
    }
  });
}
