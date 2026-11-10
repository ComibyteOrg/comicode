import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { getProjectStateDir, getProjectStatePath } from '../paths.js';
import { ProjectInspector } from './inspector.js';

export interface ProjectConfig {
  schemaVersion: 1;
  name: string;
  createdAt: string;
  commands: {
    test: string | null;
    lint: string | null;
    build: string | null;
    dev: string | null;
  };
}

export function readProjectConfig(cwd: string): ProjectConfig | null {
  const path = getProjectStatePath(cwd);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as ProjectConfig;
  } catch {
    return null;
  }
}

export interface InitResult {
  config: ProjectConfig;
  created: boolean;
  gitignoreUpdated: boolean;
  configPath: string;
}

export async function initProject(cwd: string, requestedName?: string): Promise<InitResult> {
  const directory = getProjectStateDir(cwd);
  mkdirSync(directory, { recursive: true });
  const inspector = new ProjectInspector(cwd);
  const existing = readProjectConfig(cwd);
  const commands = inspector.detectCommands();
  const config: ProjectConfig = existing ?? {
    schemaVersion: 1,
    name: requestedName?.trim() || inspector.projectName() || basename(cwd),
    createdAt: new Date().toISOString(),
    commands: {
      test: commands.test,
      lint: commands.lint,
      build: commands.build,
      dev: commands.dev,
    },
  };
  if (requestedName?.trim()) config.name = requestedName.trim();
  config.commands = {
    test: commands.test,
    lint: commands.lint,
    build: commands.build,
    dev: commands.dev,
  };
  const configPath = getProjectStatePath(cwd);
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');

  let gitignoreUpdated = false;
  const gitignore = join(cwd, '.gitignore');
  const marker = '.comicode/';
  try {
    const current = existsSync(gitignore) ? readFileSync(gitignore, 'utf8') : '';
    const hasMarker = current
      .split(/\r?\n/)
      .some((line) => line.trim() === marker || line.trim() === '.comicode');
    if (!hasMarker) {
      const prefix = current && !current.endsWith('\n') ? '\n' : '';
      const block = `${prefix}\n# ComiCode project state (contains task metadata, never credentials)\n${marker}\n`;
      writeFileSync(gitignore, current + block, 'utf8');
      gitignoreUpdated = true;
    }
  } catch {
    // A read-only .gitignore should not block initialization.
  }

  return {
    config,
    created: !existing,
    gitignoreUpdated,
    configPath,
  };
}
