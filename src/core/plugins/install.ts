import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { getComicodeHome } from '../paths.js';
import { findManifestPath, loadManifestFile, PluginManifestError } from './manifest.js';
import { loadPlugins, type LoadedPlugin } from './loader.js';

export interface InstallResult {
  name: string;
  version: string;
  path: string;
  source: string;
}

function pluginsHomeDir(): string {
  const dir = join(getComicodeHome(), 'plugins');
  mkdirSync(dir, { recursive: true });
  return dir;
}

function isGitLikeSource(source: string): boolean {
  return (
    /^(https?:\/\/|git@|ssh:\/\/|git:\/\/)/i.test(source) ||
    source.endsWith('.git')
  );
}

function safePluginDirName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned || 'plugin';
}

function copyPluginDir(fromDir: string, toDir: string): void {
  rmSync(toDir, { recursive: true, force: true });
  cpSync(fromDir, toDir, { recursive: true });
}

function installFromDirectory(dirPath: string, sourceLabel: string): InstallResult {
  const absolute = resolve(dirPath);
  if (!existsSync(absolute) || !statSync(absolute).isDirectory()) {
    throw new PluginManifestError(`plugin directory not found: ${absolute}`);
  }
  const manifestPath = findManifestPath(absolute);
  if (!manifestPath) {
    throw new PluginManifestError(
      `no plugin manifest found in ${absolute} (expected plugin.json or comicode-plugin.json)`,
    );
  }
  const manifest = loadManifestFile(manifestPath);
  const target = join(pluginsHomeDir(), safePluginDirName(manifest.name));
  copyPluginDir(absolute, target);
  return { name: manifest.name, version: manifest.version, path: target, source: sourceLabel };
}

function runGitClone(url: string, destination: string): void {
  const result = spawnSync('git', ['clone', '--depth', '1', url, destination], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  if (result.error) {
    throw new Error(`failed to run git: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const stderr = (result.stderr || result.stdout || '').trim();
    throw new Error(`git clone failed${stderr ? `: ${stderr}` : ''}`);
  }
}

function resolveClonedPluginDir(cloneRoot: string): string {
  if (findManifestPath(cloneRoot)) return cloneRoot;
  let entries: string[] = [];
  try {
    entries = readdirSync(cloneRoot);
  } catch {
    return cloneRoot;
  }
  for (const entry of entries) {
    const full = join(cloneRoot, entry);
    try {
      if (statSync(full).isDirectory() && findManifestPath(full)) return full;
    } catch {
      // ignore
    }
  }
  return cloneRoot;
}

function installFromGitUrl(url: string): InstallResult {
  const tempRoot = mkdtempSync(join(tmpdir(), 'comicode-plugin-'));
  const cloneDir = join(tempRoot, 'repo');
  try {
    runGitClone(url, cloneDir);
    const pluginDir = resolveClonedPluginDir(cloneDir);
    return installFromDirectory(pluginDir, url);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

/**
 * Install a plugin from a local directory path or a git/https URL.
 * The plugin is validated then copied/cloned into `<comicode home>/plugins/<name>`.
 */
export async function installPlugin(source: string): Promise<InstallResult> {
  const trimmed = source.trim();
  if (!trimmed) throw new Error('Plugin source is required (local path or git URL).');

  if (isGitLikeSource(trimmed)) {
    return installFromGitUrl(trimmed);
  }

  return installFromDirectory(trimmed, resolve(trimmed));
}

/** List installed plugins from user and project scopes. */
export function listPlugins(cwd = process.cwd()): LoadedPlugin[] {
  return loadPlugins({ cwd });
}

/** Remove an installed user-scope plugin by name. */
export async function removePlugin(name: string): Promise<{ removed: boolean; path?: string; name: string }> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Plugin name is required.');
  const userDir = pluginsHomeDir();
  const plugins = loadPlugins({ cwd: process.cwd() }).filter((p) => p.scope === 'user');
  const match = plugins.find((p) => p.id.toLowerCase() === trimmed.toLowerCase());
  if (!match) {
    const direct = join(userDir, safePluginDirName(trimmed));
    if (existsSync(direct)) {
      rmSync(direct, { recursive: true, force: true });
      return { removed: true, path: direct, name: basename(direct) };
    }
    return { removed: false, name: trimmed };
  }
  rmSync(match.root, { recursive: true, force: true });
  return { removed: true, path: match.root, name: match.id };
}

/** Get a single loaded plugin by name from merged discovery. */
export function getPluginInfo(name: string, cwd = process.cwd()): LoadedPlugin | null {
  const needle = name.trim().toLowerCase();
  if (!needle) return null;
  const plugins = loadPlugins({ cwd });
  return plugins.find((p) => p.id.toLowerCase() === needle) ?? null;
}
