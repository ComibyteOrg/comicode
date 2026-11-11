import type {
  AccessClassification,
  DiscoveredModel,
  ModelInfo,
  ProviderKind,
  ProviderProfile,
} from '../types.js';

interface KnownModel {
  displayName: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  supportsTools?: boolean;
  supportsVision?: boolean;
  codingSuitability?: number;
  reasoningSuitability?: number;
  access?: AccessClassification;
  accessNotes?: string;
}

const FREE_TIER_NOTE =
  'Provider advertises a free tier with provider-controlled limits. Eligibility, models, and limits can change at any time. Verify current terms in the provider console.';

/**
 * Small, curated metadata overlay. This is not a source of truth for pricing or
 * free access — it fills in capabilities and context sizes that model-list APIs
 * do not expose. Access classification is only set where the provider publicly
 * documents a free tier or a zero-priced variant (OpenRouter).
 */
export const KNOWN_MODELS: Record<string, KnownModel> = {
  'gemini:gemini-2.5-pro': {
    displayName: 'Gemini 2.5 Pro',
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    supportsTools: true,
    supportsVision: true,
    codingSuitability: 5,
    reasoningSuitability: 5,
    access: 'free-tier',
    accessNotes: FREE_TIER_NOTE,
  },
  'gemini:gemini-2.5-flash': {
    displayName: 'Gemini 2.5 Flash',
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    supportsTools: true,
    supportsVision: true,
    codingSuitability: 4,
    reasoningSuitability: 4,
    access: 'free-tier',
    accessNotes: FREE_TIER_NOTE,
  },
  'gemini:gemini-2.5-flash-lite': {
    displayName: 'Gemini 2.5 Flash Lite',
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    supportsTools: true,
    supportsVision: true,
    codingSuitability: 3,
    reasoningSuitability: 3,
    access: 'free-tier',
    accessNotes: FREE_TIER_NOTE,
  },
  'gemini:gemini-2.0-flash': {
    displayName: 'Gemini 2.0 Flash',
    contextWindow: 1_048_576,
    maxOutputTokens: 8_192,
    supportsTools: true,
    supportsVision: true,
    codingSuitability: 3,
    reasoningSuitability: 3,
    access: 'free-tier',
    accessNotes: FREE_TIER_NOTE,
  },
  'gemini:gemini-2.0-flash-lite': {
    displayName: 'Gemini 2.0 Flash Lite',
    contextWindow: 1_048_576,
    maxOutputTokens: 8_192,
    supportsTools: true,
    supportsVision: true,
    codingSuitability: 2,
    reasoningSuitability: 2,
    access: 'free-tier',
    accessNotes: FREE_TIER_NOTE,
  },
  'groq:llama-3.3-70b-versatile': {
    displayName: 'Llama 3.3 70B Versatile',
    contextWindow: 131_072,
    maxOutputTokens: 32_768,
    supportsTools: true,
    codingSuitability: 3,
    reasoningSuitability: 3,
    access: 'free-tier',
    accessNotes: FREE_TIER_NOTE,
  },
  'groq:llama-3.1-8b-instant': {
    displayName: 'Llama 3.1 8B Instant',
    contextWindow: 131_072,
    maxOutputTokens: 8_192,
    supportsTools: true,
    codingSuitability: 2,
    reasoningSuitability: 2,
    access: 'free-tier',
    accessNotes: FREE_TIER_NOTE,
  },
  'groq:openai/gpt-oss-120b': {
    displayName: 'GPT-OSS 120B (Groq)',
    contextWindow: 131_072,
    maxOutputTokens: 65_536,
    supportsTools: true,
    codingSuitability: 4,
    reasoningSuitability: 4,
    access: 'free-tier',
    accessNotes: FREE_TIER_NOTE,
  },
  'groq:openai/gpt-oss-20b': {
    displayName: 'GPT-OSS 20B (Groq)',
    contextWindow: 131_072,
    maxOutputTokens: 65_536,
    supportsTools: true,
    codingSuitability: 3,
    reasoningSuitability: 3,
    access: 'free-tier',
    accessNotes: FREE_TIER_NOTE,
  },
  'groq:moonshotai/kimi-k2-instruct': {
    displayName: 'Kimi K2 Instruct (Groq)',
    contextWindow: 262_144,
    maxOutputTokens: 16_384,
    supportsTools: true,
    codingSuitability: 4,
    reasoningSuitability: 4,
    access: 'free-tier',
    accessNotes: FREE_TIER_NOTE,
  },
  'groq:qwen/qwen3-32b': {
    displayName: 'Qwen3 32B (Groq)',
    contextWindow: 131_072,
    maxOutputTokens: 40_960,
    supportsTools: true,
    codingSuitability: 3,
    reasoningSuitability: 4,
    access: 'free-tier',
    accessNotes: FREE_TIER_NOTE,
  },
};

function inferCodingSuitability(modelId: string): number {
  if (/coder|codex|deepseek-coder|qwen.*coder/i.test(modelId)) return 4;
  if (/o[134]|r1|reason|thinking|qwq/i.test(modelId)) return 3;
  if (/70b|120b|405b|large|pro|sonnet|opus/i.test(modelId)) return 4;
  return 2;
}

function inferReasoningSuitability(modelId: string): number {
  if (/o[134]|r1|reason|thinking|qwq|deepseek-r/i.test(modelId)) return 4;
  if (/pro|opus|70b|120b|405b/i.test(modelId)) return 4;
  return 2;
}

function isLikelyVision(modelId: string): boolean {
  return /vision|gemini|gpt-4o|gpt-4\.1|claude|llava|pixtral|qwen.*vl/i.test(modelId);
}

export interface AccessHints {
  /** Endpoint URL, used to recognise local and known free-tier hosts. */
  baseUrl?: string | null;
  /** Profile name, used only for explanatory notes. */
  profileName?: string | null;
}

/** Hosts that are local or published as free-tier developer endpoints. */
const FREE_HOST_PATTERNS: RegExp[] = [
  /^(?:localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|\[::1\])$/i,
  /(?:^|\.)models\.github\.ai$/i,
  /(?:^|\.)huggingface\.co$/i,
  /(?:^|\.)api-inference\.modelscope\.cn$/i,
  /(?:^|\.)modelscope\.cn$/i,
  /(?:^|\.)ai\.gitee\.com$/i,
  /(?:^|\.)siliconflow\.cn$/i,
  /(?:^|\.)open\.bigmodel\.cn$/i,
  /(?:^|\.)cloudflare\.com$/i,
  /(?:^|\.)cerebras\.ai$/i,
  /(?:^|\.)integrate\.api\.nvidia\.com$/i,
  /(?:^|\.)generativelanguage\.googleapis\.com$/i,
  /(?:^|\.)api\.groq\.com$/i,
];

/** Hosts where every model is billed by the provider. */
const PAID_HOST_PATTERNS: RegExp[] = [
  /(?:^|\.)api\.openai\.com$/i,
  /(?:^|\.)api\.deepseek\.com$/i,
  /(?:^|\.)api\.mistral\.ai$/i,
  /(?:^|\.)api\.x\.ai$/i,
  /(?:^|\.)api\.fireworks\.ai$/i,
  /(?:^|\.)api\.anthropic\.com$/i,
];

function hostnameOf(baseUrl: string | null | undefined): string | null {
  if (!baseUrl) return null;
  try {
    return new URL(baseUrl).hostname;
  } catch {
    return null;
  }
}

/** Models explicitly published as zero-cost, independent of provider. */
function isExplicitlyFreeModel(modelId: string): boolean {
  return /:free$/i.test(modelId) || /(?:^|[/:-])free(?:$|[/:-])/i.test(modelId);
}

export function classifyDiscoveredAccess(
  providerId: ProviderKind,
  model: DiscoveredModel,
  hints: AccessHints = {},
): { access: AccessClassification; source: string; notes: string | null } {
  const inputPrice = model.inputPricePerMillion;
  const outputPrice = model.outputPricePerMillion;
  const isZeroPriced =
    inputPrice !== null &&
    inputPrice !== undefined &&
    outputPrice !== null &&
    outputPrice !== undefined &&
    inputPrice === 0 &&
    outputPrice === 0;

  if (isExplicitlyFreeModel(model.modelId) || isZeroPriced) {
    return {
      access: 'free-confirmed',
      source: 'provider-model-catalog',
      notes:
        'The provider catalog lists this variant at zero prompt/completion price or marks it as free. Limits and availability can change.',
    };
  }

  // Google AI Studio and Groq run free developer tiers that cover their chat
  // models under rate limits; the per-token prices in their catalogs are
  // paid-plan rates, not a statement that the model is paid-only. Label them
  // free-tier so free-plan users can actually see and use them.
  if (providerId === 'gemini' || providerId === 'groq') {
    const priced = (inputPrice ?? 0) > 0 || (outputPrice ?? 0) > 0;
    return {
      access: 'free-tier',
      source: priced ? 'provider-model-catalog' : 'provider-model-list',
      notes: priced
        ? 'Listed with paid-plan per-token pricing; the provider free tier covers this model under rate limits.'
        : 'The provider publishes a free developer tier for this model. Limits are controlled by the provider.',
    };
  }

  // Positive per-token pricing always wins over provider-level heuristics.
  // A provider can offer a free tier while still billing for individual
  // models, so never label a priced model as free.
  if ((inputPrice ?? 0) > 0 || (outputPrice ?? 0) > 0) {
    return {
      access: 'paid',
      source:
        providerId === 'openrouter' ? 'openrouter-model-catalog' : 'provider-model-catalog',
      notes: 'The provider publishes non-zero per-token pricing for this model.',
    };
  }

  if (providerId === 'openrouter') {
    return { access: 'unknown', source: 'openrouter-model-catalog', notes: null };
  }

  if (providerId === 'openai') {
    return {
      access: 'paid',
      source: 'provider-documentation',
      notes: 'OpenAI API usage is billed by OpenAI. Check your account billing settings.',
    };
  }

  const host = hostnameOf(hints.baseUrl);
  if (host) {
    if (FREE_HOST_PATTERNS.some((pattern) => pattern.test(host))) {
      const local = /^(?:localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|\[::1\])$/i.test(host);
      if (local) {
        return {
          access: 'free-confirmed',
          source: 'endpoint-documentation',
          notes: 'Local/self-hosted endpoint — there is no per-token provider bill.',
        };
      }
      // A host that advertises a free developer tier does NOT make every model
      // on it free — providers like Groq and Google also bill for premium
      // models. Report the tier honestly instead of confirming free access.
      return {
        access: 'free-tier',
        source: 'endpoint-documentation',
        notes: `This endpoint host (${host}) publishes a free developer tier, but some models may still be billed. Verify per-model pricing.`,
      };
    }
    if (PAID_HOST_PATTERNS.some((pattern) => pattern.test(host))) {
      return {
        access: 'paid',
        source: 'endpoint-documentation',
        notes: `This endpoint host (${host}) bills API usage directly.`,
      };
    }
  }

  return { access: 'unknown', source: 'provider-model-list', notes: null };
}

/** Merge discovered model data with curated metadata and conservative heuristics. */
export function enrichDiscoveredModel(
  providerId: ProviderKind,
  discovered: DiscoveredModel,
  hints: AccessHints = {},
): DiscoveredModel {
  const known = KNOWN_MODELS[`${providerId}:${discovered.modelId}`];
  const access = classifyDiscoveredAccess(providerId, discovered, hints);
  return {
    ...discovered,
    displayName: known?.displayName ?? discovered.displayName ?? discovered.modelId,
    contextWindow: discovered.contextWindow ?? known?.contextWindow ?? null,
    maxOutputTokens: discovered.maxOutputTokens ?? known?.maxOutputTokens ?? null,
    supportsTools: discovered.supportsTools ?? known?.supportsTools ?? true,
    supportsStreaming: discovered.supportsStreaming ?? true,
    supportsVision:
      discovered.supportsVision ?? known?.supportsVision ?? isLikelyVision(discovered.modelId),
    inputPricePerMillion: discovered.inputPricePerMillion ?? null,
    outputPricePerMillion: discovered.outputPricePerMillion ?? null,
    metadata: {
      ...(discovered.metadata ?? {}),
      codingSuitability:
        discovered.metadata?.codingSuitability ??
        known?.codingSuitability ??
        inferCodingSuitability(discovered.modelId),
      reasoningSuitability:
        discovered.metadata?.reasoningSuitability ??
        known?.reasoningSuitability ??
        inferReasoningSuitability(discovered.modelId),
      access: known?.access ?? access.access,
      accessSource: known?.access ? 'provider-documentation' : access.source,
      accessNotes: known?.accessNotes ?? access.notes,
    },
  };
}

export function knownModelToInfo(providerId: ProviderKind, modelId: string): ModelInfo | null {
  const known = KNOWN_MODELS[`${providerId}:${modelId}`];
  if (!known) return null;
  return {
    id: `${providerId}:${modelId}`,
    providerId,
    profileId: null,
    modelId,
    displayName: known.displayName,
    contextWindow: known.contextWindow ?? null,
    maxOutputTokens: known.maxOutputTokens ?? null,
    supportsTools: known.supportsTools ?? true,
    supportsStreaming: true,
    supportsVision: known.supportsVision ?? false,
    codingSuitability: known.codingSuitability ?? 2,
    reasoningSuitability: known.reasoningSuitability ?? 2,
    inputPricePerMillion: null,
    outputPricePerMillion: null,
    access: known.access ?? 'unknown',
    accessSource: 'provider-documentation',
    accessNotes: known.accessNotes ?? null,
    available: false,
    lastCheckedAt: null,
    userClassification: null,
    metadata: { seeded: true },
  };
}

export function knownModelsForProvider(providerId: ProviderKind): ModelInfo[] {
  return Object.keys(KNOWN_MODELS)
    .filter((key) => key.startsWith(`${providerId}:`))
    .map((key) => knownModelToInfo(providerId, key.slice(providerId.length + 1)))
    .filter((model): model is ModelInfo => model !== null);
}

/** Effective access after applying the user's explicit classification. */
/** Find the profile that owns a catalog model. Custom endpoints are scoped. */
export function owningProfileForModel(
  profiles: ProviderProfile[],
  model: ModelInfo,
): ProviderProfile | null {
  if (model.profileId) return profiles.find((profile) => profile.id === model.profileId) ?? null;
  return (
    profiles.find(
      (profile) =>
        profile.providerId === model.providerId && profile.defaultModel === model.modelId,
    ) ??
    profiles.find((profile) => profile.providerId === model.providerId && profile.enabled) ??
    profiles.find((profile) => profile.providerId === model.providerId) ??
    null
  );
}

export function effectiveAccess(
  model: ModelInfo,
  profileAccess: AccessClassification | null = null,
): AccessClassification {
  if (model.userClassification) return model.userClassification;
  if (model.access !== 'unknown') return model.access;
  // A "free-tier" profile means the provider offers a free tier, not that
  // every model on the account is free. Only an explicit user classification
  // propagates to models whose own access is unknown.
  if (profileAccess === 'user-free' || profileAccess === 'user-paid') return profileAccess;
  return 'unknown';
}

export function isFreeAccess(access: AccessClassification): boolean {
  return access === 'free-confirmed' || access === 'free-tier' || access === 'user-free';
}

export function isPaidAccess(access: AccessClassification): boolean {
  return access === 'paid' || access === 'user-paid';
}

export const ACCESS_LABELS: Record<AccessClassification, string> = {
  'free-confirmed': 'Free (confirmed)',
  'free-tier': 'Free tier',
  paid: 'Paid',
  'user-free': 'User: free',
  'user-paid': 'User: paid',
  unknown: 'Unknown',
  unavailable: 'Unavailable',
};
