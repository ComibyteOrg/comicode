import type { ProviderDefinition, ProviderKind } from '../types.js';

export const PROVIDER_DEFINITIONS: Record<ProviderKind, ProviderDefinition> = {
  gemini: {
    id: 'gemini',
    name: 'Google AI Studio',
    description: 'Gemini API models through Google AI Studio (generativelanguage.googleapis.com).',
    adapter: 'gemini',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    authType: 'api-key',
    docsUrl: 'https://ai.google.dev/gemini-api/docs',
    keyHint: 'AIza...',
    supportsModelDiscovery: true,
    customBaseUrl: true,
  },
  groq: {
    id: 'groq',
    name: 'Groq',
    description: 'Fast OpenAI-compatible inference from GroqCloud.',
    adapter: 'openai-compatible',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    authType: 'bearer',
    docsUrl: 'https://console.groq.com/docs',
    keyHint: 'gsk_...',
    supportsModelDiscovery: true,
    customBaseUrl: true,
  },
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    description: 'OpenAI-compatible gateway with many models and optional free variants.',
    adapter: 'openai-compatible',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    authType: 'bearer',
    docsUrl: 'https://openrouter.ai/docs',
    keyHint: 'sk-or-v1-...',
    supportsModelDiscovery: true,
    customBaseUrl: true,
  },
  openai: {
    id: 'openai',
    name: 'OpenAI',
    description: 'OpenAI platform API.',
    adapter: 'openai-compatible',
    defaultBaseUrl: 'https://api.openai.com/v1',
    authType: 'bearer',
    docsUrl: 'https://platform.openai.com/docs',
    keyHint: 'sk-...',
    supportsModelDiscovery: true,
    customBaseUrl: true,
  },
  custom: {
    id: 'custom',
    name: 'OpenAI-compatible endpoint',
    description: 'Any server implementing the OpenAI chat completions and models APIs.',
    adapter: 'openai-compatible',
    defaultBaseUrl: '',
    authType: 'bearer',
    docsUrl: 'https://platform.openai.com/docs/api-reference',
    keyHint: 'Provider key (optional for local endpoints)',
    supportsModelDiscovery: true,
    customBaseUrl: true,
  },
};

export function getProviderDefinition(id: ProviderKind): ProviderDefinition {
  return PROVIDER_DEFINITIONS[id] ?? PROVIDER_DEFINITIONS.custom;
}

export const PROVIDER_ORDER: ProviderKind[] = ['gemini', 'groq', 'openrouter', 'openai', 'custom'];

export interface ProviderPreset {
  id: string;
  label: string;
  baseUrl: string;
  docsUrl: string;
  /** Style of API used by this service. */
  apiStyle: 'openai-compatible' | 'gemini';
  /** Local endpoints often need no credential. */
  requiresKey: boolean;
  /** Optional header scheme for services that do not use Bearer auth. */
  authHeader?: string;
  authPrefix?: string;
  notes: string;
  exampleModel: string;
}

/**
 * Convenience presets for custom endpoints. They are not privileged adapters —
 * every entry uses the same configurable OpenAI-compatible or Gemini-compatible
 * transport, so any compatible endpoint works even without a preset.
 */
export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    docsUrl: 'https://api-docs.deepseek.com',
    apiStyle: 'openai-compatible',
    requiresKey: true,
    notes: 'OpenAI-compatible API. Pricing is controlled by DeepSeek.',
    exampleModel: 'deepseek-chat',
  },
  {
    id: 'mistral',
    label: 'Mistral AI',
    baseUrl: 'https://api.mistral.ai/v1',
    docsUrl: 'https://docs.mistral.ai',
    apiStyle: 'openai-compatible',
    requiresKey: true,
    notes: 'OpenAI-compatible chat completions.',
    exampleModel: 'mistral-large-latest',
  },
  {
    id: 'xai',
    label: 'xAI',
    baseUrl: 'https://api.x.ai/v1',
    docsUrl: 'https://docs.x.ai',
    apiStyle: 'openai-compatible',
    requiresKey: true,
    notes: 'OpenAI-compatible API.',
    exampleModel: 'grok-2-latest',
  },
  {
    id: 'together',
    label: 'Together AI',
    baseUrl: 'https://api.together.xyz/v1',
    docsUrl: 'https://docs.together.ai',
    apiStyle: 'openai-compatible',
    requiresKey: true,
    notes: 'OpenAI-compatible API with many open models.',
    exampleModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
  },
  {
    id: 'fireworks',
    label: 'Fireworks AI',
    baseUrl: 'https://api.fireworks.ai/inference/v1',
    docsUrl: 'https://docs.fireworks.ai',
    apiStyle: 'openai-compatible',
    requiresKey: true,
    notes: 'OpenAI-compatible inference endpoint.',
    exampleModel: 'accounts/fireworks/models/llama-v3p3-70b-instruct',
  },
  {
    id: 'cerebras',
    label: 'Cerebras',
    baseUrl: 'https://api.cerebras.ai/v1',
    docsUrl: 'https://inference-docs.cerebras.ai',
    apiStyle: 'openai-compatible',
    requiresKey: true,
    notes: 'OpenAI-compatible inference endpoint.',
    exampleModel: 'llama-3.3-70b',
  },
  {
    id: 'ollama',
    label: 'Ollama (local)',
    baseUrl: 'http://localhost:11434/v1',
    docsUrl: 'https://ollama.com',
    apiStyle: 'openai-compatible',
    requiresKey: false,
    notes: 'Local server. ComiCode does not run or download models; start Ollama separately.',
    exampleModel: 'llama3.2',
  },
  {
    id: 'lmstudio',
    label: 'LM Studio (local)',
    baseUrl: 'http://localhost:1234/v1',
    docsUrl: 'https://lmstudio.ai/docs',
    apiStyle: 'openai-compatible',
    requiresKey: false,
    notes: 'Local server. Start the LM Studio server before connecting.',
    exampleModel: 'local-model',
  },
  {
    id: 'vllm',
    label: 'vLLM / local OpenAI server',
    baseUrl: 'http://localhost:8000/v1',
    docsUrl: 'https://docs.vllm.ai',
    apiStyle: 'openai-compatible',
    requiresKey: false,
    notes: 'Any local OpenAI-compatible server can be used. No GPU is required by ComiCode itself.',
    exampleModel: 'your-model',
  },
  {
    id: 'azure-openai',
    label: 'Azure OpenAI',
    baseUrl: 'https://YOUR-RESOURCE.openai.azure.com/openai/deployments/YOUR-DEPLOYMENT',
    docsUrl: 'https://learn.microsoft.com/azure/ai-services/openai',
    apiStyle: 'openai-compatible',
    requiresKey: true,
    authHeader: 'api-key',
    authPrefix: '',
    notes:
      'Use your deployment path as the base URL and set the API version query string if required. Model discovery may be unavailable.',
    exampleModel: 'gpt-4o',
  },
  {
    id: 'litellm',
    label: 'LiteLLM proxy',
    baseUrl: 'http://localhost:4000/v1',
    docsUrl: 'https://docs.litellm.ai',
    apiStyle: 'openai-compatible',
    requiresKey: false,
    notes: 'LiteLLM can proxy many upstream providers behind one OpenAI-compatible endpoint.',
    exampleModel: 'gpt-4o-mini',
  },
];

export function providerDisplayName(id: string): string {
  return PROVIDER_DEFINITIONS[id as ProviderKind]?.name ?? id;
}
