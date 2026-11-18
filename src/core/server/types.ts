/**
 * Web server contracts for the ComiCode dashboard.
 *
 * The HTTP layer in this folder talks to a decoupled {@link DataProvider}
 * interface instead of importing the agent/store directly, so the server can
 * run standalone (in-memory demo data) or be wired to the real ComiCode engine
 * from the CLI host later.
 */
import type { ModelInfo, ProviderProfile, TaskPlan, TaskRecord } from '../types.js';

/** A tool call as surfaced to the UI (id + name + JSON arguments). */
export interface ServerToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ServerToolResult {
  ok: boolean;
  content: string;
  changedFiles?: string[];
}

export type ServerChatEventType = 'status' | 'text' | 'tool' | 'plan' | 'stage' | 'done' | 'error';

export interface ServerChatEvent {
  type: ServerChatEventType;
  [key: string]: unknown;
}

/** Team-pipeline stage info sent to the dashboard. */
export interface ServerStageEvent {
  stage: string;
  label?: string;
  department?: string;
  status?: 'start' | 'done' | 'error';
  index?: number;
  total?: number;
  model?: string;
  icon?: string;
}

export interface ServerChatHandlers {
  onStatus?: (status: { state: string; label?: string; detail?: string }) => void;
  onText?: (delta: string) => void;
  onToolStart?: (call: ServerToolCall) => void;
  onToolResult?: (call: ServerToolCall, result: ServerToolResult) => void;
  onPlan?: (plan: TaskPlan | null) => void;
  onStage?: (stage: string | ServerStageEvent) => void;
  onDone?: (result: { status: string; summary: string | null; taskId: string | null }) => void;
  onError?: (error: { message: string; category?: string }) => void;
}

export interface ServerChatOutcome {
  taskId: string | null;
}

/**
 * Decoupled data/provider contract implemented by the real ComiCode store +
 * agent wiring (injected later) and by the in-memory demo provider shipped here.
 */
export interface DataProvider {
  listProfiles(): ProviderProfile[] | Promise<ProviderProfile[]>;
  listModels(): ModelInfo[] | Promise<ModelInfo[]>;
  listTasks(): TaskRecord[] | Promise<TaskRecord[]>;
  getTask(id: string): TaskRecord | null | Promise<TaskRecord | null>;
  sendPrompt(text: string, handlers: ServerChatHandlers): Promise<ServerChatOutcome>;
  approve(id: string, decision: 'allow' | 'always' | 'deny'): Promise<void>;
}
