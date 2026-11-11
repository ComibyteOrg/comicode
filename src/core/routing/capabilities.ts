import type { ModelInfo, TaskType } from '../types.js';

/**
 * Capability profile for a model. Scores are 0-10 estimates derived ONLY from
 * real signals: catalog suitability fields, feature flags, context/output
 * limits, pricing metadata, and explicit `metadata.capabilities` overrides
 * (which adapters or users may set — never invented).
 */
export interface ModelCapabilities {
  reasoning: number;
  coding: number;
  instruction: number;
  tools: number;
  structured: number;
  speed: number;
  vision: number;
  context: number;
  /** 0 = cheapest/free, 10 = most expensive. */
  cost: number;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(10, value));
}

function metadataNumber(model: ModelInfo, key: string): number | null {
  const raw = model.metadata?.capabilities;
  if (raw && typeof raw === 'object') {
    const value = (raw as Record<string, unknown>)[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
}

/** Derive a capability profile from observable model data. */
export function modelCapabilities(model: ModelInfo): ModelCapabilities {
  const meta = (key: string): number | null => metadataNumber(model, key);
  const contextScore = model.contextWindow
    ? clamp(Math.log10(model.contextWindow) * 2.2 - 5)
    : 4;
  const inPrice = model.inputPricePerMillion;
  const outPrice = model.outputPricePerMillion;
  const costScore =
    inPrice === null && outPrice === null
      ? 4 // unknown pricing — neutral
      : clamp(
          Math.log10(Math.max(0.01, (inPrice ?? 0) + (outPrice ?? 0) * 3)) * 3 + 2,
        );
  return {
    reasoning: meta('reasoning') ?? clamp(model.reasoningSuitability * 2),
    coding: meta('coding') ?? clamp(model.codingSuitability * 2),
    instruction: meta('instruction') ?? clamp(model.codingSuitability),
    tools: meta('tools') ?? (model.supportsTools ? 8 : 0),
    structured: meta('structured') ?? (model.supportsTools ? 7 : 3),
    speed: meta('speed') ?? 5, // providers rarely report latency; neutral default
    vision: meta('vision') ?? (model.supportsVision ? 9 : 0),
    context: meta('context') ?? contextScore,
    cost: meta('cost') ?? costScore,
  };
}

/** How much each capability matters for a given task type. */
export function capabilityWeights(taskType: TaskType): Partial<Record<keyof ModelCapabilities, number>> {
  switch (taskType) {
    case 'coding':
      return { coding: 3, tools: 2.5, instruction: 2, reasoning: 1.5, context: 1, structured: 1 };
    case 'reasoning':
    case 'review':
      return { reasoning: 3, instruction: 2, coding: 1.5, context: 1.5, structured: 1 };
    case 'vision':
      return { vision: 4, coding: 1.5, tools: 1.5, context: 1 };
    case 'general':
    default:
      return { instruction: 2.5, reasoning: 2, coding: 1.5, speed: 1, cost: 0.5 };
  }
}

/** Weighted capability score (0-~100) for ranking candidates. */
export function capabilityScore(model: ModelInfo, taskType: TaskType): number {
  const caps = modelCapabilities(model);
  const weights = capabilityWeights(taskType);
  let score = 0;
  let totalWeight = 0;
  for (const [key, weight] of Object.entries(weights) as Array<
    [keyof ModelCapabilities, number]
  >) {
    score += caps[key] * weight;
    totalWeight += weight;
  }
  // Cost is a mild negative signal — cheaper is better when capabilities tie.
  score -= caps.cost * 0.4;
  return totalWeight > 0 ? score / totalWeight : score;
}
