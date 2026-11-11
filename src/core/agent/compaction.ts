/**
 * Context compaction.
 *
 * Compaction never deletes the stored transcript. It writes an inspectable
 * summary and a checkpoint, then records a cutoff so future model calls only
 * send the summary plus later turns. The request, plan, decisions, tool
 * activity, and changed files survive the compaction.
 */
import type { Store } from '../db/store.js';
import type { AgentMessage, StoredMessage, TaskPlan, TaskRecord } from '../types.js';
import { redactSecrets } from '../security/redact.js';

export interface CompactionRecord {
  summary: string;
  at: string;
  cutoffSeq: number;
  messagesCompacted: number;
  files: string[];
  plan: TaskPlan | null;
}

export interface CompactionResult {
  record: CompactionRecord;
  task: TaskRecord;
  preview: {
    request: string;
    status: string;
    phase: string;
    model: string | null;
    plan: TaskPlan | null;
    files: string[];
    messagesCompacted: number;
  };
}

function oneLine(text: string, max: number): string {
  const clean = redactSecrets(text.replace(/\s+/g, ' ').trim());
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function toolArguments(message: StoredMessage): string {
  const calls = message.toolCalls ?? [];
  if (!calls.length) return '';
  return calls
    .map((call) => {
      const raw = oneLine(JSON.stringify(call.arguments ?? {}), 180);
      return `${call.name}(${raw})`;
    })
    .join(', ');
}

function buildWorkLog(stored: StoredMessage[]): string[] {
  const lines: string[] = [];
  // Preserve the earliest user intent in addition to the recent tail.
  const earlyUser = stored.filter((message) => message.role === 'user').slice(0, 3);
  const seen = new Set<number>();
  for (const message of earlyUser) {
    if (message.content.startsWith('[ComiCode resume context]')) continue;
    lines.push(`User: ${oneLine(message.content, 360)}`);
    seen.add(message.id);
  }

  for (const message of stored.slice(-160)) {
    if (message.role === 'user') {
      if (message.id !== undefined && seen.has(message.id)) continue;
      if (message.content.startsWith('[ComiCode resume context]')) continue;
      lines.push(`User: ${oneLine(message.content, 360)}`);
    } else if (message.role === 'assistant') {
      const text = oneLine(message.content, 280);
      const tools = toolArguments(message);
      if (text) lines.push(`Assistant: ${text}`);
      if (tools) lines.push(`  tools: ${tools}`);
    } else if (message.role === 'tool') {
      const firstLine =
        message.content.split(/\r?\n/).find((line) => line.trim()) ?? message.content;
      lines.push(
        `Tool ${message.name ?? 'tool'}${message.isError ? ' (error)' : ''}: ${oneLine(firstLine, 260)}`,
      );
    } else if (message.role === 'system') {
      if (message.content.startsWith('[Reviewer')) {
        lines.push(`Reviewer: ${oneLine(message.content, 320)}`);
      } else if (message.content.startsWith('[ComiCode paused]')) {
        lines.push(`Pause: ${oneLine(message.content, 320)}`);
      }
    }
  }
  return lines;
}

export function buildCompactionSummary(task: TaskRecord, stored: StoredMessage[]): string {
  const parts: string[] = [];
  parts.push('ComiCode context summary');
  parts.push(`Generated: ${new Date().toISOString()}`);
  parts.push(`Task: ${task.id}`);
  parts.push(`Project: ${task.projectName} (${task.projectPath})`);
  parts.push(`Status: ${task.status} | Phase: ${task.phase}`);
  parts.push('');
  parts.push('Original request:');
  parts.push(oneLine(task.userRequest, 2000));

  if (task.plan) {
    parts.push('');
    parts.push(`Plan: ${task.plan.summary}`);
    for (const step of task.plan.steps) {
      parts.push(`- [${step.status}] ${step.title}`);
    }
  }
  if (task.completedSteps.length) {
    parts.push('');
    parts.push('Completed steps:');
    for (const step of task.completedSteps.slice(0, 40)) parts.push(`- ${oneLine(step, 240)}`);
  }
  if (task.pendingSteps.length) {
    parts.push('');
    parts.push('Pending steps:');
    for (const step of task.pendingSteps.slice(0, 40)) parts.push(`- ${oneLine(step, 240)}`);
  }

  const files = [...new Set([...task.changedFiles, ...task.relevantFiles])];
  if (files.length) {
    parts.push('');
    parts.push(
      `Changed files: ${task.changedFiles.length ? task.changedFiles.join(', ') : 'none yet'}`,
    );
    if (task.relevantFiles.length) {
      parts.push(`Relevant files: ${task.relevantFiles.slice(0, 40).join(', ')}`);
    }
  }

  parts.push('');
  parts.push('Work log:');
  const workLog = buildWorkLog(stored);
  parts.push(...workLog);

  const lastAssistant = [...stored]
    .reverse()
    .find((message) => message.role === 'assistant' && message.content.trim());
  if (lastAssistant) {
    parts.push('');
    parts.push('Last assistant message:');
    parts.push(oneLine(lastAssistant.content, 1500));
  }
  if (task.error) {
    parts.push('');
    parts.push(`Last pause/error: ${oneLine(task.error, 1000)}`);
  }
  if (task.summary) {
    parts.push('');
    parts.push('Previous final summary:');
    parts.push(oneLine(task.summary, 1500));
  }

  const text = redactSecrets(parts.join('\n'));
  return text.length > 14_000 ? `${text.slice(0, 14_000)}\n… summary truncated` : text;
}

export function compactTask(store: Store, taskId: string): CompactionResult {
  const task = store.getTask(taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);
  const stored = store.loadStoredMessages(taskId, 10_000);
  if (stored.length === 0) {
    throw new Error('There is no conversation to compact yet.');
  }
  const cutoffSeq = stored[stored.length - 1]?.seq ?? 0;
  const summary = buildCompactionSummary(task, stored);
  const record: CompactionRecord = {
    summary,
    at: new Date().toISOString(),
    cutoffSeq,
    messagesCompacted: stored.length,
    files: [...task.changedFiles],
    plan: task.plan,
  };
  const metadata = { ...task.metadata, compaction: record };
  const updated = store.updateTask(taskId, { metadata });
  const messages: AgentMessage[] = store.loadMessages(taskId, 400);
  const recentToolOutputs = messages
    .filter(
      (message): message is Extract<AgentMessage, { role: 'tool' }> => message.role === 'tool',
    )
    .slice(-8)
    .map((message) => ({
      name: message.name,
      content: message.content.slice(0, 1200),
      at: new Date().toISOString(),
    }));
  store.createCheckpoint(taskId, {
    task: updated,
    messages,
    summary,
    contextCache: {},
    recentToolOutputs,
    savedAt: new Date().toISOString(),
  });
  return {
    record,
    task: updated,
    preview: {
      request: task.userRequest,
      status: task.status,
      phase: task.phase,
      model: task.currentModelId,
      plan: task.plan,
      files: [...task.changedFiles],
      messagesCompacted: stored.length,
    },
  };
}

export function compactionOf(task: TaskRecord): CompactionRecord | null {
  const value = task.metadata.compaction;
  if (!value || typeof value !== 'object') return null;
  const record = value as Partial<CompactionRecord>;
  if (typeof record.summary !== 'string' || typeof record.cutoffSeq !== 'number') return null;
  return record as CompactionRecord;
}
