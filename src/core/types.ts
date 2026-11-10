export type AccessClassification =
  'free-confirmed' | 'free-tier' | 'paid' | 'user-free' | 'user-paid' | 'unknown' | 'unavailable';

export type TaskType = 'coding' | 'reasoning' | 'review' | 'vision' | 'general';

export type TaskStatus = 'planning' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

export type TaskPhase =
  'intake' | 'inspect' | 'plan' | 'implement' | 'test' | 'review' | 'summarize' | 'paused' | 'done';

export const TASK_PHASES: TaskPhase[] = [
  'intake',
  'inspect',
  'plan',
  'implement',
  'test',
  'review',
  'summarize',
  'paused',
  'done',
];

export type ErrorCategory =
  | 'rate_limit'
  | 'daily_quota'
  | 'provider_outage'
  | 'network'
  | 'invalid_api_key'
  | 'auth_failure'
  | 'permission_error'
  | 'model_unavailable'
  | 'unsupported_tool_calling'
  | 'context_length'
  | 'billing_restriction'
  | 'invalid_request'
  | 'cancelled'
  | 'unknown';

export type ProviderKind = 'gemini' | 'groq' | 'openrouter' | 'openai' | 'custom';

export interface ProviderDefinition {
  id: ProviderKind;
  name: string;
  description: string;
  adapter: 'gemini' | 'openai-compatible';
  defaultBaseUrl: string;
  authType: 'api-key' | 'bearer';
  docsUrl: string;
  keyHint: string;
  supportsModelDiscovery: boolean;
  customBaseUrl: boolean;
}

export interface ProviderProfile {
  id: string;
  providerId: ProviderKind;
  name: string;
  baseUrl: string;
  authType: 'api-key' | 'bearer';
  defaultModel: string | null;
  apiKeyEnv: string | null;
  enabled: boolean;
  accessClassification: AccessClassification;
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  lastSuccessAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  lastCheckedAt: string | null;
  modelsRefreshedAt: string | null;
}

export interface ModelInfo {
  /** Stable key: providerId[:profileId]:modelId */
  id: string;
  providerId: ProviderKind;
  /** Custom endpoints scope models to a profile so multiple endpoints can coexist. */
  profileId: string | null;
  modelId: string;
  displayName: string;
  contextWindow: number | null;
  maxOutputTokens: number | null;
  supportsTools: boolean;
  supportsStreaming: boolean;
  supportsVision: boolean;
  codingSuitability: number;
  reasoningSuitability: number;
  inputPricePerMillion: number | null;
  outputPricePerMillion: number | null;
  access: AccessClassification;
  accessSource: string;
  accessNotes: string | null;
  available: boolean;
  lastCheckedAt: string | null;
  userClassification: AccessClassification | null;
  metadata: Record<string, unknown>;
}

export type ToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type AgentMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; name: string; content: string; isError?: boolean };

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface ChatRequest {
  model: string;
  messages: AgentMessage[];
  tools?: ToolDefinition[];
  temperature?: number;
  maxOutputTokens?: number;
}

export interface ChatResponse {
  content: string;
  toolCalls: ToolCall[];
  usage: TokenUsage | null;
  finishReason: string | null;
}

export type StreamEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'tool-call'; toolCall: ToolCall }
  | { type: 'usage'; usage: TokenUsage }
  | { type: 'finish'; reason: string | null };

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface DiscoveredModel {
  modelId: string;
  displayName: string;
  contextWindow?: number | null;
  maxOutputTokens?: number | null;
  supportsTools?: boolean;
  supportsStreaming?: boolean;
  supportsVision?: boolean;
  inputPricePerMillion?: number | null;
  outputPricePerMillion?: number | null;
  metadata?: Record<string, unknown>;
}

export interface ProjectRef {
  path: string;
  name: string;
  taskId: string;
}

export interface AgentAuthority {
  allowFileWrites: boolean;
  allowCommands: boolean;
  allowDangerousCommands: boolean;
  allowSecrets: boolean;
  allowGitWrite: boolean;
}

export interface RouteCandidate {
  profile: ProviderProfile;
  model: ModelInfo;
}

export interface RouteAttemptFailure {
  profileId: string;
  modelId: string;
  category: ErrorCategory;
  at: string;
}

export interface RouteDecision {
  candidate: RouteCandidate;
  reason: string;
  fallbackChain: Array<{ profileId: string; profileName: string; modelId: string; reason: string }>;
  blocked: Array<{ profileId: string | null; modelId: string | null; reason: string }>;
}

export interface PlanStep {
  title: string;
  status: 'pending' | 'in_progress' | 'completed' | 'skipped';
}

export interface TaskPlan {
  summary: string;
  steps: PlanStep[];
  updatedAt: string;
}

export interface TaskRecord {
  id: string;
  projectPath: string;
  projectName: string;
  userRequest: string;
  taskType: TaskType;
  status: TaskStatus;
  phase: TaskPhase;
  plan: TaskPlan | null;
  completedSteps: string[];
  pendingSteps: string[];
  relevantFiles: string[];
  changedFiles: string[];
  currentProfileId: string | null;
  currentModelId: string | null;
  attempts: RouteAttemptFailure[];
  metadata: Record<string, unknown>;
  summary: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  resumeCount: number;
  lastCheckpointId: string | null;
}

export interface StoredMessage {
  id: number;
  taskId: string;
  seq: number;
  role: string;
  content: string;
  toolCalls: ToolCall[] | null;
  toolCallId: string | null;
  name: string | null;
  isError: boolean;
  tokenEstimate: number;
  createdAt: string;
}

export interface CheckpointRecord {
  id: string;
  taskId: string;
  seq: number;
  state: CheckpointState;
  createdAt: string;
}

export interface CheckpointState {
  task: TaskRecord;
  messages: AgentMessage[];
  summary: string;
  contextCache: Record<string, { hash: string; sentAt: string; note: string }>;
  recentToolOutputs: Array<{ name: string; content: string; at: string }>;
  savedAt: string;
}

export interface UsageAggregate {
  providerId: string;
  modelId: string;
  profileId: string;
  inputTokens: number;
  outputTokens: number;
  events: number;
  costEstimate: number | null;
}

export interface ProviderLimit {
  profileId: string;
  modelId: string;
  category: ErrorCategory;
  message: string | null;
  retryAfterAt: string | null;
  resetAt: string | null;
  attempts: number;
  updatedAt: string;
  active: boolean;
}

export interface RoutingEvent {
  id: number;
  taskId: string | null;
  fromProfileId: string | null;
  fromModelId: string | null;
  toProfileId: string | null;
  toModelId: string | null;
  reason: string;
  category: string | null;
  createdAt: string;
}

export interface ProviderHealthRecord {
  id: number;
  profileId: string;
  ok: boolean;
  latencyMs: number | null;
  category: string | null;
  message: string | null;
  createdAt: string;
}

export interface ResumeSummary {
  taskId: string;
  userRequest: string;
  phase: TaskPhase;
  completedSteps: string[];
  pendingSteps: string[];
  changedFiles: string[];
  recentTools: string[];
  projectState: string;
  currentModel: string | null;
}
