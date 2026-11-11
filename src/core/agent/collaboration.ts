import type {
  AgentMessage,
  ErrorCategory,
  ModelInfo,
  ProviderProfile,
  TaskPlan,
  TaskRecord,
  TokenUsage,
} from '../types.js';
import type { Store } from '../db/store.js';
import type { AppSettings } from '../settings.js';
import type { ProjectInspector } from '../project/inspector.js';
import type { AgentHooks } from './types.js';
import { createAdapter } from '../providers/registry.js';
import { createProfileContext } from '../providers/service.js';
import { classifyThrown } from '../providers/errors.js';
import { isSecretFile } from '../safety/secrets.js';
import { runProcess } from '../safety/process.js';
import { estimateTokens } from './context.js';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface CollaborationResult {
  text: string;
  modelId: string;
  profileId: string;
}

export interface ReviewResult extends CollaborationResult {
  verdict: 'approve' | 'issues' | 'unknown';
}

function parseUsageFromText(text: string): TokenUsage {
  const output = estimateTokens(text);
  return { inputTokens: 0, outputTokens: output, totalTokens: output };
}

/**
 * Optional planner/reviewer passes. Each pass is a single, tool-free request to
 * a user-configured profile. Failures never block the main task.
 */
export class Collaborator {
  constructor(
    private readonly store: Store,
    private readonly inspector: ProjectInspector,
    private readonly settings: AppSettings,
    private readonly hooks: AgentHooks,
  ) {}

  private resolveProfileModel(
    profileId: string | null,
  ): { profile: ProviderProfile; model: ModelInfo } | null {
    if (!profileId) return null;
    const profile = this.store.getProfile(profileId);
    if (!profile || !profile.enabled) return null;
    const models = this.store
      .listModels(profile.providerId, profile.providerId === 'custom' ? profile.id : undefined)
      .filter((model) => model.profileId === null || model.profileId === profile.id);
    const preferred = models.find(
      (model) => model.modelId === profile.defaultModel && model.available,
    );
    const catalogModel =
      preferred ?? models.find((model) => model.available && model.supportsTools);
    if (!catalogModel) {
      const modelId = profile.defaultModel;
      if (!modelId) return null;
      const synthetic: ModelInfo = {
        id: `${profile.providerId}:${modelId}`,
        providerId: profile.providerId,
        profileId: profile.providerId === 'custom' ? profile.id : null,
        modelId,
        displayName: modelId,
        contextWindow: null,
        maxOutputTokens: null,
        supportsTools: true,
        supportsStreaming: true,
        supportsVision: false,
        codingSuitability: 2,
        reasoningSuitability: 2,
        inputPricePerMillion: null,
        outputPricePerMillion: null,
        access: 'unknown',
        accessSource: 'collaboration',
        accessNotes: null,
        available: true,
        lastCheckedAt: null,
        userClassification: null,
        metadata: {},
      };
      return { profile, model: synthetic };
    }
    return { profile, model: catalogModel };
  }

  private recordUsage(
    taskId: string,
    profile: ProviderProfile,
    model: ModelInfo,
    usage: TokenUsage,
  ): void {
    const cost =
      model.inputPricePerMillion !== null && model.outputPricePerMillion !== null
        ? (usage.inputTokens / 1_000_000) * model.inputPricePerMillion +
          (usage.outputTokens / 1_000_000) * model.outputPricePerMillion
        : null;
    this.store.recordUsage({
      taskId,
      profileId: profile.id,
      providerId: profile.providerId,
      modelId: model.modelId,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costEstimate: cost,
      source: 'collaboration',
    });
  }

  async plan(task: TaskRecord, projectSummary: string): Promise<CollaborationResult | null> {
    const target = this.resolveProfileModel(this.settings.agent.collaboration.plannerProfileId);
    if (!target) return null;
    const prompt = [
      'Create a concise implementation plan for the coding task below.',
      'Return a one-sentence summary and then 3-10 numbered steps. Do not write code.',
      '',
      `Project summary:\n${projectSummary.slice(0, 12_000)}`,
      '',
      `Task request:\n${task.userRequest}`,
      '',
      task.plan
        ? `Existing plan:\n${task.plan.steps.map((step) => `- ${step.title}`).join('\n')}`
        : '',
    ]
      .filter(Boolean)
      .join('\n');

    try {
      const result = await this.call(
        target.profile,
        target.model,
        [
          { role: 'system', content: 'You are a senior software planner. Be concrete and brief.' },
          { role: 'user', content: prompt },
        ],
        2000,
      );
      this.recordUsage(
        task.id,
        target.profile,
        target.model,
        result.usage ?? parseUsageFromText(result.text),
      );
      this.store.recordRoutingEvent({
        taskId: task.id,
        toProfileId: target.profile.id,
        toModelId: target.model.modelId,
        reason: 'Planner collaboration pass',
        category: 'collaboration',
      });
      return { text: result.text, profileId: target.profile.id, modelId: target.model.modelId };
    } catch (error) {
      const classified = classifyThrown(error, target.profile.providerId);
      this.recordFailure(target.profile, target.model, classified.category, classified.message);
      this.hooks.onNotice?.(
        `Planner pass unavailable (${classified.category}): ${classified.message}`,
      );
      return null;
    }
  }

  async review(
    task: TaskRecord,
    changedFiles: string[],
    summary: string,
  ): Promise<ReviewResult | null> {
    const target = this.resolveProfileModel(this.settings.agent.collaboration.reviewerProfileId);
    if (!target) return null;
    const context = await this.buildReviewContext(changedFiles);
    const prompt = [
      'Review the following coding task changes for correctness, regressions, safety, and missing tests.',
      'Do not rewrite the whole project. Be specific and concise.',
      'Your first line must be exactly "VERDICT: APPROVE" or "VERDICT: ISSUES".',
      'If you choose ISSUES, follow with a short bullet list of actionable problems.',
      '',
      `Task request:\n${task.userRequest}`,
      '',
      `Implementer summary:\n${summary.slice(0, 4000)}`,
      '',
      `Changed files:\n${changedFiles.join('\n') || '(none reported)'}`,
      '',
      context,
    ].join('\n');

    try {
      const result = await this.call(
        target.profile,
        target.model,
        [
          {
            role: 'system',
            content:
              'You are a rigorous code reviewer. Do not invent files or test results. Judge only the supplied diff/context.',
          },
          { role: 'user', content: prompt },
        ],
        3000,
      );
      this.recordUsage(
        task.id,
        target.profile,
        target.model,
        result.usage ?? parseUsageFromText(result.text),
      );
      this.store.recordRoutingEvent({
        taskId: task.id,
        toProfileId: target.profile.id,
        toModelId: target.model.modelId,
        reason: 'Reviewer collaboration pass',
        category: 'collaboration',
      });
      const verdict: ReviewResult['verdict'] = /VERDICT:\s*ISSUES/i.test(result.text)
        ? 'issues'
        : /VERDICT:\s*APPROVE/i.test(result.text)
          ? 'approve'
          : 'unknown';
      return {
        text: result.text,
        profileId: target.profile.id,
        modelId: target.model.modelId,
        verdict,
      };
    } catch (error) {
      const classified = classifyThrown(error, target.profile.providerId);
      this.recordFailure(target.profile, target.model, classified.category, classified.message);
      this.hooks.onNotice?.(
        `Reviewer pass unavailable (${classified.category}): ${classified.message}`,
      );
      return null;
    }
  }

  /**
   * Tester pass: a separate model reviews the change for test gaps and
   * verifies claims against the actual diff. Returns feedback text, or null
   * when no tester profile is configured or the pass fails.
   */
  async test(
    task: TaskRecord,
    changedFiles: string[],
    summary: string,
  ): Promise<CollaborationResult | null> {
    const target = this.resolveProfileModel(this.settings.agent.collaboration.testerProfileId);
    if (!target) return null;
    const context = await this.buildReviewContext(changedFiles);
    const prompt = [
      'Act as the tester for this coding task. Review the diff and answer:',
      '1. Which behaviors changed and are they covered by tests?',
      '2. What edge cases or regressions are untested?',
      '3. Did the implementer claim verification it cannot have performed?',
      'Be specific and concise. First line must be "VERDICT: OK" or "VERDICT: GAPS".',
      '',
      `Task request:\n${task.userRequest}`,
      '',
      `Implementer summary:\n${summary.slice(0, 4000)}`,
      '',
      `Changed files:\n${changedFiles.join('\n') || '(none reported)'}`,
      '',
      context,
    ].join('\n');

    try {
      const result = await this.call(
        target.profile,
        target.model,
        [
          {
            role: 'system',
            content:
              'You are a senior test engineer. Judge only the supplied diff/context; never invent test results.',
          },
          { role: 'user', content: prompt },
        ],
        2000,
      );
      this.recordUsage(
        task.id,
        target.profile,
        target.model,
        result.usage ?? parseUsageFromText(result.text),
      );
      this.store.recordRoutingEvent({
        taskId: task.id,
        toProfileId: target.profile.id,
        toModelId: target.model.modelId,
        reason: 'Tester collaboration pass',
        category: 'collaboration',
      });
      return { text: result.text, profileId: target.profile.id, modelId: target.model.modelId };
    } catch (error) {
      const classified = classifyThrown(error, target.profile.providerId);
      this.recordFailure(target.profile, target.model, classified.category, classified.message);
      this.hooks.onNotice?.(
        `Tester pass unavailable (${classified.category}): ${classified.message}`,
      );
      return null;
    }
  }

  private recordFailure(
    profile: ProviderProfile,
    model: ModelInfo,
    category: ErrorCategory,
    message: string,
  ): void {
    this.store.recordHealth({
      profileId: profile.id,
      ok: false,
      category,
      message,
    });
    if (
      category === 'rate_limit' ||
      category === 'daily_quota' ||
      category === 'provider_outage' ||
      category === 'network' ||
      category === 'billing_restriction'
    ) {
      this.store.saveLimit({
        profileId: profile.id,
        modelId: category === 'rate_limit' || category === 'network' ? model.modelId : '*',
        category,
        message,
      });
    }
  }

  private async call(
    profile: ProviderProfile,
    model: ModelInfo,
    messages: AgentMessage[],
    maxOutputTokens: number,
  ): Promise<{ text: string; usage: TokenUsage | null }> {
    const context = await createProfileContext(profile);
    const adapter = createAdapter(profile);
    const response = await adapter.chat(context, {
      model: model.modelId,
      messages,
      tools: [],
      temperature: 0.2,
      maxOutputTokens,
    });
    this.store.recordProfileSuccess(profile.id);
    this.store.clearLimit(profile.id, model.modelId);
    return { text: response.content, usage: response.usage };
  }

  private async buildReviewContext(changedFiles: string[]): Promise<string> {
    const diff = await runProcess(
      'git',
      [
        'diff',
        '--no-color',
        '--',
        '.',
        ':(exclude).env',
        ':(exclude).env.*',
        ':(exclude)*.pem',
        ':(exclude)*.key',
        ':(exclude)*credentials*',
      ],
      { cwd: this.inspector.root, timeoutMs: 15_000, maxOutputBytes: 80_000 },
    );
    const status = await runProcess('git', ['status', '--porcelain=v1'], {
      cwd: this.inspector.root,
      timeoutMs: 10_000,
      maxOutputBytes: 10_000,
    });
    const parts: string[] = [];
    if (diff.code === 0 && diff.stdout.trim()) {
      parts.push(`Git diff (tracked changes):\n${diff.stdout.slice(0, 25_000)}`);
    }
    if (status.code === 0 && status.stdout.trim()) {
      parts.push(`Working tree status:\n${status.stdout.slice(0, 4000)}`);
    }
    let budget = 20_000;
    for (const file of changedFiles.slice(0, 8)) {
      if (isSecretFile(file) || budget <= 0) continue;
      try {
        const absolute = join(this.inspector.root, file);
        if (statSync(absolute).size > 60_000) continue;
        const content = readFileSync(absolute, 'utf8');
        const clipped = content.slice(0, Math.min(budget, 6000));
        parts.push(`--- ${file} (current content excerpt) ---\n${clipped}`);
        budget -= clipped.length;
      } catch {
        // File deleted or unreadable.
      }
    }
    return parts.join('\n\n') || 'No diff available.';
  }
}

/** Parse planner output into a TaskPlan. */
export function planFromCollaborator(text: string): TaskPlan {
  const lines = text.split(/\r?\n/);
  const steps: Array<{ title: string; status: 'pending' }> = [];
  for (const line of lines) {
    const match = /^\s*(?:[-*]|\d+[.)])\s+(.+)$/.exec(line);
    if (match?.[1]) steps.push({ title: match[1].trim().slice(0, 400), status: 'pending' });
    if (steps.length >= 12) break;
  }
  const summary =
    lines
      .find((line) => line.trim() && !/^\s*(?:[-*]|\d+[.)])\s+/.test(line))
      ?.trim()
      .slice(0, 500) || 'Planner proposal';
  return {
    summary,
    steps: steps.length
      ? steps
      : [{ title: 'Inspect the project and implement the request', status: 'pending' }],
    updatedAt: new Date().toISOString(),
  };
}
