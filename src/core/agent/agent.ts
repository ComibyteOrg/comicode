import type {
  AgentAuthority,
  AgentMessage,
  ChatResponse,
  ProviderProfile,
  RouteCandidate,
  TaskPlan,
  TaskRecord,
  TokenUsage,
  ToolCall,
} from '../types.js';
import type { AppSettings, RoutingPolicy } from '../settings.js';
import type { Store } from '../db/store.js';
import type { AgentHooks, AgentResult, AgentRunOptions } from './types.js';
import { ProjectInspector } from '../project/inspector.js';
import { Router } from '../routing/router.js';
import { ToolExecutor } from './tools/executor.js';
import { ContextBuilder, estimateTokens, type ContextCache, type BuiltContext } from './context.js';
import { Collaborator, planFromCollaborator } from './collaboration.js';
import { createProfileContext } from '../providers/service.js';
import { createAdapter } from '../providers/registry.js';
import type { AdapterContext, ProviderAdapter } from '../providers/adapter.js';
import { classifyThrown, describeCategory, ProviderError } from '../providers/errors.js';
import type { ErrorCategory } from '../types.js';
import { redactSecrets } from '../security/redact.js';
import { logger } from '../logger.js';

export const DEFAULT_AUTHORITY: AgentAuthority = {
  allowFileWrites: false,
  allowCommands: false,
  allowDangerousCommands: false,
  allowSecrets: false,
  allowGitWrite: false,
};

export interface CodingAgentOptions {
  store: Store;
  taskId: string;
  hooks?: AgentHooks;
  authority?: AgentAuthority;
  settings?: AppSettings;
  /** One-run overrides that do not persist to the database. */
  routingOverrides?: Partial<RoutingPolicy>;
  /** Injection points used by tests and embedding hosts. */
  adapterFactory?: (profile: ProviderProfile) => ProviderAdapter;
  contextFactory?: (profile: ProviderProfile) => Promise<AdapterContext>;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function mergeUnique(base: string[], additions: string[]): string[] {
  const set = new Set(base);
  for (const item of additions) if (item) set.add(item);
  return [...set];
}

export class CodingAgent {
  private readonly store: Store;
  private task: TaskRecord;
  private readonly hooks: AgentHooks;
  private readonly authority: AgentAuthority;
  private settings: AppSettings;
  private readonly inspector: ProjectInspector;
  private readonly router: Router;
  private readonly executor: ToolExecutor;
  private readonly collaborator: Collaborator;
  private readonly builder = new ContextBuilder();
  private readonly adapterFactory: (profile: ProviderProfile) => ProviderAdapter;
  private readonly contextFactory: (profile: ProviderProfile) => Promise<AdapterContext>;

  private contextCache: ContextCache = {};
  private contextSummary = '';
  private relevantFiles: Array<{ path: string; reason: string }> = [];
  private projectSummary = '';
  private candidate: RouteCandidate | null = null;
  private exclude = new Set<string>();
  private retryCounts = new Map<string, number>();
  private contextSlim = false;
  private completionSummary: string | null = null;
  private finalResponse: string | null = null;
  private reviewCycles = 0;
  private lastBlocked: Array<{ profileId: string | null; modelId: string | null; reason: string }> =
    [];
  private usage = { inputTokens: 0, outputTokens: 0 };
  private steps = 0;

  constructor(options: CodingAgentOptions) {
    this.store = options.store;
    const task = options.store.getTask(options.taskId);
    if (!task) throw new Error(`Task not found: ${options.taskId}`);
    this.task = task;
    this.hooks = options.hooks ?? {};
    this.authority = options.authority ?? DEFAULT_AUTHORITY;
    this.settings = options.settings ?? options.store.getSettings();
    this.inspector = new ProjectInspector(task.projectPath);
    this.router = new Router(options.store, options.routingOverrides);
    this.adapterFactory = options.adapterFactory ?? ((profile) => createAdapter(profile));
    this.contextFactory = options.contextFactory ?? ((profile) => createProfileContext(profile));
    this.executor = new ToolExecutor({
      root: task.projectPath,
      settings: this.settings,
      authority: this.authority,
      inspector: this.inspector,
      confirm: this.hooks.confirm,
      onPlan: (plan) => this.applyPlan(plan),
      onTaskComplete: (summary) => {
        this.completionSummary = summary;
      },
      onNotice: (message) => this.hooks.onNotice?.(message),
    });
    this.collaborator = new Collaborator(options.store, this.inspector, this.settings, this.hooks);
  }

  async run(options: AgentRunOptions = {}): Promise<AgentResult> {
    const maxSteps = Math.max(1, Math.min(options.maxSteps ?? this.settings.agent.maxSteps, 200));
    try {
      await this.prepare(options);
      if (options.signal?.aborted) return this.halt('paused', 'Cancelled by user. Progress saved.');
      await this.runPlannerIfEnabled();
      this.setPhase('inspect');
      this.checkpoint('run-start');

      let emptyResponses = 0;

      while (this.steps < maxSteps) {
        if (options.signal?.aborted) {
          return this.halt('paused', 'Cancelled by user. Progress saved.');
        }
        const candidate = this.ensureCandidate();
        if (!candidate) {
          return this.halt('paused', this.buildPauseReason());
        }

        const built = this.buildContext(candidate);
        this.steps += 1;

        let response: ChatResponse;
        try {
          response = await this.callModel(candidate, built, options.signal);
        } catch (error) {
          const outcome = await this.handleFailure(error, candidate, options.signal);
          if (outcome === 'cancel') {
            return this.halt('paused', 'Cancelled by user. Progress saved.');
          }
          this.checkpoint('after-failure');
          continue;
        }

        const usage = this.recordTurnUsage(candidate, built, response);
        this.hooks.onUsage?.(usage, candidate, response.usage === null);

        const assistantMessage: AgentMessage = {
          role: 'assistant',
          content: response.content,
          ...(response.toolCalls.length ? { toolCalls: response.toolCalls } : {}),
        };
        this.store.appendMessage(this.task.id, assistantMessage);
        this.hooks.onAssistantMessage?.(response.content);

        if (response.toolCalls.length > 0) {
          emptyResponses = 0;
          this.checkpoint('assistant-message');
          const completed = await this.executeTools(response.toolCalls, options.signal);
          this.checkpoint('after-tools');
          if (options.signal?.aborted) {
            return this.halt('paused', 'Cancelled by user. Progress saved.');
          }
          if (completed || this.completionSummary) {
            const continueAfterReview = await this.reviewIfEnabled();
            if (continueAfterReview) {
              this.completionSummary = null;
              this.finalResponse = null;
              this.setPhase('implement');
              this.checkpoint('after-review');
              continue;
            }
            return this.complete();
          }
          continue;
        }

        if (!response.content.trim()) {
          emptyResponses += 1;
          if (emptyResponses <= 2 && response.finishReason !== 'content_filter') {
            this.store.appendMessage(this.task.id, {
              role: 'user',
              content:
                'Your previous response was empty. Continue the task with a tool call, or call task_complete with a summary if the work is finished.',
            });
            this.checkpoint('empty-response-nudge');
            continue;
          }
          return this.halt(
            'paused',
            'The model returned empty responses repeatedly. Progress is saved; resume with a different model or provider.',
          );
        }

        emptyResponses = 0;
        this.finalResponse = response.content;
        this.completionSummary = this.completionSummary ?? response.content.slice(0, 8000);
        const continueAfterReview = await this.reviewIfEnabled();
        if (continueAfterReview) {
          this.completionSummary = null;
          this.finalResponse = null;
          this.setPhase('implement');
          this.checkpoint('after-review');
          continue;
        }
        return this.complete();
      }

      return this.halt(
        'paused',
        `Reached the maximum of ${maxSteps} agent steps. Progress and checkpoints are saved. Resume with "comicode resume ${this.task.id}" or raise agent.maxSteps.`,
      );
    } catch (error) {
      logger.error(
        `Agent failure: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
      );
      const message = redactSecrets(error instanceof Error ? error.message : String(error));
      return this.halt('failed', `Agent stopped with an unexpected error: ${message}`);
    }
  }

  // ------------------------------------------------------------------ prepare
  private async prepare(options: AgentRunOptions): Promise<void> {
    if (!this.task.projectPath) throw new Error('Task has no project path.');
    this.settings = this.store.getSettings();
    this.store.clearExpiredLimits();

    if (options.resume) {
      const checkpoint = this.store.latestCheckpoint(this.task.id);
      if (checkpoint?.state?.contextCache) this.contextCache = checkpoint.state.contextCache;
      if (checkpoint?.state?.summary) this.contextSummary = checkpoint.state.summary;
      const projectState = await this.inspector.resumeState(this.task.changedFiles);
      const resume = this.store.buildResumeSummary(this.task.id, projectState);
      const noteParts: string[] = [];
      noteParts.push(
        'This task is being resumed. Do not assume previous edits are still present — verify the working tree with git_status/read_file before repeating completed work.',
      );
      noteParts.push(`Original request:\n${this.task.userRequest}`);
      noteParts.push(`Phase when stopped: ${this.task.phase}`);
      if (this.task.completedSteps.length) {
        noteParts.push(
          `Completed steps:\n${this.task.completedSteps.map((step) => `- ${step}`).join('\n')}`,
        );
      }
      if (this.task.pendingSteps.length) {
        noteParts.push(
          `Pending steps:\n${this.task.pendingSteps.map((step) => `- ${step}`).join('\n')}`,
        );
      }
      if (this.task.changedFiles.length) {
        noteParts.push(`Previously changed files: ${this.task.changedFiles.join(', ')}`);
      }
      if (resume?.recentTools.length) {
        noteParts.push(`Recent tool output (may be stale):\n${resume.recentTools.join('\n')}`);
      }
      noteParts.push(`Current project state:\n${projectState}`);
      if (this.contextSummary)
        noteParts.push(`Earlier summary:\n${this.contextSummary.slice(0, 5000)}`);

      this.store.appendMessage(this.task.id, {
        role: 'user',
        content: `[ComiCode resume context]\n${noteParts.join('\n\n').slice(0, 16_000)}`,
      });
      this.exclude.clear();
      this.retryCounts.clear();
      this.candidate = null;
      this.contextSlim = false;
      this.reviewCycles = 0;
      this.completionSummary = null;
      this.finalResponse = null;
      this.usage = { inputTokens: 0, outputTokens: 0 };
      this.task = this.store.updateTask(this.task.id, {
        status: 'running',
        phase: 'inspect',
        error: null,
        completedAt: null,
        resumeCount: this.task.resumeCount + 1,
        summary: this.task.summary,
      });
    } else {
      if (this.task.status === 'completed') {
        throw new Error('This task is already completed. Start a new task instead.');
      }
      this.task = this.store.updateTask(this.task.id, {
        status: 'running',
        error: null,
        completedAt: null,
      });
    }

    this.repairHistory();

    const snapshot = await this.inspector.snapshot();
    this.projectSummary = snapshot.summaryText;
    const relevant = await this.inspector.relevantFiles(this.task.userRequest, {
      changedFiles: this.task.changedFiles,
      extraFiles: this.task.relevantFiles,
      limit: 18,
    });
    this.relevantFiles = relevant;
    this.task = this.store.updateTask(this.task.id, {
      relevantFiles: mergeUnique(
        this.task.relevantFiles,
        relevant.map((entry) => entry.path),
      ).slice(0, 60),
    });
  }

  private repairHistory(): void {
    const messages = this.store.loadMessages(this.task.id, 1000);
    if (!messages.some((message) => message.role === 'user')) {
      this.store.appendMessage(this.task.id, { role: 'user', content: this.task.userRequest });
      return;
    }
    // Complete tool-call groups interrupted by a crash/terminal closure.
    const lastAssistantIndex = [...messages]
      .map((message, index) =>
        message.role === 'assistant' && message.toolCalls?.length ? index : -1,
      )
      .filter((index) => index >= 0)
      .pop();
    if (lastAssistantIndex === undefined) return;
    const assistant = messages[lastAssistantIndex];
    if (!assistant || assistant.role !== 'assistant' || !assistant.toolCalls) return;
    const subsequent = messages.slice(lastAssistantIndex + 1);
    if (subsequent.some((message) => message.role === 'assistant')) return;
    const answered = new Set(
      subsequent
        .filter(
          (message): message is Extract<AgentMessage, { role: 'tool' }> => message.role === 'tool',
        )
        .map((message) => message.toolCallId),
    );
    for (const call of assistant.toolCalls) {
      if (answered.has(call.id)) continue;
      this.store.appendMessage(this.task.id, {
        role: 'tool',
        toolCallId: call.id,
        name: call.name,
        content:
          'Interrupted before this tool completed. Inspect the project state before retrying.',
        isError: true,
      });
    }
  }

  private async runPlannerIfEnabled(): Promise<void> {
    const collaboration = this.settings.agent.collaboration;
    if (!collaboration.enabled || !collaboration.plannerProfileId) return;
    if (this.task.plan) return;
    this.setPhase('plan');
    const result = await this.collaborator.plan(this.task, this.projectSummary);
    if (!result) return;
    const plan = planFromCollaborator(result.text);
    this.applyPlan(plan);
    this.store.appendMessage(this.task.id, {
      role: 'system',
      content: `[Planner ${result.modelId}]\n${result.text.slice(0, 6000)}`,
    });
    this.checkpoint('planner');
  }

  private applyPlan(plan: TaskPlan): void {
    const completed = plan.steps
      .filter((step) => step.status === 'completed' || step.status === 'skipped')
      .map((step) => step.title);
    const pending = plan.steps
      .filter((step) => step.status !== 'completed' && step.status !== 'skipped')
      .map((step) => step.title);
    this.task = this.store.updateTask(this.task.id, {
      plan,
      completedSteps: completed,
      pendingSteps: pending,
      phase:
        this.task.phase === 'intake' || this.task.phase === 'inspect' ? 'plan' : this.task.phase,
    });
    this.hooks.onPlan?.(plan);
  }

  // ---------------------------------------------------------------- routing
  private ensureCandidate(): RouteCandidate | null {
    if (this.candidate) {
      const profile = this.store.getProfile(this.candidate.profile.id);
      const limit =
        this.store.getLimit(this.candidate.profile.id, this.candidate.model.modelId) ??
        this.store.getLimit(this.candidate.profile.id, '*');
      if (profile?.enabled && !limit?.active) return this.candidate;
      this.candidate = null;
    }
    const result = this.router.select({
      taskId: this.task.id,
      taskType: this.task.taskType,
      profileId: this.task.currentProfileId,
      modelId: this.task.currentModelId,
      excludeKeys: [...this.exclude],
      requirements: { tools: true, vision: this.task.taskType === 'vision' },
    });
    this.lastBlocked = result.outcome.blocked;
    if (!result.decision) {
      this.candidate = null;
      return null;
    }
    const previousProfile = this.task.currentProfileId;
    const previousModel = this.task.currentModelId;
    this.candidate = result.decision.candidate;
    this.router.record(result.decision, {
      taskId: this.task.id,
      previousProfileId: previousProfile,
      previousModelId: previousModel,
    });
    this.task = this.store.updateTask(this.task.id, {
      currentProfileId: this.candidate.profile.id,
      currentModelId: this.candidate.model.modelId,
    });
    this.hooks.onRoute?.(result.decision);
    return this.candidate;
  }

  private buildContext(candidate: RouteCandidate): BuiltContext {
    const settings: AppSettings = this.contextSlim
      ? {
          ...this.settings,
          agent: {
            ...this.settings.agent,
            contextBudgetRatio: Math.min(0.32, this.settings.agent.contextBudgetRatio),
          },
        }
      : this.settings;
    const history = this.store.loadMessages(this.task.id, 400);
    const built = this.builder.build({
      task: this.task,
      model: candidate.model,
      history,
      settings,
      inspector: this.inspector,
      relevantFiles: this.relevantFiles,
      cache: this.contextCache,
      summary: this.contextSummary,
      projectSummary: this.projectSummary,
    });
    this.contextCache = built.cache;
    this.contextSummary = built.summary;
    return built;
  }

  // ------------------------------------------------------------------- model
  private async callModel(
    candidate: RouteCandidate,
    built: BuiltContext,
    signal?: AbortSignal,
  ): Promise<ChatResponse> {
    const context = await this.contextFactory(candidate.profile);
    context.signal = signal;
    const adapter = this.adapterFactory(candidate.profile);
    const maxOutput = Math.min(8192, candidate.model.maxOutputTokens ?? 4096);
    return adapter.chat(
      context,
      {
        model: candidate.model.modelId,
        messages: built.messages,
        tools: this.executor.definitions(),
        maxOutputTokens: maxOutput,
      },
      {
        signal,
        onText: (delta) => this.hooks.onText?.(delta),
      },
    );
  }

  private async handleFailure(
    error: unknown,
    candidate: RouteCandidate,
    signal?: AbortSignal,
  ): Promise<'retry' | 'fallback' | 'cancel'> {
    const classified =
      error instanceof ProviderError ? error : classifyThrown(error, candidate.profile.providerId);

    if (classified.category === 'cancelled' || signal?.aborted) return 'cancel';

    const key = Router.key(candidate.profile.id, candidate.model.modelId);
    this.store.addAttempt(this.task.id, {
      profileId: candidate.profile.id,
      modelId: candidate.model.modelId,
      category: classified.category,
      at: new Date().toISOString(),
    });
    this.store.recordProfileError(candidate.profile.id, classified.message);
    this.store.recordHealth({
      profileId: candidate.profile.id,
      ok: false,
      category: classified.category,
      message: classified.message,
    });

    const resetLabel = classified.resetAt
      ? `Provider reset: ${classified.resetAt}.`
      : classified.retryAfterAt
        ? `Requested retry after: ${classified.retryAfterAt}.`
        : 'Reset time unknown.';
    this.hooks.onNotice?.(
      `${describeCategory(classified.category)} on ${candidate.profile.name}/${candidate.model.modelId}: ${classified.message} ${resetLabel}`,
    );

    if (classified.category === 'context_length' && !this.contextSlim) {
      this.contextSlim = true;
      this.hooks.onNotice?.('Retrying with a reduced context window.');
      return 'retry';
    }

    const retryable =
      classified.category === 'rate_limit' ||
      classified.category === 'provider_outage' ||
      classified.category === 'network';
    const failures = (this.retryCounts.get(key) ?? 0) + 1;
    this.retryCounts.set(key, failures);
    if (retryable && failures <= this.settings.routing.maxRetriesPerCandidate) {
      const delay = this.backoff(failures, classified);
      if (delay !== null && delay <= this.settings.routing.retryMaxDelayMs) {
        this.hooks.onRetry?.({
          attempt: failures,
          delayMs: delay,
          category: classified.category,
          message: classified.message,
        });
        await sleep(delay, signal);
        if (signal?.aborted) return 'cancel';
        // Do not persist a cooldown while we are still retrying this candidate.
        return 'retry';
      }
      if (delay !== null) {
        this.hooks.onNotice?.(
          `Provider requested a wait of ${Math.round(delay / 1000)}s, which exceeds the ${Math.round(
            this.settings.routing.retryMaxDelayMs / 1000,
          )}s retry cap. Trying a fallback instead.`,
        );
      }
    }

    const profileLevel: ErrorCategory[] = [
      'invalid_api_key',
      'auth_failure',
      'permission_error',
      'billing_restriction',
    ];
    const shouldPersistLimit =
      profileLevel.includes(classified.category) ||
      classified.category === 'rate_limit' ||
      classified.category === 'daily_quota' ||
      classified.category === 'provider_outage' ||
      classified.category === 'network' ||
      classified.category === 'model_unavailable' ||
      classified.category === 'unsupported_tool_calling';
    if (shouldPersistLimit) {
      this.store.saveLimit({
        profileId: candidate.profile.id,
        modelId: profileLevel.includes(classified.category) ? '*' : candidate.model.modelId,
        category: classified.category,
        message: classified.message,
        retryAfterAt: classified.retryAfterAt,
        resetAt: classified.resetAt,
      });
    }

    this.exclude.add(key);
    this.retryCounts.delete(key);
    this.contextSlim = false;
    this.candidate = null;
    return 'fallback';
  }

  private backoff(attempt: number, error: ProviderError): number | null {
    const target = error.retryAfterAt ?? error.resetAt;
    if (target) {
      const delay = Date.parse(target) - Date.now();
      if (!Number.isFinite(delay)) return null;
      return Math.max(0, delay);
    }
    const base = this.settings.routing.retryBaseDelayMs;
    const max = this.settings.routing.retryMaxDelayMs;
    const exponential = base * Math.pow(2, Math.max(0, attempt - 1));
    const jitter = 0.75 + Math.random() * 0.5;
    return Math.min(max, Math.round(exponential * jitter));
  }

  private recordTurnUsage(
    candidate: RouteCandidate,
    built: BuiltContext,
    response: ChatResponse,
  ): TokenUsage {
    const estimatedInput = estimateTokens(
      built.messages.map((message) => message.content).join('\n'),
    );
    const estimatedOutput =
      estimateTokens(response.content) +
      (response.toolCalls.length ? estimateTokens(JSON.stringify(response.toolCalls)) : 0);
    const usage: TokenUsage = response.usage ?? {
      inputTokens: estimatedInput,
      outputTokens: estimatedOutput,
      totalTokens: estimatedInput + estimatedOutput,
    };
    const model = candidate.model;
    const cost =
      model.inputPricePerMillion !== null && model.outputPricePerMillion !== null
        ? (usage.inputTokens / 1_000_000) * model.inputPricePerMillion +
          (usage.outputTokens / 1_000_000) * model.outputPricePerMillion
        : null;
    this.store.recordUsage({
      taskId: this.task.id,
      profileId: candidate.profile.id,
      providerId: candidate.profile.providerId,
      modelId: model.modelId,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costEstimate: cost,
      source: response.usage ? 'provider' : 'estimated',
    });
    this.store.recordProfileSuccess(candidate.profile.id);
    this.store.clearLimit(candidate.profile.id, model.modelId);
    this.store.clearLimit(candidate.profile.id, '*');
    this.retryCounts.delete(Router.key(candidate.profile.id, model.modelId));
    this.usage.inputTokens += usage.inputTokens;
    this.usage.outputTokens += usage.outputTokens;
    return usage;
  }

  // ------------------------------------------------------------------- tools
  private async executeTools(calls: ToolCall[], signal?: AbortSignal): Promise<boolean> {
    let completed = false;
    for (const call of calls) {
      if (signal?.aborted) return false;
      this.hooks.onToolStart?.(call);
      this.updatePhaseForTool(call.name);
      const result = await this.executor.execute(call);
      this.hooks.onToolResult?.(call, result);
      this.store.appendMessage(this.task.id, {
        role: 'tool',
        toolCallId: call.id,
        name: call.name,
        content: result.content,
        isError: !result.ok,
      });
      if (result.changedFiles?.length) {
        this.task = this.store.updateTask(this.task.id, {
          changedFiles: mergeUnique(this.task.changedFiles, result.changedFiles),
          relevantFiles: mergeUnique(this.task.relevantFiles, result.changedFiles).slice(0, 60),
        });
        for (const file of result.changedFiles) {
          if (!this.relevantFiles.some((entry) => entry.path === file)) {
            this.relevantFiles.push({ path: file, reason: 'changed in this task' });
          }
        }
      }
      if (call.name === 'task_complete' && result.ok) completed = true;
      this.checkpoint(`tool:${call.name}`);
      if (signal?.aborted) return false;
    }
    return completed || Boolean(this.completionSummary);
  }

  private updatePhaseForTool(toolName: string): void {
    const phases: Record<string, TaskRecord['phase']> = {
      update_plan: 'plan',
      write_file: 'implement',
      edit_file: 'implement',
      apply_patch: 'implement',
      delete_file: 'implement',
      run_tests: 'test',
      run_lint: 'test',
      run_build: 'test',
      task_complete: 'summarize',
    };
    const phase = phases[toolName];
    if (phase) this.setPhase(phase);
  }

  private setPhase(phase: TaskRecord['phase']): void {
    if (this.task.phase === phase) return;
    this.task = this.store.updateTask(this.task.id, { phase });
    this.hooks.onPhase?.(phase);
  }

  // -------------------------------------------------------------- review/done
  private async reviewIfEnabled(): Promise<boolean> {
    const collaboration = this.settings.agent.collaboration;
    if (
      !collaboration.enabled ||
      !collaboration.reviewerProfileId ||
      !collaboration.reviewChanges
    ) {
      return false;
    }
    if (this.reviewCycles >= 1) return false;
    if (this.task.changedFiles.length === 0) return false;
    this.reviewCycles += 1;
    this.setPhase('review');
    const summary = this.completionSummary ?? this.finalResponse ?? this.task.summary ?? '';
    const review = await this.collaborator.review(this.task, this.task.changedFiles, summary);
    if (!review) return false;
    this.hooks.onReview?.(review.text);
    this.store.appendMessage(this.task.id, {
      role: 'system',
      content: `[Reviewer ${review.modelId}]\n${review.text.slice(0, 8000)}`,
    });
    if (review.verdict === 'issues') {
      this.store.appendMessage(this.task.id, {
        role: 'user',
        content: `Reviewer feedback. Address these findings, verify with tests, then call task_complete again:\n${review.text.slice(0, 8000)}`,
      });
      return true;
    }
    return false;
  }

  private complete(): AgentResult {
    const summary = (
      this.completionSummary ??
      this.finalResponse ??
      this.task.summary ??
      'Task completed.'
    ).slice(0, 8000);
    this.task = this.store.updateTask(this.task.id, {
      status: 'completed',
      phase: 'done',
      summary,
      error: null,
      completedAt: new Date().toISOString(),
      pendingSteps: [],
      attempts: this.task.attempts,
    });
    this.checkpoint('completed');
    this.hooks.onTaskComplete?.(summary);
    return {
      status: 'completed',
      taskId: this.task.id,
      summary,
      pauseReason: null,
      finalResponse: this.finalResponse,
      usage: { ...this.usage },
      steps: this.steps,
    };
  }

  private halt(status: 'paused' | 'failed', reason: string): AgentResult {
    const safeReason = redactSecrets(reason);
    this.task = this.store.updateTask(this.task.id, {
      status,
      phase: status === 'failed' ? this.task.phase : 'paused',
      error: safeReason,
      summary: this.completionSummary ?? this.task.summary,
    });
    try {
      const messages = this.store.loadMessages(this.task.id, 5);
      const last = messages[messages.length - 1];
      if (!last || !(last.role === 'system' && last.content.includes('[ComiCode paused]'))) {
        this.store.appendMessage(this.task.id, {
          role: 'system',
          content: `[ComiCode ${status}] ${safeReason}`,
        });
      }
      this.checkpoint(status);
    } catch (error) {
      logger.warn(`Failed to save pause checkpoint: ${String(error)}`);
    }
    this.hooks.onPaused?.(safeReason);
    return {
      status,
      taskId: this.task.id,
      summary: this.task.summary,
      pauseReason: safeReason,
      finalResponse: this.finalResponse,
      usage: { ...this.usage },
      steps: this.steps,
    };
  }

  private buildPauseReason(): string {
    const reasons = new Map<string, number>();
    for (const blocked of this.lastBlocked) {
      const label = blocked.reason;
      reasons.set(label, (reasons.get(label) ?? 0) + 1);
    }
    const detail = [...reasons.entries()]
      .slice(0, 12)
      .map(([reason, count]) => `- ${reason}${count > 1 ? ` (${count} candidates)` : ''}`)
      .join('\n');
    const profiles = this.store.listProfiles();
    const intro =
      profiles.length === 0
        ? 'No provider profiles are connected.'
        : 'No eligible model/profile is currently available.';
    const policy = this.router.policy;
    const policyNotes: string[] = [];
    if (!policy.allowPaid) policyNotes.push('paid fallbacks are disabled');
    if (!policy.allowUnknownAccess) policyNotes.push('unknown-access models are disabled');
    if (policy.excludedProviders.length) {
      policyNotes.push(`excluded providers: ${policy.excludedProviders.join(', ')}`);
    }
    const lines = [intro];
    if (detail) lines.push('Reasons:', detail);
    if (policyNotes.length) lines.push(`Policy: ${policyNotes.join('; ')}.`);
    lines.push(
      `Progress and checkpoints were saved. Check quota/reset status with "comicode usage", add another profile if needed, then resume with "comicode resume ${this.task.id}".`,
    );
    return lines.join('\n');
  }

  private checkpoint(reason: string): void {
    try {
      const latest = this.store.getTask(this.task.id);
      if (!latest) return;
      const messages = this.store.loadMessages(this.task.id, 300);
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
      const checkpoint = this.store.createCheckpoint(this.task.id, {
        task: latest,
        messages,
        summary: this.contextSummary,
        contextCache: this.contextCache,
        recentToolOutputs,
        savedAt: new Date().toISOString(),
      });
      this.task = this.store.getTask(this.task.id) ?? latest;
      this.hooks.onCheckpoint?.(checkpoint.id);
    } catch (error) {
      logger.warn(`Checkpoint (${reason}) failed: ${String(error)}`);
    }
  }
}

export function createAgent(options: CodingAgentOptions): CodingAgent {
  return new CodingAgent(options);
}
