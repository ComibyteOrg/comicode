import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentMessage, CheckpointState, ModelInfo, TaskRecord } from '../types.js';
import type { AppSettings } from '../settings.js';
import type { ProjectInspector } from '../project/inspector.js';
import { isSecretFile } from '../safety/secrets.js';
import { isBinaryBuffer } from '../safety/files.js';
import { createHash } from 'node:crypto';
import { formatSkillsSection, type AgentSkill } from './skills.js';
import { AGENT_MODES, type AgentMode } from './modes.js';

export type ContextCache = CheckpointState['contextCache'];

export interface ContextBuildInput {
  task: TaskRecord;
  model: ModelInfo;
  history: AgentMessage[];
  settings: AppSettings;
  inspector: ProjectInspector;
  relevantFiles: Array<{ path: string; reason: string }>;
  cache: ContextCache;
  summary?: string;
  resumeNote?: string;
  projectSummary?: string;
  skills?: AgentSkill[];
  mode?: AgentMode;
  effortHint?: string;
}

export interface BuiltContext {
  system: string;
  contextText: string;
  messages: AgentMessage[];
  summary: string;
  cache: ContextCache;
  estimatedTokens: number;
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export const COMI_SYSTEM_PROMPT = `You are ComiCode, a precise, tool-using coding agent running inside the user's terminal.
You modify a real project on the user's machine. Accuracy and safety matter more than speed.

Operating rules:
1. Understand before changing. Inspect the project structure and read relevant files first. Use tools instead of guessing.
2. Keep changes focused on the user's request. Avoid unrelated refactors and do not delete code without a reason.
3. Use the provided tools. Never claim you ran a command, read a file, or saw output unless a tool actually returned it.
4. Prefer edit_file or apply_patch over rewriting whole files. Use write_file only for new files or deliberate full rewrites.
5. Verify work: run focused tests, lint, or build when available. Fix failures you introduced.
6. Commands and writes may require user approval. If approval is denied, adapt or stop and explain. Never try to bypass safety checks.
7. Never exfiltrate secrets. Do not open .env files, private keys, or credential stores unless the user explicitly requested it and approved access. Never place API keys in source code or logs.
8. Do not modify .git/ or .comicode/ internals.
9. Use update_plan for multi-step work, and call task_complete when the task is genuinely finished. Summarize changed files, tests run, and unresolved caveats.
10. Keep assistant messages concise. Large file contents belong in tools, not in prose.
11. Context may be summarized or pruned. If you need an exact current file, read it again. On resume, verify the working tree instead of assuming your previous changes are present.
12. Paths are relative to the project root. Work only inside this project. Shell commands can access the machine, so treat them with care.
13. If no suitable model/provider is available, the task will pause. Do not pretend work succeeded.
14. You cannot ask the user interactive questions mid-task. Make reasonable, minimal decisions and state assumptions in the final summary.

You are not a chatbot that only suggests code. You are expected to inspect, edit, and verify the project with tools.`;

const CONTENT_LIMIT_PER_FILE = 7000;
const MAX_CONTEXT_FILES = 10;

function fileExcerpt(
  path: string,
  root: string,
  maxChars: number,
): { text: string; hash: string } | null {
  if (isSecretFile(path)) return null;
  try {
    const buffer = readFileSync(join(root, path));
    if (isBinaryBuffer(buffer) || buffer.length > 800_000) return null;
    const full = buffer.toString('utf8');
    const hash = createHash('sha256').update(buffer).digest('hex');
    let text = full;
    if (text.length > maxChars) {
      const lines = text.split(/\r?\n/);
      const head = lines.slice(0, Math.max(40, Math.floor(lines.length * 0.5))).join('\n');
      text = `${head}\n... [file truncated for context: ${lines.length} lines total] ...`;
      if (text.length > maxChars) text = text.slice(0, maxChars);
    }
    return { text, hash };
  } catch {
    return null;
  }
}

function summarizeDropped(messages: AgentMessage[]): string {
  if (messages.length === 0) return '';
  const parts: string[] = [];
  for (const message of messages.slice(-30)) {
    if (message.role === 'user') {
      parts.push(`User: ${message.content.replace(/\s+/g, ' ').slice(0, 220)}`);
    } else if (message.role === 'assistant') {
      const tools = message.toolCalls?.map((call) => call.name).join(', ');
      const text = message.content.replace(/\s+/g, ' ').slice(0, 160);
      parts.push(`Assistant${text ? `: ${text}` : ''}${tools ? ` [tools: ${tools}]` : ''}`);
    } else if (message.role === 'tool') {
      parts.push(
        `Tool ${message.name}${message.isError ? ' (error)' : ''}: ${message.content
          .replace(/\s+/g, ' ')
          .slice(0, 180)}`,
      );
    }
  }
  return parts.join('\n');
}

interface Block {
  messages: AgentMessage[];
  chars: number;
}

/** Group assistant tool calls with their tool results so pruning never orphans a result. */
function toBlocks(messages: AgentMessage[]): Block[] {
  const blocks: Block[] = [];
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (!message) continue;
    if (message.role === 'tool') {
      // Orphan tool result; keep it locally with the previous block.
      const last = blocks[blocks.length - 1];
      if (last) {
        last.messages.push(message);
        last.chars += message.content.length;
      } else {
        blocks.push({ messages: [message], chars: message.content.length });
      }
      continue;
    }
    if (message.role === 'assistant' && message.toolCalls?.length) {
      const group: AgentMessage[] = [message];
      let chars = message.content.length;
      let cursor = index + 1;
      while (cursor < messages.length && messages[cursor]?.role === 'tool') {
        const toolMessage = messages[cursor]!;
        group.push(toolMessage);
        chars += toolMessage.content.length;
        cursor += 1;
      }
      blocks.push({ messages: group, chars });
      index = cursor - 1;
      continue;
    }
    blocks.push({ messages: [message], chars: message.content.length });
  }
  return blocks;
}

export function pruneHistory(
  messages: AgentMessage[],
  maxChars: number,
): { messages: AgentMessage[]; summary: string; dropped: number } {
  if (messages.reduce((sum, message) => sum + message.content.length, 0) <= maxChars) {
    return { messages, summary: '', dropped: 0 };
  }
  const blocks = toBlocks(messages);
  const kept: Block[] = [];
  let total = 0;
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index]!;
    if (kept.length >= 2 && total + block.chars > maxChars) break;
    kept.unshift(block);
    total += block.chars;
  }
  const keptCount = kept.reduce((sum, block) => sum + block.messages.length, 0);
  const droppedMessages = messages.slice(0, Math.max(0, messages.length - keptCount));
  return {
    messages: kept.flatMap((block) => block.messages),
    summary: summarizeDropped(droppedMessages),
    dropped: droppedMessages.length,
  };
}

export class ContextBuilder {
  build(input: ContextBuildInput): BuiltContext {
    const { task, model, settings, inspector, relevantFiles, cache } = input;
    const contextWindow = model.contextWindow ?? 128_000;
    const ratio = settings.agent.contextBudgetRatio;
    const maxPromptChars = Math.max(12_000, Math.floor(contextWindow * ratio * 4));
    const reserveForHistory = Math.floor(maxPromptChars * 0.5);
    const contextBudget = Math.max(6000, maxPromptChars - reserveForHistory - 5000);

    const lines: string[] = [];
    lines.push('# Project');
    lines.push(
      (
        input.projectSummary ??
        'Project summary unavailable. Use list_files and read_file to inspect the project.'
      ).slice(0, 12_000),
    );
    lines.push('\n# Task state');
    lines.push(`Task ID: ${task.id}`);
    lines.push(`Project: ${task.projectName} (${task.projectPath})`);
    lines.push(`Phase: ${task.phase} | Status: ${task.status}`);
    lines.push(`User request:\n${task.userRequest.slice(0, 4000)}`);
    if (task.plan) {
      lines.push(`Plan: ${task.plan.summary}`);
      for (const step of task.plan.steps) lines.push(`- [${step.status}] ${step.title}`);
    }
    if (task.pendingSteps.length) {
      lines.push(`Pending steps:\n${task.pendingSteps.map((step) => `- ${step}`).join('\n')}`);
    }
    if (task.completedSteps.length) {
      lines.push(`Completed steps:\n${task.completedSteps.map((step) => `- ${step}`).join('\n')}`);
    }
    if (task.changedFiles.length) {
      lines.push(`Changed files so far: ${task.changedFiles.join(', ')}`);
    }
    if (input.summary) lines.push(`Earlier work summary:\n${input.summary.slice(0, 3000)}`);
    if (input.resumeNote) lines.push(`Resume context:\n${input.resumeNote.slice(0, 5000)}`);

    lines.push('\n# Relevant files');
    const included: string[] = [];
    const unchanged: string[] = [];
    let usedChars = lines.join('\n').length;
    let filesAdded = 0;
    for (const entry of relevantFiles) {
      if (filesAdded >= MAX_CONTEXT_FILES) break;
      if (usedChars >= contextBudget) break;
      const excerpt = fileExcerpt(entry.path, inspector.root, CONTENT_LIMIT_PER_FILE);
      if (!excerpt) continue;
      const cached = cache[entry.path];
      const changedFile = task.changedFiles.includes(entry.path);
      if (cached && cached.hash === excerpt.hash && !changedFile) {
        unchanged.push(entry.path);
        continue;
      }
      const budgetLeft = contextBudget - usedChars;
      if (budgetLeft < 800) break;
      const clipped =
        excerpt.text.length > budgetLeft
          ? `${excerpt.text.slice(0, Math.max(400, budgetLeft - 200))}\n... [clipped to context budget]`
          : excerpt.text;
      lines.push(`\n--- ${entry.path} (${entry.reason}) ---\n${clipped}`);
      usedChars += clipped.length + entry.path.length + 50;
      filesAdded += 1;
      included.push(entry.path);
      cache[entry.path] = {
        hash: excerpt.hash,
        sentAt: new Date().toISOString(),
        note: entry.reason,
      };
    }
    if (filesAdded === 0) {
      lines.push(
        'No new file excerpts were added. Use read_file/search_files when you need content; relevant files may be unchanged since a previous turn.',
      );
    }
    if (unchanged.length) {
      lines.push(
        `\nUnchanged files already provided earlier (read again if exact content is needed): ${unchanged
          .slice(0, 20)
          .join(', ')}`,
      );
    }
    const skillsSection = formatSkillsSection(input.skills ?? []);
    if (skillsSection) lines.push(`\n${skillsSection}`);
    const modeAddendum = input.mode ? AGENT_MODES[input.mode].promptAddendum : '';
    if (modeAddendum) lines.push(`\n${modeAddendum}`);
    if (input.effortHint) lines.push(`\n${input.effortHint}`);
    lines.push(
      '\n# Task breakdown\nFor any request involving multiple files, layers, or steps (e.g. fullstack work), first call update_plan with a concrete decomposition — separate subtasks for each layer/component plus verification — then execute the steps in order, keeping the plan statuses accurate.',
    );

    lines.push(
      '\n# Context guidance\nTool results can be truncated. Use search/read tools for exact current content. Do not assume a file still matches something you saw many turns ago.',
    );

    const contextText = lines.join('\n').slice(0, contextBudget + 6000);

    const historyBudget = Math.max(6000, Math.floor(maxPromptChars * 0.45));
    const pruned = pruneHistory(input.history, historyBudget);
    const summary = [task.summary, pruned.summary].filter(Boolean).join('\n\n');
    const messages: AgentMessage[] = [
      { role: 'system', content: COMI_SYSTEM_PROMPT },
      { role: 'system', content: contextText },
      ...pruned.messages,
    ];
    const estimatedTokens = messages.reduce(
      (sum, message) => sum + estimateTokens(message.content) + 8,
      0,
    );
    return {
      system: COMI_SYSTEM_PROMPT,
      contextText,
      messages,
      summary,
      cache,
      estimatedTokens,
    };
  }
}
