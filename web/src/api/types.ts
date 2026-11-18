export interface Quota {
  used: number;
  limit: number;
}

export interface ProviderInfo {
  id: string;
  name: string;
  providerId: string;
  enabled: boolean;
  defaultModel?: string;
  quota?: Quota;
}

export type ModelAccess = "free" | "paid";

export interface ModelInfo {
  id: string;
  modelId: string;
  displayName: string;
  providerId: string;
  profileId: string;
  access: ModelAccess;
  available: boolean;
}

export type TaskStatus = "queued" | "running" | "idle" | "done" | "error";

export interface TaskStep {
  title: string;
  status: "pending" | "running" | "done" | "error";
}

export interface Task {
  id: string;
  userRequest: string;
  status: TaskStatus;
  phase?: string;
  summary?: string | null;
  createdAt: string;
  updatedAt?: string;
  steps?: TaskStep[];
}

export interface HealthInfo {
  status?: string;
  [key: string]: unknown;
}

export interface StatusResponse {
  version: string;
  uptime: number;
  providers?: ProviderInfo[];
  models?: ModelInfo[];
  activeTasks?: Task[];
  mode?: string;
  health?: HealthInfo;
}

export interface PlanStep {
  title: string;
  status: "pending" | "running" | "done" | "error";
}

export interface Plan {
  summary?: string;
  steps?: PlanStep[];
}

export interface StatusEvent {
  type: "status";
  state: string;
  label?: string;
  detail?: string;
}

export interface TextEvent {
  type: "text";
  delta: string;
}

export interface ToolEvent {
  type: "tool";
  id: string;
  name: string;
  arguments?: string;
  phase: "start" | "result";
  ok?: boolean;
  content?: string;
}

export interface PlanEvent {
  type: "plan";
  plan: Plan | null;
}

export interface StageEvent {
  type: "stage";
  stage: string;
  label?: string;
  department?: string;
  status: "start" | "done" | "error";
  index?: number;
  total?: number;
  model?: string;
  icon?: string;
}

export interface ErrorEvent {
  type: "error";
  message: string;
}

export interface DoneEvent {
  type: "done";
  status: string;
  summary: string | null;
  taskId: string | null;
}

export type ChatEvent =
  | StatusEvent
  | TextEvent
  | ToolEvent
  | PlanEvent
  | StageEvent
  | ErrorEvent
  | DoneEvent;
