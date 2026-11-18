import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

/**
 * Declarative plugin manifest (Claude Code–style, simplified).
 *
 * Supported manifest filenames (first match wins): plugin.json, comicode-plugin.json.
 * `plugin.yaml` is intentionally not parsed here; convert it to JSON before
 * installing (YAML support can be added when a parser dependency is available).
 */

export const PluginCommandSchema = z
  .object({
    name: z.string().min(1).max(100),
    description: z.string().min(1).max(500),
    promptTemplate: z.string().min(1).max(20_000),
    argumentHint: z.string().max(200).optional(),
  })
  .strict();

export const PluginSkillSchema = z
  .object({
    name: z.string().min(1).max(100),
    description: z.string().min(1).max(500),
    body: z.string().min(1).max(50_000),
  })
  .strict();

export const PluginToolDescriptorSchema = z
  .object({
    name: z.string().min(1).max(100),
    description: z.string().min(1).max(1000),
    /** JSON-schema-like input shape. Declarative only; execution requires host support. */
    inputSchema: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const PluginMcpServerSchema = z
  .object({
    name: z.string().min(1).max(100),
    command: z.string().max(1000).optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    url: z.string().max(2000).optional(),
    headers: z.record(z.string(), z.string()).optional(),
  })
  .strict();

export const PluginManifestSchema = z
  .object({
    name: z.string().min(1).max(100),
    version: z.string().min(1).max(50),
    description: z.string().max(1000).optional(),
    author: z.string().max(200).optional(),
    license: z.string().max(100).optional(),
    commands: z.array(PluginCommandSchema).default([]),
    skills: z.array(PluginSkillSchema).default([]),
    tools: z.array(PluginToolDescriptorSchema).default([]),
    mcpServers: z.array(PluginMcpServerSchema).default([]),
  })
  .strict();

export type PluginManifest = z.infer<typeof PluginManifestSchema>;
export type PluginCommand = z.infer<typeof PluginCommandSchema>;
export type PluginSkill = z.infer<typeof PluginSkillSchema>;
export type PluginToolDescriptor = z.infer<typeof PluginToolDescriptorSchema>;
export type PluginMcpServer = z.infer<typeof PluginMcpServerSchema>;

export const MANIFEST_FILENAMES = ['plugin.json', 'comicode-plugin.json', 'plugin.yaml'] as const;

export class PluginManifestError extends Error {
  constructor(message: string, readonly filePath?: string) {
    super(filePath ? `${filePath}: ${message}` : message);
    this.name = 'PluginManifestError';
  }
}

function formatZodIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 12)
    .map((issue) => {
      const path = issue.path.length ? issue.path.join('.') : '(root)';
      return `${path}: ${issue.message}`;
    })
    .join('; ');
}

/** Parse and validate a manifest object. Throws PluginManifestError on failure. */
export function parseManifest(input: unknown, filePath?: string): PluginManifest {
  const parsed = PluginManifestSchema.safeParse(input);
  if (!parsed.success) {
    throw new PluginManifestError(`invalid manifest — ${formatZodIssues(parsed.error)}`, filePath);
  }
  return parsed.data;
}

/**
 * Read and validate a manifest file. JSON is supported; plugin.yaml is rejected
 * with an actionable message (convert to JSON).
 */
export function loadManifestFile(filePath: string): PluginManifest {
  const name = basename(filePath).toLowerCase();
  if (name === 'plugin.yaml' || name.endsWith('.yaml') || name.endsWith('.yml')) {
    throw new PluginManifestError(
      'YAML manifests are not supported yet; convert plugin.yaml to plugin.json or comicode-plugin.json',
      filePath,
    );
  }
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new PluginManifestError(
      `cannot read manifest: ${error instanceof Error ? error.message : String(error)}`,
      filePath,
    );
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    throw new PluginManifestError(
      `invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      filePath,
    );
  }
  return parseManifest(data, filePath);
}

/** Find the first supported manifest file inside a plugin directory, or null. */
export function findManifestPath(pluginDir: string): string | null {
  for (const filename of MANIFEST_FILENAMES) {
    const candidate = join(pluginDir, filename);
    try {
      readFileSync(candidate);
      return candidate;
    } catch {
      // try next
    }
  }
  return null;
}

/** Resolve plugin root directory name as a stable fallback id. */
export function pluginDirName(manifestPath: string): string {
  return basename(dirname(manifestPath));
}
