import type {
  ChatResponse,
  ErrorCategory,
  RouteCandidate,
  RouteDecision,
  TokenUsage,
  ToolCall,
} from '../types.js';

export interface ConfirmationRequest {
  kind:
    | 'file-write'
    | 'file-delete'
    | 'command'
    | 'dangerous-command'
    | 'secret-read'
    | 'task-delete'
    | 'provider-switch'
    | 'ui-verify';
  title: string;
  description: string;
  path?: string;
  command?: string;
  diff?: string;
  reasons?: string[];
}

/**
 * Outcome of an approval prompt.
 * - `allow`: approve this single action.
 * - `always`: approve and persist a grant so matching future actions skip the prompt.
 * - `deny`: refuse the action.
 */
export type ConfirmDecision = 'allow' | 'always' | 'deny';

export type ConfirmFn = (request: ConfirmationRequest) => Promise<ConfirmDecision>;

export interface ToolResult {
  ok: boolean;
  content: string;
  changedFiles?: string[];
  diff?: string;
  metadata?: Record<string, unknown>;
}

export interface AgentHooks {
  confirm?: ConfirmFn;
  onText?: (delta: string) => void;
  onAssistantMessage?: (content: string) => void;
  onToolStart?: (call: ToolCall) => void;
  onToolResult?: (call: ToolCall, result: ToolResult) => void;
  onRoute?: (decision: RouteDecision) => void;
  onPhase?: (phase: string) => void;
  onPlan?: (plan: unknown) => void;
  onUsage?: (usage: TokenUsage, candidate: RouteCandidate, estimated: boolean) => void;
  onCheckpoint?: (checkpointId: string) => void;
  onRetry?: (info: {
    attempt: number;
    delayMs: number;
    category: ErrorCategory;
    message: string;
  }) => void;
  onNotice?: (message: string) => void;
  onTaskComplete?: (summary: string | null) => void;
  onPaused?: (reason: string) => void;
  onReview?: (review: string) => void;
}

export interface AgentResult {
  status: 'completed' | 'paused' | 'failed' | 'cancelled';
  taskId: string;
  summary: string | null;
  pauseReason: string | null;
  finalResponse: string | null;
  usage: { inputTokens: number; outputTokens: number };
  steps: number;
}

export interface AgentRunOptions {
  resume?: boolean;
  signal?: AbortSignal;
  maxSteps?: number;
}

export interface ChatTurn {
  response: ChatResponse;
  candidate: RouteCandidate;
  estimatedUsage: boolean;
}

export interface AgentContext {
  system: string;
  contextText: string;
  messages: import('../types.js').AgentMessage[];
  summary: string;
}
