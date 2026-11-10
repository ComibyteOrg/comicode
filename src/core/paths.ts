import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';

/**
 * Resolve the ComiCode home directory.
 *
 * `COMICODE_HOME` is honored for tests, portable installs, and advanced setups.
 * Otherwise we use the conventional per-user application data directory for the
 * platform. Credentials, the SQLite database, and logs live here — never inside
 * the user's repository.
 */
export function getComicodeHome(): string {
  const override = process.env.COMICODE_HOME?.trim();
  if (override) return resolve(override);

  if (process.platform === 'win32') {
    const base = process.env.APPDATA || join(homedir(), 'AppData', 'Roaming');
    return join(base, 'comicode');
  }
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'comicode');
  }
  const xdg = process.env.XDG_CONFIG_HOME;
  return join(xdg && xdg.trim() ? xdg : join(homedir(), '.config'), 'comicode');
}

export function ensureComicodeHome(): string {
  const home = getComicodeHome();
  mkdirSync(home, { recursive: true, mode: 0o700 });
  mkdirSync(join(home, 'logs'), { recursive: true, mode: 0o700 });
  return home;
}

export function getDatabasePath(): string {
  const override = process.env.COMICODE_DB_PATH?.trim();
  return override ? resolve(override) : join(getComicodeHome(), 'comicode.db');
}

export function getLogPath(): string {
  return join(getComicodeHome(), 'logs', 'comicode.log');
}

export function getProjectStateDir(cwd: string): string {
  return join(cwd, '.comicode');
}

export function getProjectStatePath(cwd: string): string {
  return join(getProjectStateDir(cwd), 'project.json');
}

export function getUid(): string {
  return typeof process.getuid === 'function'
    ? String(process.getuid())
    : process.env.USERNAME || 'user';
}
