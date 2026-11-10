import { appendFileSync, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';
import { getLogPath } from './paths.js';
import { redactSecrets } from './security/redact.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function configuredLevel(): LogLevel {
  const raw = (process.env.COMICODE_LOG_LEVEL || 'info').toLowerCase();
  return raw in LEVELS ? (raw as LogLevel) : 'info';
}

function rotateIfNeeded(path: string, maxBytes = 2 * 1024 * 1024): void {
  try {
    if (existsSync(path) && statSync(path).size > maxBytes) {
      const archived = `${path}.1`;
      if (existsSync(archived)) unlinkSync(archived);
      renameSync(path, archived);
    }
  } catch {
    // Logging must never take the application down.
  }
}

function write(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
  if (LEVELS[level] < LEVELS[configuredLevel()]) return;
  try {
    const path = getLogPath();
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    rotateIfNeeded(path);
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      msg: redactSecrets(message),
      ...(meta ? { meta: JSON.parse(redactSecrets(JSON.stringify(meta))) } : {}),
    });
    appendFileSync(path, `${line}\n`, { mode: 0o600 });
  } catch {
    // Silently ignore logging failures.
  }
}

export const logger = {
  debug: (message: string, meta?: Record<string, unknown>) => write('debug', message, meta),
  info: (message: string, meta?: Record<string, unknown>) => write('info', message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => write('warn', message, meta),
  error: (message: string, meta?: Record<string, unknown>) => write('error', message, meta),
};
