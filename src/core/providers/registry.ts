import type { ProviderAdapter } from './adapter.js';
import type { ProviderProfile } from '../types.js';
import { GeminiAdapter } from './gemini.js';
import { OpenAICompatibleAdapter } from './openai-compatible.js';
import { readEndpointConfig } from './profile-config.js';

/**
 * Resolve the transport adapter for a profile. Built-in providers use their
 * dedicated protocol; custom endpoints can select either protocol and are
 * otherwise identical to first-class providers.
 */
export function createAdapter(profile: ProviderProfile): ProviderAdapter {
  const config = readEndpointConfig(profile);
  if (profile.providerId === 'gemini' || config.apiStyle === 'gemini') {
    return new GeminiAdapter(profile.providerId);
  }
  return new OpenAICompatibleAdapter(profile.providerId);
}
