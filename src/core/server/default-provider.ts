/**
 * Default in-memory {@link DataProvider} used when no real provider is wired
 * into the web server. Streams scripted demo events so the dashboard is always
 * explorable (`comicode serve` with no engine wiring).
 */
import type { ModelInfo, ProviderProfile, TaskRecord, TaskStatus, TaskType } from '../types.js';
import type {
  DataProvider,
  ServerChatHandlers,
  ServerChatOutcome,
  ServerToolCall,
  ServerToolResult,
} from './types.js';

interface DemoProfile {
  id: string;
  providerId: string;
  name: string;
  baseUrl: string;
  authType: 'api-key' | 'bearer';
  defaultModel: string | null;
  enabled: boolean;
  accessClassification: string;
  lastError: string | null;
}

const DEMO_PROFILES: DemoProfile[] = [
  {
    id: 'prof-openai-demo',
    providerId: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    authType: 'bearer',
    defaultModel: 'gpt-4o',
    enabled: true,
    accessClassification: 'paid',
    lastError: null,
  },
  {
    id: 'prof-groq-demo',
    providerId: 'groq',
    name: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    authType: 'bearer',
    defaultModel: 'llama-3.3-70b-versatile',
    enabled: true,
    accessClassification: 'free-confirmed',
    lastError: null,
  },
];

const DEMO_MODELS: Array<Record<string, unknown>> = [
  {
    id: 'openai:gpt-4o',
    providerId: 'openai',
    profileId: null,
    modelId: 'gpt-4o',
    displayName: 'GPT-4o',
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    codingSuitability: 5,
    reasoningSuitability: 4,
    inputPricePerMillion: 2.5,
    outputPricePerMillion: 10,
    access: 'paid',
    accessSource: 'curated',
    accessNotes: 'Paid tier.',
    available: true,
    lastCheckedAt: new Date().toISOString(),
  },
  {
    id: 'groq:llama-3.3-70b-versatile',
    providerId: 'groq',
    profileId: null,
    modelId: 'llama-3.3-70b-versatile',
    displayName: 'Llama 3.3 70B Versatile',
    contextWindow: 131_072,
    maxOutputTokens: 8_192,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    codingSuitability: 4,
    reasoningSuitability: 5,
    inputPricePerMillion: 0,
    outputPricePerMillion: 0,
    access: 'free-confirmed',
    accessSource: 'curated',
    accessNotes: 'Free tier confirmed.',
    available: true,
    lastCheckedAt: new Date().toISOString(),
  },
];

function demoTask(id: string, userRequest: string, status: TaskStatus, phase: string): TaskRecord {
  const now = new Date().toISOString();
  return {
    id,
    projectPath: '/workspace/comicode',
    projectName: 'comicode',
    userRequest,
    taskType: 'coding' as TaskType,
    status,
    phase: phase as TaskRecord['phase'],
    plan:
      status === 'completed'
        ? {
            summary: 'Inspect context, draft plan, implement, verify.',
            steps: [
              { title: 'Inspect repository layout', status: 'completed' },
              { title: 'Draft implementation plan', status: 'completed' },
              { title: 'Implement changes', status: 'completed' },
              { title: 'Run verification', status: 'completed' },
            ],
            updatedAt: now,
          }
        : null,
    completedSteps: [],
    pendingSteps: ['Inspect repository layout', 'Draft implementation plan', 'Implement changes', 'Run verification'],
    relevantFiles: [],
    changedFiles: [],
    currentProfileId: 'prof-groq-demo',
    currentModelId: 'llama-3.3-70b-versatile',
    attempts: [],
    metadata: { createdBy: 'web-demo' },
    summary: status === 'completed' ? 'Demo task completed.' : null,
    error: null,
    createdAt: now,
    updatedAt: now,
    completedAt: status === 'completed' ? now : null,
    resumeCount: 0,
    lastCheckpointId: null,
  };
}

/**
 * Demo engine: replays a scripted agent run so the UI can be explored and
 * screenshotted without any provider credentials.
 */
export class InMemoryDataProvider implements DataProvider {
  readonly profiles: DemoProfile[] = [...DEMO_PROFILES];
  readonly models: Array<Record<string, unknown>> = [...DEMO_MODELS];

  private tasks: TaskRecord[] = [demoTask('task-demo-1', 'Add streaming progress to the agent loop', 'completed', 'done')];
  private taskSeq = 1;
  private approvalSeq = 0;

  async listProfiles(): Promise<ProviderProfile[]> {
    return this.profiles.map((profile) => ({ ...profile })) as unknown as ProviderProfile[];
  }

  async listModels(): Promise<ModelInfo[]> {
    return this.models.map((model) => ({ ...model })) as unknown as ModelInfo[];
  }

  async listTasks(): Promise<TaskRecord[]> {
    return this.tasks.map((task) => ({ ...task }));
  }

  async getTask(id: string): Promise<TaskRecord | null> {
    const task = this.tasks.find((entry) => entry.id === id);
    return task ? { ...task } : null;
  }

  async sendPrompt(text: string, handlers: ServerChatHandlers): Promise<ServerChatOutcome> {
    const taskId = `task-demo-${++this.taskSeq}`;
    this.tasks.unshift(
      demoTask(taskId, text, 'running', 'intake'),
    );

    const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

    try {
      handlers.onStatus?.({ state: 'running', label: 'Working', detail: taskId });
      handlers.onStage?.('intake');
      await sleep(320);
      handlers.onStage?.('inspect');
      await sleep(420);
      handlers.onText?.('Scanning the workspace to ground the plan in reality.');
      await sleep(240);

      const toolCall: ServerToolCall = {
        id: `call-demo-${this.taskSeq}`,
        name: 'read-file',
        arguments: { path: 'src/core/agent/agent.ts' },
      };
      handlers.onStatus?.({ state: 'tool', label: toolCall.name, detail: String(toolCall.arguments.path ?? '') });
      handlers.onToolStart?.(toolCall);
      await sleep(480);
      const toolResult: ServerToolResult = {
        ok: true,
        content: 'export class CodingAgent { /* … */ }',
        changedFiles: [],
      };
      handlers.onToolResult?.(toolCall, toolResult);

      handlers.onStage?.('plan');
      await sleep(540);
      handlers.onPlan?.({
        summary: 'Inspect context, draft plan, implement, verify.',
        steps: [
          { title: 'Inspect repository layout', status: 'completed' as const },
          { title: 'Draft implementation plan', status: 'in_progress' as const },
          { title: 'Implement changes', status: 'pending' as const },
          { title: 'Run verification', status: 'pending' as const },
        ],
        updatedAt: new Date().toISOString(),
      });
      await sleep(620);

      handlers.onStage?.('implement');
      await sleep(380);
      handlers.onText?.('Drafting the implementation against the inspected context.');
      await sleep(340);
      const grepCall: ServerToolCall = { ...toolCall, id: `call-demo-grep-${this.taskSeq}`, name: 'grep' };
      handlers.onToolStart?.(grepCall);
      handlers.onToolResult?.(grepCall, { ok: true, content: 'src/core/agent/agent.ts:12 matches for "run"' });
      await sleep(420);
      handlers.onStage?.('test');
      await sleep(380);
      handlers.onStage?.('review');
      await sleep(420);

      handlers.onText?.('\n\nFinal summary: the streamed response above reflects the current plan. Verification step queued for the touched surface.');
      await sleep(220);

      handlers.onStatus?.({ state: 'completed', label: 'Completed', detail: taskId });
      handlers.onDone?.({ status: 'completed', summary: 'Demo task completed.', taskId });
      return { taskId };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      handlers.onError?.({ message });
      handlers.onDone?.({ status: 'failed', summary: null, taskId });
      return { taskId };
    }
  }

  async approve(_id: string, _decision: 'allow' | 'always' | 'deny'): Promise<void> {
    this.approvalSeq += 1;
  }
}
