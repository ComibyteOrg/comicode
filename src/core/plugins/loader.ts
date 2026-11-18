import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { getComicodeHome, getProjectStateDir } from '../paths.js';
import type { AgentSkill } from '../agent/skills.js';
import {
  findManifestPath,
  loadManifestFile,
  PluginManifestError,
  type PluginManifest,
  type PluginMcpServer,
  type PluginToolDescriptor,
} from './manifest.js';

export type PluginSourceScope = 'user' | 'project';

export interface LoadedPlugin {
  /** Effective id (manifest name). */
  id: string;
  manifest: PluginManifest;
  /** Directory containing the manifest. */
  root: string;
  manifestPath: string;
  scope: PluginSourceScope;
  warnings: string[];
}

/** Slash-style command contributed by a plugin (prompt template expansion). */
export interface PluginSlashCommand {
  name: string;
  description: string;
  promptTemplate: string;
  argumentHint?: string;
  pluginId: string;
  pluginRoot: string;
  scope: PluginSourceScope;
}

export interface LoadPluginsOptions {
  cwd?: string;
  /** Additional warnings sink; loader always returns per-plugin warnings too. */
  onWarning?: (message: string) => void;
}

function warn(msg: string, options?: LoadPluginsOptions): void {
  options?.onWarning?.(msg);
}

function scanPluginRoot(baseDir: string, scope: PluginSourceScope, options?: LoadPluginsOptions): LoadedPlugin[] {
  if (!existsSync(baseDir)) return [];
  let entries: string[];
  try {
    entries = readdirSync(baseDir);
  } catch (error) {
    warn(
      `[plugins] cannot read ${baseDir}: ${error instanceof Error ? error.message : String(error)}`,
      options,
    );
    return [];
  }

  const out: LoadedPlugin[] = [];
  for (const entry of entries) {
    const full = join(baseDir, entry);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;
    const manifestPath = findManifestPath(full);
    if (!manifestPath) continue;
    try {
      const manifest = loadManifestFile(manifestPath);
      out.push({
        id: manifest.name,
        manifest,
        root: full,
        manifestPath,
        scope,
        warnings: [],
      });
    } catch (error) {
      const message =
        error instanceof PluginManifestError
          ? error.message
          : `[plugins] failed to load ${manifestPath}: ${error instanceof Error ? error.message : String(error)}`;
      warn(message, options);
    }
  }
  return out;
}

/**
 * Discover plugins from `<comicode home>/plugins/*` and `<project>/.comicode/plugins/*`.
 * Invalid plugins are skipped with warnings. Later (project) plugins with the same id
 * override earlier (user/home) ones so project-local fixes take precedence.
 */
export function loadPlugins(options: LoadPluginsOptions = {}): LoadedPlugin[] {
  const cwd = options.cwd ?? process.cwd();
  const byId = new Map<string, LoadedPlugin>();

  const userDir = join(getComicodeHome(), 'plugins');
  for (const plugin of scanPluginRoot(userDir, 'user', options)) {
    byId.set(plugin.id, plugin);
  }
  const projectDir = join(getProjectStateDir(cwd), 'plugins');
  for (const plugin of scanPluginRoot(projectDir, 'project', options)) {
    const existing = byId.get(plugin.id);
    if (existing) {
      warn(
        `[plugins] project plugin "${plugin.id}" overrides ${existing.scope} plugin at ${existing.root}`,
        options,
      );
    }
    byId.set(plugin.id, plugin);
  }

  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** Map plugin skills to the core AgentSkill shape so they can be merged into discovery. */
export function getPluginSkills(plugins: LoadedPlugin[]): AgentSkill[] {
  const skills: AgentSkill[] = [];
  for (const plugin of plugins) {
    for (const skill of plugin.manifest.skills ?? []) {
      skills.push({
        name: skill.name,
        description: skill.description,
        content: skill.body.trim(),
        source: plugin.scope === 'project' ? 'project' : 'user',
        path: plugin.manifestPath,
      });
    }
  }
  return skills;
}

/** Flatten plugin-contributed slash/prompt commands for host registration. */
export function getPluginCommands(plugins: LoadedPlugin[]): PluginSlashCommand[] {
  const commands: PluginSlashCommand[] = [];
  for (const plugin of plugins) {
    for (const command of plugin.manifest.commands ?? []) {
      commands.push({
        name: command.name,
        description: command.description,
        promptTemplate: command.promptTemplate,
        argumentHint: command.argumentHint,
        pluginId: plugin.id,
        pluginRoot: plugin.root,
        scope: plugin.scope,
      });
    }
  }
  return commands;
}

export function getPluginTools(plugins: LoadedPlugin[]): Array<PluginToolDescriptor & { pluginId: string }> {
  const tools: Array<PluginToolDescriptor & { pluginId: string }> = [];
  for (const plugin of plugins) {
    for (const tool of plugin.manifest.tools ?? []) {
      tools.push({ ...tool, pluginId: plugin.id });
    }
  }
  return tools;
}

export function getPluginMcpServers(plugins: LoadedPlugin[]): Array<PluginMcpServer & { pluginId: string }> {
  const servers: Array<PluginMcpServer & { pluginId: string }> = [];
  for (const plugin of plugins) {
    for (const server of plugin.manifest.mcpServers ?? []) {
      servers.push({ ...server, pluginId: plugin.id });
    }
  }
  return servers;
}

export function findLoadedPlugin(plugins: LoadedPlugin[], name: string): LoadedPlugin | null {
  const needle = name.trim().toLowerCase();
  if (!needle) return null;
  return (
    plugins.find((p) => p.id.toLowerCase() === needle) ??
    plugins.find((p) => p.id.toLowerCase().startsWith(needle)) ??
    plugins.find((p) => p.id.toLowerCase().includes(needle)) ??
    null
  );
}
