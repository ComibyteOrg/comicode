import { z } from 'zod';
import type { ProviderProfile } from '../types.js';

/**
 * Per-profile endpoint configuration. These fields are non-secret and may be
 * exported. API keys never live in this object.
 */
export const EndpointConfigSchema = z
  .object({
    /** Protocol used by a custom endpoint. Built-in providers have fixed defaults. */
    apiStyle: z.enum(['openai-compatible', 'gemini']).default('openai-compatible'),
    /** Local servers such as Ollama/LM Studio may not require an API key. */
    allowNoAuth: z.boolean().default(false),
    /** Header used to send the credential (custom endpoints). */
    authHeader: z.string().min(1).max(100).default('Authorization'),
    /** Prefix for the credential value. Use an empty string for headers like `api-key`. */
    authPrefix: z.string().max(100).default('Bearer '),
    /** Additional non-secret headers sent with every request. */
    extraHeaders: z.record(z.string(), z.string()).default({}),
    chatPath: z.string().min(1).max(300).default('/chat/completions'),
    modelsPath: z.string().min(1).max(300).default('/models'),
    maxTokensParam: z.enum(['max_tokens', 'max_completion_tokens']).default('max_tokens'),
    supportsModelDiscovery: z.boolean().default(true),
    supportsStreaming: z.boolean().default(true),
    /** Explicitly opt in to a tiny paid/consuming request for connection tests. */
    testWithChat: z.boolean().default(false),
    /** Some gateways reject stream_options; enable to request token usage in streams. */
    streamUsage: z.boolean().default(false),
    /** Optional override when the endpoint does not publish context limits. */
    contextWindowOverride: z.number().int().positive().nullable().default(null),
    /** A human-readable preset name (e.g. DeepSeek, Ollama). */
    preset: z.string().max(100).nullable().default(null),
    notes: z.string().max(1000).nullable().default(null),
  })
  .passthrough();

export type EndpointConfig = z.infer<typeof EndpointConfigSchema>;

export function readEndpointConfig(profile: ProviderProfile): EndpointConfig {
  const parsed = EndpointConfigSchema.safeParse(profile.config ?? {});
  return parsed.success ? parsed.data : EndpointConfigSchema.parse({});
}

export function endpointConfigForStorage(
  raw: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const parsed = EndpointConfigSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    throw new Error(
      `Invalid endpoint configuration: ${parsed.error.issues[0]?.message ?? 'unknown'}`,
    );
  }
  // Never persist credential-like keys in profile config, even if a caller tries.
  const copy: Record<string, unknown> = { ...parsed.data };
  for (const key of Object.keys(copy)) {
    if (/apikey|api_key|token|secret|password|authorization/i.test(key)) delete copy[key];
  }
  return copy;
}

export function sanitizeExtraHeaders(headers: Record<string, string>): Record<string, string> {
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const trimmedKey = key.trim();
    if (!/^[A-Za-z0-9-]+$/.test(trimmedKey)) continue;
    if (/authorization|api[-_]?key|cookie/i.test(trimmedKey)) continue;
    output[trimmedKey] = value.replace(/[\r\n]/g, '').slice(0, 500);
  }
  return output;
}
