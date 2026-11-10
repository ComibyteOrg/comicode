import type { ModelInfo, ProviderProfile, RouteDecision, TaskType } from '../types.js';
import type { Store } from '../db/store.js';
import type { RoutingPolicy } from '../settings.js';
import {
  buildRoutingOutcome,
  candidateKey,
  type RoutingOutcome,
  type RoutingRequirements,
} from './engine.js';

export interface RouteTaskInput {
  taskId?: string | null;
  taskType?: TaskType;
  profileId?: string | null;
  modelId?: string | null;
  excludeKeys?: string[];
  excludedProfileIds?: string[];
  requirements?: Partial<RoutingRequirements>;
}

export interface RouteTaskResult {
  outcome: RoutingOutcome;
  decision: RouteDecision | null;
  selection: { profileId: string | null; modelId: string | null };
  policy: RoutingPolicy;
}

/**
 * Loads routing state from SQLite and applies the configured policy. Selection
 * precedence: task state → explicit arguments → saved UI selection → first
 * enabled profile with a default model.
 */
export class Router {
  constructor(
    private readonly store: Store,
    private readonly override: Partial<RoutingPolicy> = {},
  ) {}

  get policy(): RoutingPolicy {
    return { ...this.store.getSettings().routing, ...this.override };
  }

  select(input: RouteTaskInput = {}): RouteTaskResult {
    const policy = this.policy;
    const profiles = this.store.listProfiles();
    const models = this.store.listModels();
    const limits = this.store.listLimits(true);
    const selection = this.resolveSelection(input, profiles);

    const outcome = buildRoutingOutcome({
      taskType: input.taskType ?? 'coding',
      profiles,
      models,
      limits,
      policy,
      currentProfileId: selection.profileId,
      currentModelId: selection.modelId,
      excludeKeys: input.excludeKeys,
      excludedProfileIds: input.excludedProfileIds,
      requirements: input.requirements,
    });

    return { outcome, decision: outcome.decision, selection, policy };
  }

  private resolveSelection(
    input: RouteTaskInput,
    profiles: ProviderProfile[],
  ): { profileId: string | null; modelId: string | null } {
    let profileId = input.profileId ?? this.store.getSelectedProfileId();
    let modelId = input.modelId ?? null;

    if (!modelId) {
      const savedModelDbId = this.store.getSelectedModelId();
      if (savedModelDbId) {
        const saved = this.store.getModelById(savedModelDbId);
        if (saved) {
          modelId = saved.modelId;
          if (saved.profileId) {
            const scopedProfile = profiles.find((profile) => profile.id === saved.profileId);
            if (scopedProfile) profileId = scopedProfile.id;
          }
        } else if (savedModelDbId.includes(':')) {
          // Tolerate a raw provider:model string from an older selection.
          modelId = savedModelDbId.split(':').pop() ?? null;
        }
      }
    }

    let profile = profiles.find((candidate) => candidate.id === profileId) ?? null;
    if (!profile) {
      profile = profiles.find((candidate) => candidate.enabled) ?? null;
      profileId = profile?.id ?? null;
    }
    if (!modelId) modelId = profile?.defaultModel ?? null;
    return { profileId, modelId };
  }

  /** Record a routing transition for the UI/history. */
  record(
    decision: RouteDecision | null,
    input: {
      taskId?: string | null;
      previousProfileId?: string | null;
      previousModelId?: string | null;
      category?: string | null;
    } = {},
  ): void {
    if (!decision) return;
    this.store.recordRoutingEvent({
      taskId: input.taskId ?? null,
      fromProfileId: input.previousProfileId ?? null,
      fromModelId: input.previousModelId ?? null,
      toProfileId: decision.candidate.profile.id,
      toModelId: decision.candidate.model.modelId,
      reason: decision.reason,
      category: input.category ?? null,
    });
  }

  /** Mark a failed candidate so the next selection avoids it. */
  static key(profileId: string, modelId: string): string {
    return candidateKey(profileId, modelId);
  }

  /** Resolve a model shown in the catalog to its provider/profile. */
  resolveModel(modelDbId: string): { model: ModelInfo; profileId: string | null } | null {
    const model = this.store.getModelById(modelDbId);
    if (!model) return null;
    return { model, profileId: model.profileId };
  }
}
