import type {
  AccessClassification,
  ModelInfo,
  ProviderLimit,
  ProviderProfile,
  RouteCandidate,
  RouteDecision,
  TaskType,
} from '../types.js';
import type { RoutingPolicy } from '../settings.js';
import { effectiveAccess, isPaidAccess } from '../providers/catalog.js';
import { providerDisplayName } from '../providers/definitions.js';

export interface RoutingRequirements {
  tools: boolean;
  vision?: boolean;
  streaming?: boolean;
  minContextWindow?: number;
}

export interface RoutingRequest {
  taskType: TaskType;
  profiles: ProviderProfile[];
  models: ModelInfo[];
  limits: ProviderLimit[];
  policy: RoutingPolicy;
  /** Explicit user selection, if any. */
  currentProfileId?: string | null;
  currentModelId?: string | null;
  /** Candidate keys (`profileId::modelId`) that already failed in this task. */
  excludeKeys?: string[];
  /** Exclude an entire provider from fallback. */
  excludedProfileIds?: string[];
  requirements?: Partial<RoutingRequirements>;
}

export interface RankedCandidate extends RouteCandidate {
  key: string;
  explicit: boolean;
  access: AccessClassification;
  reason: string;
  rank: number;
}

export interface RoutingOutcome {
  decision: RouteDecision | null;
  chain: RankedCandidate[];
  blocked: Array<{ profileId: string | null; modelId: string | null; reason: string }>;
}

export function candidateKey(profileId: string, modelId: string): string {
  return `${profileId}::${modelId}`;
}

export function requirementsForTask(taskType: TaskType): RoutingRequirements {
  return {
    tools: true,
    vision: taskType === 'vision',
    streaming: false,
  };
}

function isLimitActiveNow(limit: ProviderLimit, nowMs: number): boolean {
  return limit.active && nowMs >= 0;
}

function profilePriority(profile: ProviderProfile): number {
  const raw = profile.config?.priority;
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : 100;
}

function modelScore(model: ModelInfo, taskType: TaskType, preferCoding: boolean): number {
  let score = 0;
  if (preferCoding) score += model.codingSuitability * 12;
  if (taskType === 'reasoning' || taskType === 'review') score += model.reasoningSuitability * 10;
  if (taskType === 'coding') score += model.codingSuitability * 4;
  if (model.contextWindow) score += Math.min(20, Math.log10(model.contextWindow) * 2);
  if (model.maxOutputTokens) score += Math.min(10, Math.log10(model.maxOutputTokens));
  return score;
}

function accessBucket(access: AccessClassification, preferFree: boolean): number {
  if (!preferFree) return 0;
  if (access === 'free-confirmed' || access === 'user-free') return 3;
  if (access === 'free-tier') return 2;
  if (access === 'unknown') return 1;
  return 0;
}

interface CandidateMeta {
  candidate: RouteCandidate;
  key: string;
  explicit: boolean;
  access: AccessClassification;
  isDefaultModel: boolean;
  sameModel: boolean;
  profile: ProviderProfile;
  model: ModelInfo;
}

function syntheticModel(profile: ProviderProfile, modelId: string): ModelInfo {
  return {
    id: `${profile.providerId}:${profile.id}:${modelId}:selected`,
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
    accessSource: 'selected-model',
    accessNotes: 'Model is not in the catalog yet; capabilities are assumed until verified.',
    available: true,
    lastCheckedAt: null,
    userClassification: null,
    metadata: { synthetic: true },
  };
}

function findModel(
  request: RoutingRequest,
  profile: ProviderProfile,
  modelId: string,
): ModelInfo | null {
  return (
    request.models.find(
      (model) =>
        model.providerId === profile.providerId &&
        model.modelId === modelId &&
        (model.profileId === null || model.profileId === profile.id),
    ) ?? null
  );
}

/**
 * Build an ordered, capability-aware fallback chain. The engine is pure: all
 * state (profiles, models, limits, policy) is provided by the caller so the
 * behavior is deterministic and easy to test.
 */
export function buildRoutingOutcome(request: RoutingRequest): RoutingOutcome {
  const nowMs = Date.now();
  const blocked: RoutingOutcome['blocked'] = [];
  const exclude = new Set(request.excludeKeys ?? []);
  const excludedProfiles = new Set(request.excludedProfileIds ?? []);
  const requirements: RoutingRequirements = {
    ...requirementsForTask(request.taskType),
    ...request.requirements,
  };
  const minContext = request.policy.minContextWindow || requirements.minContextWindow || 0;

  const profileById = new Map(request.profiles.map((profile) => [profile.id, profile]));
  const limitsByProfile = new Map<string, ProviderLimit[]>();
  for (const limit of request.limits) {
    if (!limit.active) continue;
    const list = limitsByProfile.get(limit.profileId) ?? [];
    list.push(limit);
    limitsByProfile.set(limit.profileId, list);
  }

  const currentProfile = request.currentProfileId
    ? (profileById.get(request.currentProfileId) ?? null)
    : null;
  const currentModelId = request.currentModelId?.trim() || null;

  const eligibleProfiles = request.profiles.filter((profile) => {
    if (excludedProfiles.has(profile.id)) {
      blocked.push({
        profileId: profile.id,
        modelId: null,
        reason: 'Profile excluded for this attempt.',
      });
      return false;
    }
    if (!profile.enabled) {
      blocked.push({
        profileId: profile.id,
        modelId: null,
        reason: 'Profile is disabled.',
      });
      return false;
    }
    if (request.policy.excludedProviders.includes(profile.providerId)) {
      blocked.push({
        profileId: profile.id,
        modelId: null,
        reason: `Provider ${providerDisplayName(profile.providerId)} is excluded by routing policy.`,
      });
      return false;
    }
    return true;
  });

  const meetsRequirements = (
    profile: ProviderProfile,
    model: ModelInfo,
    explicit: boolean,
  ): string | null => {
    if (model.userClassification === 'unavailable') return 'Model is marked unavailable.';
    if (explicit) return null;
    if (!model.available) return 'Model is not verified/available in the catalog.';
    if (requirements.tools && !model.supportsTools) return 'Model does not support tool calling.';
    if (requirements.vision && !model.supportsVision) return 'Model does not support vision.';
    if (minContext > 0 && model.contextWindow !== null && model.contextWindow < minContext) {
      return `Context window (${model.contextWindow.toLocaleString()}) is below the policy minimum.`;
    }
    const access = effectiveAccess(model, profile.accessClassification);
    if (access === 'unavailable') return 'Model is marked unavailable.';
    if (isPaidAccess(access) && !request.policy.allowPaid) {
      return 'Paid model blocked by policy (allowPaid is off).';
    }
    if (access === 'unknown' && !request.policy.allowUnknownAccess) {
      return 'Unknown pricing/access blocked by policy.';
    }
    return null;
  };

  const limitReason = (profileId: string, modelId: string): string | null => {
    const profileLimits = limitsByProfile.get(profileId) ?? [];
    const active = profileLimits.find(
      (limit) =>
        isLimitActiveNow(limit, nowMs) && (limit.modelId === '*' || limit.modelId === modelId),
    );
    if (!active) return null;
    const reset = active.resetAt ?? active.retryAfterAt;
    if (reset) {
      return `Temporarily unavailable (${active.category}); provider reset at ${reset}.`;
    }
    return `Temporarily unavailable (${active.category}); reset time unknown.`;
  };

  const meta: CandidateMeta[] = [];
  const seen = new Set<string>();

  const eligibleProfileIds = new Set(eligibleProfiles.map((profile) => profile.id));
  const addCandidate = (
    profile: ProviderProfile,
    model: ModelInfo,
    options: { explicit: boolean; isDefaultModel: boolean; sameModel: boolean },
  ): void => {
    if (!eligibleProfileIds.has(profile.id)) return;
    const key = candidateKey(profile.id, model.modelId);
    if (seen.has(key)) return;
    if (exclude.has(key)) {
      blocked.push({
        profileId: profile.id,
        modelId: model.modelId,
        reason: 'This profile/model already failed in the current task.',
      });
      return;
    }
    const limit = limitReason(profile.id, model.modelId);
    if (limit) {
      blocked.push({ profileId: profile.id, modelId: model.modelId, reason: limit });
      return;
    }
    const unmet = meetsRequirements(profile, model, options.explicit);
    if (unmet) {
      blocked.push({ profileId: profile.id, modelId: model.modelId, reason: unmet });
      return;
    }
    seen.add(key);
    const access = effectiveAccess(model, profile.accessClassification);
    meta.push({
      candidate: { profile, model },
      key,
      explicit: options.explicit,
      access,
      isDefaultModel: options.isDefaultModel,
      sameModel: options.sameModel,
      profile,
      model,
    });
  };

  // 1) The user's explicit profile/model selection always leads when usable.
  if (currentProfile && currentModelId) {
    if (!eligibleProfileIds.has(currentProfile.id)) {
      blocked.push({
        profileId: currentProfile.id,
        modelId: currentModelId,
        reason: 'Selected profile is disabled or excluded.',
      });
    } else {
      const model =
        findModel(request, currentProfile, currentModelId) ??
        syntheticModel(currentProfile, currentModelId);
      addCandidate(currentProfile, model, {
        explicit: true,
        isDefaultModel: true,
        sameModel: true,
      });
    }
  }

  // 2) Same-provider profiles (including the current profile's other models).
  const sameProviderId = currentProfile?.providerId ?? null;
  if (request.policy.preferSameProvider && sameProviderId) {
    const sameProviderProfiles = eligibleProfiles
      .filter((profile) => profile.providerId === sameProviderId)
      .sort((a, b) => {
        const freeDiff =
          accessBucket(
            a.accessClassification === 'user-free'
              ? 'user-free'
              : a.accessClassification === 'free-confirmed'
                ? 'free-confirmed'
                : a.accessClassification === 'free-tier'
                  ? 'free-tier'
                  : 'unknown',
            request.policy.preferFree,
          ) -
          accessBucket(
            b.accessClassification === 'user-free'
              ? 'user-free'
              : b.accessClassification === 'free-confirmed'
                ? 'free-confirmed'
                : b.accessClassification === 'free-tier'
                  ? 'free-tier'
                  : 'unknown',
            request.policy.preferFree,
          );
        if (freeDiff !== 0) return -freeDiff;
        const priorityDiff = profilePriority(a) - profilePriority(b);
        if (priorityDiff !== 0) return priorityDiff;
        return (a.lastSuccessAt ?? '').localeCompare(b.lastSuccessAt ?? '') * -1;
      });

    for (const profile of sameProviderProfiles) {
      if (profile.id === currentProfile?.id) {
        // Try the current profile's other known models after the explicit model.
        const models = request.models
          .filter(
            (model) =>
              model.providerId === profile.providerId &&
              model.available &&
              (model.profileId === null || model.profileId === profile.id) &&
              model.modelId !== currentModelId,
          )
          .sort(
            (a, b) =>
              modelScore(b, request.taskType, request.policy.preferCoding) -
              modelScore(a, request.taskType, request.policy.preferCoding),
          );
        for (const model of models) {
          addCandidate(profile, model, {
            explicit: false,
            isDefaultModel: model.modelId === profile.defaultModel,
            sameModel: false,
          });
        }
        continue;
      }
      if (profile.defaultModel) {
        const model =
          findModel(request, profile, profile.defaultModel) ??
          syntheticModel(profile, profile.defaultModel);
        addCandidate(profile, model, {
          explicit: false,
          isDefaultModel: true,
          sameModel: profile.defaultModel === currentModelId,
        });
      }
      const models = request.models
        .filter(
          (model) =>
            model.providerId === profile.providerId &&
            model.available &&
            (model.profileId === null || model.profileId === profile.id) &&
            model.modelId !== profile.defaultModel,
        )
        .sort(
          (a, b) =>
            modelScore(b, request.taskType, request.policy.preferCoding) -
            modelScore(a, request.taskType, request.policy.preferCoding),
        );
      for (const model of models) {
        addCandidate(profile, model, {
          explicit: false,
          isDefaultModel: false,
          sameModel: model.modelId === currentModelId,
        });
      }
    }
  }

  // 3) Other providers. Preferred providers come first; free access is next.
  const otherProfiles = eligibleProfiles
    .filter((profile) => profile.providerId !== sameProviderId)
    .sort((a, b) => {
      const preferred = request.policy.preferredProviders;
      const ai = preferred.indexOf(a.providerId);
      const bi = preferred.indexOf(b.providerId);
      const aRank = ai === -1 ? Number.MAX_SAFE_INTEGER : ai;
      const bRank = bi === -1 ? Number.MAX_SAFE_INTEGER : bi;
      if (aRank !== bRank) return aRank - bRank;
      const freeDiff =
        accessBucket(a.accessClassification, request.policy.preferFree) -
        accessBucket(b.accessClassification, request.policy.preferFree);
      if (freeDiff !== 0) return -freeDiff;
      const priorityDiff = profilePriority(a) - profilePriority(b);
      if (priorityDiff !== 0) return priorityDiff;
      return providerDisplayName(a.providerId).localeCompare(providerDisplayName(b.providerId));
    });

  for (const profile of otherProfiles) {
    if (profile.defaultModel) {
      const model =
        findModel(request, profile, profile.defaultModel) ??
        syntheticModel(profile, profile.defaultModel);
      addCandidate(profile, model, {
        explicit: false,
        isDefaultModel: true,
        sameModel: profile.defaultModel === currentModelId,
      });
    }
    const models = request.models
      .filter(
        (model) =>
          model.providerId === profile.providerId &&
          model.available &&
          (model.profileId === null || model.profileId === profile.id) &&
          model.modelId !== profile.defaultModel,
      )
      .sort(
        (a, b) =>
          modelScore(b, request.taskType, request.policy.preferCoding) -
          modelScore(a, request.taskType, request.policy.preferCoding),
      );
    for (const model of models) {
      addCandidate(profile, model, {
        explicit: false,
        isDefaultModel: false,
        sameModel: model.modelId === currentModelId,
      });
    }
  }

  const rank = (entry: CandidateMeta): number => {
    let score = 0;
    if (entry.explicit) score += 1_000_000;
    if (request.policy.preferSameProvider && entry.profile.providerId === sameProviderId) {
      score += 100_000;
    }
    const preferredIndex = request.policy.preferredProviders.indexOf(entry.profile.providerId);
    if (preferredIndex !== -1) score += 50_000 - preferredIndex * 100;
    score += accessBucket(entry.access, request.policy.preferFree) * 5_000;
    if (entry.sameModel && entry.profile.providerId === sameProviderId) score += 2_000;
    if (entry.isDefaultModel) score += 800;
    score += modelScore(entry.model, request.taskType, request.policy.preferCoding);
    score += Math.max(0, 300 - profilePriority(entry.profile));
    score -= 0; // stable tie-breaker handled by sort order
    return score;
  };

  const ranked: RankedCandidate[] = meta
    .map((entry) => {
      const rankValue = rank(entry);
      let reason: string;
      if (entry.explicit) reason = 'Explicitly selected model';
      else if (entry.profile.providerId === sameProviderId) {
        reason = `Same-provider fallback: ${profileDisplay(entry.profile)}`;
      } else {
        reason = `Cross-provider fallback: ${profileDisplay(entry.profile)} (${providerDisplayName(
          entry.profile.providerId,
        )})`;
      }
      return {
        ...entry.candidate,
        key: entry.key,
        explicit: entry.explicit,
        access: entry.access,
        reason,
        rank: rankValue,
      };
    })
    .sort((a, b) => b.rank - a.rank || a.key.localeCompare(b.key));

  const limit =
    Math.max(1, request.policy.maxFallbacks) + (currentProfile && currentModelId ? 1 : 0);
  const chain = ranked.slice(0, limit);

  if (chain.length === 0) {
    if (request.profiles.length === 0) {
      blocked.push({
        profileId: null,
        modelId: null,
        reason: 'No provider profiles are connected.',
      });
    } else if (eligibleProfiles.length === 0) {
      blocked.push({
        profileId: null,
        modelId: null,
        reason: 'No enabled provider profiles are available.',
      });
    }
    return { decision: null, chain: [], blocked };
  }

  const first = chain[0]!;
  const decision: RouteDecision = {
    candidate: { profile: first.profile, model: first.model },
    reason: first.reason,
    fallbackChain: chain.slice(1).map((entry) => ({
      profileId: entry.profile.id,
      profileName: profileDisplay(entry.profile),
      modelId: entry.model.modelId,
      reason: entry.reason,
    })),
    blocked,
  };
  return { decision, chain, blocked };
}

function profileDisplay(profile: ProviderProfile): string {
  return `${profile.name} (${providerDisplayName(profile.providerId)})`;
}

/** Convenience wrapper returning the selected decision or null when paused. */
export function selectRoute(request: RoutingRequest): RouteDecision | null {
  return buildRoutingOutcome(request).decision;
}
