import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import type { AgentAuthority, TaskPlan, ToolCall } from '../../types.js';
import type { AppSettings } from '../../settings.js';
import type { ConfirmFn, ConfirmationRequest, ToolResult } from '../types.js';
import { AGENT_MODES, PLAN_MODE_TOOLS, type AgentMode } from '../modes.js';
import { findSkill, type AgentSkill } from '../skills.js';
import { PathGuard, PathSafetyError } from '../../safety/paths.js';
import { isSecretFile, looksLikePrivateKey } from '../../safety/secrets.js';
import { isBinaryBuffer, listProjectFiles } from '../../safety/files.js';
import { createUnifiedDiff, applyUnifiedPatch } from '../../safety/diff.js';
import {
  inspectCommand,
  runShell,
  summarizeShellResult,
  sanitizedEnvironment,
} from '../../safety/shell.js';
import { runProcess } from '../../safety/process.js';
import { redactSecrets } from '../../security/redact.js';
import type { ProjectInspector } from '../../project/inspector.js';
import { TOOL_DEFINITIONS } from './definitions.js';

const MAX_READ_BYTES = 600_000;
const MAX_WRITE_BYTES = 2_000_000;
const MAX_SEARCH_FILE_BYTES = 300_000;

const pathSchema = z.object({
  path: z.string().min(1).max(1000),
});
const readSchema = pathSchema.extend({
  start_line: z.number().int().min(1).optional(),
  end_line: z.number().int().min(1).optional(),
});
const searchSchema = z.object({
  pattern: z.string().min(1).max(500),
  path: z.string().max(1000).optional(),
  case_sensitive: z.boolean().optional(),
  max_results: z.number().int().min(1).max(200).optional(),
});
const writeSchema = pathSchema.extend({ content: z.string().max(MAX_WRITE_BYTES) });
const editSchema = pathSchema.extend({
  old_text: z.string().min(1).max(MAX_WRITE_BYTES),
  new_text: z.string().max(MAX_WRITE_BYTES),
  replace_all: z.boolean().optional(),
});
const patchSchema = pathSchema.extend({ patch: z.string().min(1).max(MAX_WRITE_BYTES) });
const deleteSchema = pathSchema.extend({ reason: z.string().min(1).max(1000) });
const commandSchema = z.object({
  command: z.string().min(1).max(4000),
  cwd: z.string().max(1000).optional(),
  timeout_ms: z.number().int().min(1000).max(600_000).optional(),
});
const testsSchema = z.object({
  command: z.string().min(1).max(4000).optional(),
  timeout_ms: z.number().int().min(1000).max(600_000).optional(),
});
const timeoutSchema = z.object({ timeout_ms: z.number().int().min(1000).max(600_000).optional() });
const diffSchema = z.object({
  path: z.string().max(1000).optional(),
  staged: z.boolean().optional(),
  max_chars: z.number().int().min(1000).max(200_000).optional(),
});
const planSchema = z.object({
  summary: z.string().min(1).max(2000),
  steps: z
    .array(
      z.union([
        z.string().min(1).max(500),
        z.object({
          title: z.string().min(1).max(500),
          status: z.enum(['pending', 'in_progress', 'completed', 'skipped']).optional(),
        }),
      ]),
    )
    .min(1)
    .max(50),
});
const completeSchema = z.object({ summary: z.string().min(1).max(8000) });
const skillSchema = z.object({ name: z.string().min(1).max(200) });
const verifyUiSchema = z.object({
  url: z.string().min(1).max(2000),
  wait_ms: z.number().int().min(0).max(30_000).optional(),
});

export interface ToolExecutorOptions {
  root: string;
  settings: AppSettings;
  authority: AgentAuthority;
  confirm?: ConfirmFn;
  inspector: ProjectInspector;
  /** Agent mode; 'plan' restricts the model to read-only tools. */
  mode?: AgentMode;
  /** Discovered skills made available through the use_skill tool. */
  skills?: AgentSkill[];
  /** Fresh settings lookup so mid-run permission grants take effect. */
  getSettings?: () => AppSettings;
  /** Persist an "always allow" grant chosen in an approval dialog. */
  onGrant?: (request: ConfirmationRequest) => void;
  onPlan?: (plan: TaskPlan) => void;
  onTaskComplete?: (summary: string) => void;
  onNotice?: (message: string) => void;
}

function truncateForModel(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const head = Math.floor(maxChars * 0.68);
  const tail = Math.floor(maxChars * 0.25);
  return `${text.slice(0, head)}\n... [truncated ${text.length - head - tail} characters] ...\n${text.slice(-tail)}`;
}

function quoteDiff(diff: string, maxChars: number): string {
  if (!diff) return '';
  return diff.length > maxChars ? `${diff.slice(0, maxChars)}\n... [diff truncated]` : diff;
}

function atomicWrite(absolute: string, content: string): void {
  mkdirSync(dirname(absolute), { recursive: true });
  const temp = `${absolute}.comicode-${process.pid}-${Date.now()}.tmp`;
  writeFileSync(temp, content, 'utf8');
  renameSync(temp, absolute);
}

function parseChangedFiles(output: string): string[] {
  const files = new Set<string>();
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim() || line.startsWith('##')) continue;
    let path = line.slice(3).trim();
    if (path.includes(' -> ')) path = path.split(' -> ').pop()!.trim();
    path = path.replace(/^"|"$/g, '');
    if (path) files.add(path.replace(/\\/g, '/'));
  }
  return [...files];
}

export class ToolExecutor {
  private readonly guard: PathGuard;

  constructor(private readonly options: ToolExecutorOptions) {
    this.guard = new PathGuard(options.root);
  }

  private readOnlyMode(): boolean {
    return this.options.mode ? AGENT_MODES[this.options.mode].tools === 'read-only' : false;
  }

  definitions() {
    if (this.readOnlyMode()) {
      return TOOL_DEFINITIONS.filter((tool) => PLAN_MODE_TOOLS.has(tool.name));
    }
    return TOOL_DEFINITIONS;
  }

  private notice(message: string): void {
    this.options.onNotice?.(message);
  }

  private permissionGrants(): { allowCommands: string[]; allowPaths: string[] } {
    const settings = this.options.getSettings?.() ?? this.options.settings;
    return settings.agent.permissions;
  }

  /** True when a persisted "always allow" grant covers this request. */
  private grantMatches(request: ConfirmationRequest): boolean {
    const grants = this.permissionGrants();
    if (
      request.kind === 'command' ||
      request.kind === 'dangerous-command' ||
      request.kind === 'ui-verify'
    ) {
      const command = request.command ?? '';
      if (!command) return false;
      return grants.allowCommands.some((grant) =>
        grant.endsWith('*')
          ? command.startsWith(grant.slice(0, -1))
          : command === grant,
      );
    }
    if (request.path) {
      const target = request.path.replace(/\\/g, '/').replace(/^\.\//, '');
      return grants.allowPaths.some((grant) => {
        const base = grant.replace(/\\/g, '/').replace(/\/+$/, '');
        return target === base || target.startsWith(`${base}/`);
      });
    }
    return false;
  }

  private async approve(request: ConfirmationRequest, auto: boolean): Promise<boolean> {
    if (auto) return true;
    const settings = this.options.getSettings?.() ?? this.options.settings;
    const mode = settings.agent.permissionMode ?? 'ask';
    if (mode === 'auto') return true;
    if (mode === 'trusted' && request.kind !== 'dangerous-command' && request.kind !== 'secret-read') {
      return true;
    }
    if (this.grantMatches(request)) {
      this.notice(`Allowed by saved permission: ${request.title}.`);
      return true;
    }
    if (!this.options.confirm) {
      this.notice(
        `Approval required for ${request.title}, but no interactive confirmation is available. ` +
          'Re-run with --yes (and --allow-commands for shell commands) or enable auto-approval in settings.',
      );
      return false;
    }
    try {
      const decision = await this.options.confirm(request);
      if (decision === 'always') {
        this.options.onGrant?.(request);
        return true;
      }
      return decision === 'allow';
    } catch {
      return false;
    }
  }

  private writesAuto(): boolean {
    return (
      this.options.settings.agent.autoApproveFileEdits || this.options.authority.allowFileWrites
    );
  }

  private commandsAuto(): boolean {
    return this.options.settings.agent.autoApproveCommands || this.options.authority.allowCommands;
  }

  private secretsAllowed(): boolean {
    return this.options.settings.agent.allowSecretAccess || this.options.authority.allowSecrets;
  }

  private async confirmSecret(relative: string, action: string): Promise<boolean> {
    if (this.secretsAllowed()) return true;
    return this.approve(
      {
        kind: 'secret-read',
        title: `${action} protected file`,
        description:
          'This file may contain credentials. Its contents could be sent to the selected AI provider.',
        path: relative,
      },
      false,
    );
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    if (this.readOnlyMode() && !PLAN_MODE_TOOLS.has(call.name)) {
      return {
        ok: false,
        content: `Tool ${call.name} is not available in ${this.options.mode} mode. Inspect and update the plan instead.`,
      };
    }
    try {
      switch (call.name) {
        case 'list_files':
          return await this.listFiles(call.arguments);
        case 'read_file':
          return await this.readFile(call.arguments);
        case 'search_files':
          return await this.searchFiles(call.arguments);
        case 'write_file':
          return await this.writeFile(call.arguments);
        case 'edit_file':
          return await this.editFile(call.arguments);
        case 'apply_patch':
          return await this.applyPatch(call.arguments);
        case 'delete_file':
          return await this.deleteFile(call.arguments);
        case 'run_command':
          return await this.runCommandTool(call.arguments);
        case 'run_tests':
          return await this.runPreset('test', call.arguments);
        case 'run_lint':
          return await this.runPreset('lint', call.arguments);
        case 'run_build':
          return await this.runPreset('build', call.arguments);
        case 'verify_ui':
          return await this.verifyUiTool(call.arguments);
        case 'git_status':
          return await this.gitStatus();
        case 'git_diff':
          return await this.gitDiff(call.arguments);
        case 'update_plan':
          return this.updatePlan(call.arguments);
        case 'task_complete':
          return this.taskComplete(call.arguments);
        case 'environment_info':
          return await this.environmentInfo();
        case 'use_skill':
          return this.useSkill(call.arguments);
        default:
          return { ok: false, content: `Unknown tool: ${call.name}` };
      }
    } catch (error) {
      if (error instanceof PathSafetyError) {
        return { ok: false, content: `Safety error: ${error.message}` };
      }
      return {
        ok: false,
        content: `Tool failed: ${redactSecrets(error instanceof Error ? error.message : String(error))}`,
      };
    }
  }

  private parse<T>(
    schema: z.ZodType<T>,
    args: unknown,
  ): { ok: true; data: T } | { ok: false; result: ToolResult } {
    const parsed = schema.safeParse(args ?? {});
    if (parsed.success) return { ok: true, data: parsed.data };
    const issues = parsed.error.issues
      .slice(0, 6)
      .map((issue) => `${issue.path.join('.') || 'arguments'}: ${issue.message}`)
      .join('; ');
    return { ok: false, result: { ok: false, content: `Invalid tool arguments: ${issues}` } };
  }

  private async listFiles(args: unknown): Promise<ToolResult> {
    const parsed = this.parse(
      z.object({
        path: z.string().max(1000).optional(),
        limit: z.number().int().min(1).max(1000).optional(),
      }),
      args,
    );
    if (!parsed.ok) return parsed.result;
    const limit = parsed.data.limit ?? 200;
    let prefix = '';
    if (parsed.data.path) {
      const absolute = this.guard.resolvePath(parsed.data.path, { mustExist: true });
      const stats = statSync(absolute);
      if (stats.isFile()) return { ok: true, content: this.guard.relative(absolute) };
      prefix = this.guard.relative(absolute);
      if (prefix === '.') prefix = '';
    }
    const files = await listProjectFiles(this.options.root, 5000);
    const filtered = files
      .filter((file) => !isSecretFile(file.path))
      .filter((file) => !prefix || file.path === prefix || file.path.startsWith(`${prefix}/`))
      .slice(0, limit);
    if (filtered.length === 0) {
      return { ok: true, content: prefix ? `No files found under ${prefix}.` : 'No files found.' };
    }
    const lines = filtered.map((file) => `${file.path} (${file.size} bytes)`);
    const more =
      files.length > filtered.length
        ? `\n... more files omitted; increase limit or narrow path`
        : '';
    return {
      ok: true,
      content: `Files (${filtered.length}):\n${lines.join('\n')}${more}`,
    };
  }

  private async readFile(args: unknown): Promise<ToolResult> {
    const parsed = this.parse(readSchema, args);
    if (!parsed.ok) return parsed.result;
    const absolute = this.guard.resolvePath(parsed.data.path, { mustExist: true });
    const relative = this.guard.relative(absolute);
    const stats = statSync(absolute);
    if (stats.isDirectory())
      return { ok: false, content: `${relative} is a directory; use list_files.` };
    if (isSecretFile(relative) && !(await this.confirmSecret(relative, 'Read'))) {
      return { ok: false, content: `Reading ${relative} was not approved.` };
    }
    if (stats.size > MAX_READ_BYTES) {
      return {
        ok: false,
        content: `File ${relative} is ${stats.size} bytes (limit ${MAX_READ_BYTES}). Use search_files or read a smaller generated section.`,
      };
    }
    const buffer = readFileSync(absolute);
    if (isBinaryBuffer(buffer)) return { ok: false, content: `${relative} appears to be binary.` };
    let text = buffer.toString('utf8');
    if (looksLikePrivateKey(text) && !(await this.confirmSecret(relative, 'Read private key'))) {
      return { ok: false, content: `Reading a private key file was not approved.` };
    }
    const lines = text.split(/\r?\n/);
    const total = lines.length;
    let start = parsed.data.start_line ?? 1;
    let end = parsed.data.end_line ?? total;
    if (start > end) [start, end] = [end, start];
    start = Math.max(1, start);
    end = Math.min(total, end);
    text = lines.slice(start - 1, end).join('\n');
    return {
      ok: true,
      content: `# ${relative} (lines ${start}-${end} of ${total})\n${text}`,
      metadata: { path: relative, totalLines: total, start, end },
    };
  }

  private async searchFiles(args: unknown): Promise<ToolResult> {
    const parsed = this.parse(searchSchema, args);
    if (!parsed.ok) return parsed.result;
    let regex: RegExp;
    try {
      regex = new RegExp(parsed.data.pattern, parsed.data.case_sensitive ? '' : 'i');
    } catch (error) {
      return {
        ok: false,
        content: `Invalid regular expression: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    let prefix = '';
    if (parsed.data.path) {
      const absolute = this.guard.resolvePath(parsed.data.path);
      prefix = this.guard.relative(absolute);
      if (prefix === '.') prefix = '';
    }
    const maxResults = parsed.data.max_results ?? 60;
    const files = await listProjectFiles(this.options.root, 5000);
    const matches: string[] = [];
    let scanned = 0;
    for (const file of files) {
      if (matches.length >= maxResults) break;
      if (isSecretFile(file.path)) continue;
      if (prefix && !file.path.startsWith(`${prefix}/`) && file.path !== prefix) continue;
      if (file.size > MAX_SEARCH_FILE_BYTES) continue;
      try {
        const buffer = readFileSync(join(this.options.root, file.path));
        if (isBinaryBuffer(buffer)) continue;
        scanned += 1;
        const lines = buffer.toString('utf8').split(/\r?\n/);
        for (let index = 0; index < lines.length; index += 1) {
          const line = lines[index] ?? '';
          if (regex.test(line)) {
            matches.push(`${file.path}:${index + 1}: ${line.trim().slice(0, 240)}`);
            if (matches.length >= maxResults) break;
          }
        }
      } catch {
        // Skip unreadable files.
      }
    }
    if (matches.length === 0) {
      return { ok: true, content: `No matches for /${parsed.data.pattern}/ in ${scanned} files.` };
    }
    return {
      ok: true,
      content: `Matches (${matches.length}${matches.length >= maxResults ? '+ limited' : ''}):\n${matches.join('\n')}`,
    };
  }

  private async writeFile(args: unknown): Promise<ToolResult> {
    const parsed = this.parse(writeSchema, args);
    if (!parsed.ok) return parsed.result;
    const absolute = this.guard.assertWritable(parsed.data.path);
    const relative = this.guard.relative(absolute);
    if (existsSync(absolute) && statSync(absolute).isDirectory()) {
      return { ok: false, content: `${relative} is a directory.` };
    }
    const existed = existsSync(absolute);
    const previous = existed ? readFileSync(absolute, 'utf8') : '';
    if (previous === parsed.data.content) {
      return { ok: true, content: `${relative} is already up to date.` };
    }
    const diff = createUnifiedDiff(relative, previous, parsed.data.content);
    const approved = await this.approve(
      {
        kind: 'file-write',
        title: existed ? `Overwrite ${relative}` : `Create ${relative}`,
        description: existed ? 'Replace the entire file with new content.' : 'Create a new file.',
        path: relative,
        diff: quoteDiff(diff, 20_000),
      },
      this.writesAuto(),
    );
    if (!approved) return { ok: false, content: `Writing ${relative} was not approved.` };
    atomicWrite(absolute, parsed.data.content);
    return {
      ok: true,
      content: `${existed ? 'Wrote' : 'Created'} ${relative}.\n${quoteDiff(diff, 8000)}`,
      changedFiles: [relative],
      diff,
    };
  }

  private async editFile(args: unknown): Promise<ToolResult> {
    const parsed = this.parse(editSchema, args);
    if (!parsed.ok) return parsed.result;
    const absolute = this.guard.assertWritable(parsed.data.path);
    const relative = this.guard.relative(absolute);
    if (!existsSync(absolute))
      return { ok: false, content: `${relative} does not exist. Use write_file to create it.` };
    const previous = readFileSync(absolute, 'utf8');
    const occurrences = previous.split(parsed.data.old_text).length - 1;
    if (occurrences === 0) {
      return {
        ok: false,
        content: `old_text was not found in ${relative}. Read the file again and copy the exact text.`,
      };
    }
    if (occurrences > 1 && !parsed.data.replace_all) {
      return {
        ok: false,
        content: `old_text occurs ${occurrences} times in ${relative}. Provide more context or set replace_all=true.`,
      };
    }
    const updated = parsed.data.replace_all
      ? previous.split(parsed.data.old_text).join(parsed.data.new_text)
      : previous.replace(parsed.data.old_text, parsed.data.new_text);
    const diff = createUnifiedDiff(relative, previous, updated);
    const approved = await this.approve(
      {
        kind: 'file-write',
        title: `Edit ${relative}`,
        description: parsed.data.replace_all
          ? `Replace ${occurrences} occurrences.`
          : 'Replace one text block.',
        path: relative,
        diff: quoteDiff(diff, 20_000),
      },
      this.writesAuto(),
    );
    if (!approved) return { ok: false, content: `Editing ${relative} was not approved.` };
    atomicWrite(absolute, updated);
    return {
      ok: true,
      content: `Edited ${relative} (${occurrences} replacement${occurrences === 1 ? '' : 's'}).\n${quoteDiff(diff, 8000)}`,
      changedFiles: [relative],
      diff,
    };
  }

  private async applyPatch(args: unknown): Promise<ToolResult> {
    const parsed = this.parse(patchSchema, args);
    if (!parsed.ok) return parsed.result;
    const absolute = this.guard.assertWritable(parsed.data.path);
    const relative = this.guard.relative(absolute);
    if (!existsSync(absolute)) return { ok: false, content: `${relative} does not exist.` };
    const previous = readFileSync(absolute, 'utf8');
    let updated: string;
    try {
      updated = applyUnifiedPatch(previous, parsed.data.patch);
    } catch (error) {
      return {
        ok: false,
        content: `Patch failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    const diff = createUnifiedDiff(relative, previous, updated);
    const approved = await this.approve(
      {
        kind: 'file-write',
        title: `Apply patch to ${relative}`,
        description: 'Apply the supplied unified diff.',
        path: relative,
        diff: quoteDiff(diff, 20_000),
      },
      this.writesAuto(),
    );
    if (!approved) return { ok: false, content: `Patching ${relative} was not approved.` };
    atomicWrite(absolute, updated);
    return {
      ok: true,
      content: `Applied patch to ${relative}.\n${quoteDiff(diff, 8000)}`,
      changedFiles: [relative],
      diff,
    };
  }

  private async deleteFile(args: unknown): Promise<ToolResult> {
    const parsed = this.parse(deleteSchema, args);
    if (!parsed.ok) return parsed.result;
    const absolute = this.guard.assertWritable(parsed.data.path);
    const relative = this.guard.relative(absolute);
    if (!existsSync(absolute)) return { ok: false, content: `${relative} does not exist.` };
    if (statSync(absolute).isDirectory()) {
      return {
        ok: false,
        content: `Refusing to delete directory ${relative}. Remove files individually.`,
      };
    }
    const approved = await this.approve(
      {
        kind: 'file-delete',
        title: `Delete ${relative}`,
        description: parsed.data.reason,
        path: relative,
      },
      false,
    );
    if (!approved) return { ok: false, content: `Deleting ${relative} was not approved.` };
    unlinkSync(absolute);
    return { ok: true, content: `Deleted ${relative}.`, changedFiles: [relative] };
  }

  private async runCommandTool(args: unknown): Promise<ToolResult> {
    const parsed = this.parse(commandSchema, args);
    if (!parsed.ok) return parsed.result;
    return this.executeShell(parsed.data.command, {
      cwd: parsed.data.cwd,
      timeoutMs: parsed.data.timeout_ms,
    });
  }

  private async verifyUiTool(args: unknown): Promise<ToolResult> {
    const parsed = this.parse(verifyUiSchema, args);
    if (!parsed.ok) return parsed.result;
    const url = parsed.data.url;
    if (!/^(https?|file):\/\//i.test(url)) {
      return {
        ok: false,
        content: 'verify_ui only supports http://, https://, or file:// URLs.',
      };
    }
    const approved = await this.approve(
      {
        kind: 'ui-verify',
        title: `Verify UI: ${url}`,
        description:
          'Launch a headless browser, capture a screenshot, and report console errors and failed requests.',
        command: `verify_ui ${url}`,
      },
      this.commandsAuto(),
    );
    if (!approved) return { ok: false, content: 'UI verification was not approved.' };
    const { verifyPage } = await import('../../ui/browser-verify.js');
    const relative = '.comicode/shots';
    const result = await verifyPage(url, {
      waitMs: parsed.data.wait_ms ?? 1000,
      outDir: join(this.options.root, relative),
      timeoutMs: 30_000,
    });
    if (!result.ok) return { ok: false, content: result.message };
    const lines = [
      result.message,
      result.title ? `Title: ${result.title}` : null,
      result.screenshotPath ? `Screenshot: ${join(relative, result.screenshotPath.split(/[\\/]/).pop() ?? '')}` : null,
      result.consoleErrors.length
        ? `Console errors:\n${result.consoleErrors.map((e) => `- ${e}`).join('\n')}`
        : 'Console errors: none',
      result.failedRequests.length
        ? `Failed requests:\n${result.failedRequests.map((r) => `- ${r}`).join('\n')}`
        : 'Failed requests: none',
    ].filter(Boolean);
    return { ok: true, content: lines.join('\n') };
  }

  private async runPreset(kind: 'test' | 'lint' | 'build', args: unknown): Promise<ToolResult> {
    const parsed = this.parse(kind === 'test' ? testsSchema : timeoutSchema, args);
    if (!parsed.ok) return parsed.result;
    const detected = this.options.inspector.detectCommands();
    const configured =
      kind === 'test'
        ? this.options.settings.agent.testCommand
        : kind === 'lint'
          ? this.options.settings.agent.lintCommand
          : this.options.settings.agent.buildCommand;
    const override =
      parsed.data && 'command' in parsed.data && typeof parsed.data.command === 'string'
        ? parsed.data.command
        : null;
    const command = override || configured || detected[kind];
    if (!command) {
      return {
        ok: false,
        content: `No ${kind} command is configured or detected. Configure agent.${kind}Command or run_command explicitly.`,
      };
    }
    const timeoutMs =
      parsed.data && 'timeout_ms' in parsed.data ? parsed.data.timeout_ms : undefined;
    return this.executeShell(command, { timeoutMs });
  }

  private async executeShell(
    command: string,
    options: { cwd?: string; timeoutMs?: number } = {},
  ): Promise<ToolResult> {
    const cwd = options.cwd
      ? this.guard.resolvePath(options.cwd, { mustExist: true })
      : this.options.root;
    if (!statSync(cwd).isDirectory()) {
      return { ok: false, content: `${options.cwd} is not a directory.` };
    }
    const safety = inspectCommand(command);
    if (safety.blocked) {
      return {
        ok: false,
        content: `Command blocked by safety policy: ${safety.reasons.join('; ')}.`,
      };
    }
    const dangerous = safety.dangerous;
    const auto =
      this.commandsAuto() && (!dangerous || this.options.authority.allowDangerousCommands);
    if (dangerous && !this.options.authority.allowDangerousCommands && !this.options.confirm) {
      return {
        ok: false,
        content: `Command requires dangerous-command approval: ${safety.reasons.join('; ')}.`,
      };
    }
    const approved = await this.approve(
      {
        kind: dangerous ? 'dangerous-command' : 'command',
        title: dangerous ? 'Run risky command' : 'Run command',
        description: dangerous
          ? `This command matches risky patterns: ${safety.reasons.join('; ')}`
          : 'Execute a shell command in the project directory.',
        command: redactSecrets(command),
        reasons: safety.reasons,
      },
      auto,
    );
    if (!approved) return { ok: false, content: 'Command was not approved.' };

    const result = await runShell(command, {
      cwd,
      timeoutMs: options.timeoutMs,
      maxOutputBytes: 80_000,
    });
    const changedFiles = await this.gitChangedFiles();
    const content = truncateForModel(
      summarizeShellResult(result),
      this.options.settings.agent.maxToolOutputChars,
    );
    return {
      ok: result.code === 0 && !result.timedOut,
      content,
      changedFiles,
      metadata: { exitCode: result.code, timedOut: result.timedOut },
    };
  }

  private async gitChangedFiles(): Promise<string[]> {
    const result = await runProcess('git', ['status', '--porcelain=v1'], {
      cwd: this.options.root,
      timeoutMs: 10_000,
      maxOutputBytes: 200_000,
    });
    if (result.spawnError || result.code !== 0) return [];
    return parseChangedFiles(result.stdout);
  }

  private async gitStatus(): Promise<ToolResult> {
    const result = await runProcess('git', ['status', '--porcelain=v1', '-b'], {
      cwd: this.options.root,
      timeoutMs: 10_000,
      maxOutputBytes: 200_000,
    });
    if (result.spawnError || result.code !== 0) {
      return { ok: false, content: 'Not a git repository or git is unavailable.' };
    }
    const changed = parseChangedFiles(result.stdout);
    return {
      ok: true,
      content: `Git status:\n${result.stdout.trim() || 'clean'}`,
      changedFiles: changed,
    };
  }

  private async gitDiff(args: unknown): Promise<ToolResult> {
    const parsed = this.parse(diffSchema, args);
    if (!parsed.ok) return parsed.result;
    const gitArgs = ['diff', '--no-color'];
    if (parsed.data.staged) gitArgs.push('--cached');
    if (parsed.data.path) {
      const absolute = this.guard.resolvePath(parsed.data.path);
      gitArgs.push('--', this.guard.relative(absolute));
    }
    const result = await runProcess('git', gitArgs, {
      cwd: this.options.root,
      timeoutMs: 20_000,
      maxOutputBytes: 400_000,
    });
    if (result.spawnError || result.code !== 0) {
      return { ok: false, content: 'Unable to produce a git diff. Is this a git repository?' };
    }
    if (!result.stdout.trim()) {
      const status = await this.gitStatus();
      return {
        ok: true,
        content: `No ${parsed.data.staged ? 'staged' : 'unstaged'} diff. ${status.content}`,
      };
    }
    const max = parsed.data.max_chars ?? 30_000;
    return {
      ok: true,
      content: truncateForModel(result.stdout, max),
      diff: result.stdout.slice(0, 100_000),
    };
  }

  private updatePlan(args: unknown): ToolResult {
    const parsed = this.parse(planSchema, args);
    if (!parsed.ok) return parsed.result;
    const steps = parsed.data.steps.map((entry) =>
      typeof entry === 'string'
        ? { title: entry, status: 'pending' as const }
        : { title: entry.title, status: entry.status ?? ('pending' as const) },
    );
    const plan: TaskPlan = {
      summary: parsed.data.summary,
      steps,
      updatedAt: new Date().toISOString(),
    };
    this.options.onPlan?.(plan);
    return {
      ok: true,
      content: `Plan saved:\n${steps.map((step) => `- [${step.status}] ${step.title}`).join('\n')}`,
      metadata: { plan },
    };
  }

  private taskComplete(args: unknown): ToolResult {
    const parsed = this.parse(completeSchema, args);
    if (!parsed.ok) return parsed.result;
    this.options.onTaskComplete?.(parsed.data.summary);
    return { ok: true, content: 'Task marked complete.' };
  }

  private useSkill(args: unknown): ToolResult {
    const parsed = this.parse(skillSchema, args);
    if (!parsed.ok) return parsed.result;
    const skills = this.options.skills ?? [];
    if (skills.length === 0) {
      return { ok: false, content: 'No skills are available in this project.' };
    }
    const skill = findSkill(skills, parsed.data.name);
    if (!skill) {
      const names = skills.map((entry) => entry.name).join(', ');
      return { ok: false, content: `Unknown skill "${parsed.data.name}". Available: ${names}` };
    }
    return {
      ok: true,
      content: `# Skill: ${skill.name}\n${skill.description}\n\n${skill.content}`,
      metadata: { skill: skill.name, source: skill.source },
    };
  }

  private async environmentInfo(): Promise<ToolResult> {
    const detected = this.options.inspector.detectCommands();
    const snapshot = await this.options.inspector.snapshot();
    return {
      ok: true,
      content: [
        `OS: ${process.platform} ${process.arch}`,
        `Node: ${process.version}`,
        `Project: ${snapshot.name} (${snapshot.root})`,
        `Git: ${snapshot.git.isRepo ? `${snapshot.git.branch ?? 'detached'}${snapshot.git.status ? ' (dirty)' : ' (clean)'}` : 'not a repository'}`,
        `Package manager: ${detected.packageManager ?? 'none detected'}`,
        `Test: ${detected.test ?? 'none'}`,
        `Lint: ${detected.lint ?? 'none'}`,
        `Build: ${detected.build ?? 'none'}`,
        `Environment variables provided to commands exclude known credential names.`,
      ].join('\n'),
    };
  }
}

export function toolEnvSummary(): string {
  return `node=${process.version} platform=${process.platform} shell=${sanitizedEnvironment().ComSpec ? 'cmd' : 'sh'}`;
}
