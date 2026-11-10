import type { AccessClassification, DiscoveredModel, ModelInfo, ProviderKind } from '../types.js';

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

export function classifyDiscoveredAccess(
  providerId: ProviderKind,
  model: DiscoveredModel,
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

  if (providerId === 'openrouter') {
    if (/:free$/i.test(model.modelId) || isZeroPriced) {
      return {
        access: 'free-confirmed',
        source: 'openrouter-model-catalog',
        notes:
          'OpenRouter listed this variant at zero prompt/completion price when the catalog was refreshed. Limits and availability can change.',
      };
    }
    if ((inputPrice ?? 0) > 0 || (outputPrice ?? 0) > 0) {
      return {
        access: 'paid',
        source: 'openrouter-model-catalog',
        notes: 'OpenRouter publishes non-zero pricing for this model.',
      };
    }
    return { access: 'unknown', source: 'openrouter-model-catalog', notes: null };
  }
  if (providerId === 'openai') {
    return {
      access: 'paid',
      source: 'provider-documentation',
      notes: 'OpenAI API usage is billed by OpenAI. Check your account billing settings.',
    };
  }
  return { access: 'unknown', source: 'provider-model-list', notes: null };
}

/** Merge discovered model data with curated metadata and conservative heuristics. */
export function enrichDiscoveredModel(
  providerId: ProviderKind,
  discovered: DiscoveredModel,
): DiscoveredModel {
  const known = KNOWN_MODELS[`${providerId}:${discovered.modelId}`];
  const access = classifyDiscoveredAccess(providerId, discovered);
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
export function effectiveAccess(
  model: ModelInfo,
  profileAccess: AccessClassification | null = null,
): AccessClassification {
  if (model.userClassification) return model.userClassification;
  if (model.access !== 'unknown') return model.access;
  if (profileAccess && profileAccess !== 'unknown') return profileAccess;
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
