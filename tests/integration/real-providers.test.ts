import { afterEach, describe, expect, it } from 'vitest';
import { openStore, type Store } from '../../src/core/db/store.js';
import { PROVIDER_DEFINITIONS } from '../../src/core/providers/definitions.js';
import { createAdapter } from '../../src/core/providers/registry.js';
import { createProfileContext, testProfileConnection } from '../../src/core/providers/service.js';
import type { ProviderKind, ProviderProfile } from '../../src/core/types.js';
import { redactSecrets } from '../../src/core/security/redact.js';

/**
 * Manual real-credential checks.
 *
 * These tests are skipped by default. Enable them explicitly:
 *
 *   PowerShell:
 *     $env:COMICODE_REAL_PROVIDER_TESTS="1"
 *     $env:GEMINI_API_KEY="..."        # or GROQ_API_KEY, etc.
 *     npm run test:integration
 *
 *   bash:
 *     COMICODE_REAL_PROVIDER_TESTS=1 GEMINI_API_KEY=... npm run test:integration
 *
 * They use an in-memory database and apiKeyEnv, so no credential is written to
 * the local credential store. CI must never set the gate or provider keys.
 */

const REAL_TESTS_ENABLED = process.env.COMICODE_REAL_PROVIDER_TESTS === '1';
const describeReal = REAL_TESTS_ENABLED ? describe : describe.skip;

const stores: Store[] = [];

afterEach(() => {
  while (stores.length > 0) {
    try {
      stores.pop()?.db.close();
    } catch {
      // Already closed.
    }
  }
});

function makeStore(): Store {
  const store = openStore(':memory:');
  stores.push(store);
  return store;
}

interface RealProviderCase {
  label: string;
  providerId: ProviderKind;
  envKey: string;
  modelEnv: string;
  fallbackModel: string | null;
  accessClassification: ProviderProfile['accessClassification'];
  baseUrl?: string;
  config?: Record<string, unknown>;
}

const CASES: RealProviderCase[] = [
  {
    label: 'Gemini',
    providerId: 'gemini',
    envKey: 'GEMINI_API_KEY',
    modelEnv: 'COMICODE_TEST_GEMINI_MODEL',
    fallbackModel: 'gemini-2.5-flash',
    accessClassification: 'free-tier',
  },
  {
    label: 'Groq',
    providerId: 'groq',
    envKey: 'GROQ_API_KEY',
    modelEnv: 'COMICODE_TEST_GROQ_MODEL',
    fallbackModel: 'llama-3.3-70b-versatile',
    accessClassification: 'free-tier',
  },
  {
    label: 'OpenRouter',
    providerId: 'openrouter',
    envKey: 'OPENROUTER_API_KEY',
    modelEnv: 'COMICODE_TEST_OPENROUTER_MODEL',
    // Deliberately unset: OpenRouter models vary in price and free variants
    // change frequently, so a chat check only runs when the user names one.
    fallbackModel: null,
    accessClassification: 'unknown',
  },
  {
    label: 'OpenAI',
    providerId: 'openai',
    envKey: 'OPENAI_API_KEY',
    modelEnv: 'COMICODE_TEST_OPENAI_MODEL',
    // Same as OpenRouter: never spend money on an unrequested model.
    fallbackModel: null,
    accessClassification: 'paid',
  },
];

function createRealProfile(
  store: Store,
  input: RealProviderCase,
  model: string | null,
): ProviderProfile {
  const definition = PROVIDER_DEFINITIONS[input.providerId];
  return store.createProfile({
    providerId: input.providerId,
    name: `Real ${input.label}`,
    baseUrl: input.baseUrl ?? definition.defaultBaseUrl,
    authType: definition.authType,
    defaultModel: model,
    apiKeyEnv: input.envKey,
    accessClassification: input.accessClassification,
    config: input.config ?? {},
  });
}

async function expectUsableResponse(profile: ProviderProfile, model: string): Promise<void> {
  const context = await createProfileContext(profile);
  const adapter = createAdapter(profile);
  const response = await adapter.chat(
    context,
    {
      model,
      messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
      temperature: 0,
      maxOutputTokens: 16,
    },
    {},
  );
  expect(response.content.length + response.toolCalls.length).toBeGreaterThan(0);
}

describeReal('real provider connections', () => {
  for (const testCase of CASES) {
    const hasKey = Boolean(process.env[testCase.envKey]?.trim());
    const run = hasKey ? it : it.skip;

    run(
      `${testCase.label}: connects, lists models, and answers a minimal prompt`,
      async () => {
        const store = makeStore();
        const model = process.env[testCase.modelEnv]?.trim() || testCase.fallbackModel || null;
        const profile = createRealProfile(store, testCase, model);

        const connection = await testProfileConnection(store, profile);
        expect(connection.ok, redactSecrets(connection.message)).toBe(true);
        expect(connection.modelCount ?? 0).toBeGreaterThan(0);

        if (model) {
          await expectUsableResponse(profile, model);
        }
      },
      60_000,
    );
  }

  const customBaseUrl = process.env.COMICODE_CUSTOM_BASE_URL?.trim();
  const customKey = process.env.COMICODE_CUSTOM_API_KEY?.trim();
  const customModel = process.env.COMICODE_CUSTOM_MODEL?.trim();
  const customAvailable = Boolean(customBaseUrl && customModel);
  const runCustom = customAvailable ? it : it.skip;

  runCustom(
    'Custom endpoint: connects and answers a minimal prompt',
    async () => {
      const store = makeStore();
      const apiStyle =
        process.env.COMICODE_CUSTOM_API_STYLE === 'gemini' ? 'gemini' : 'openai-compatible';
      const profile = store.createProfile({
        providerId: 'custom',
        name: 'Real custom endpoint',
        baseUrl: customBaseUrl!,
        authType: apiStyle === 'gemini' ? 'api-key' : 'bearer',
        defaultModel: customModel!,
        // Always set apiKeyEnv so a no-auth run never consults the real
        // credential store. An empty value plus allowNoAuth resolves to none.
        apiKeyEnv: 'COMICODE_CUSTOM_API_KEY',
        accessClassification: 'unknown',
        config: {
          apiStyle,
          allowNoAuth: !customKey,
          authHeader:
            process.env.COMICODE_CUSTOM_AUTH_HEADER?.trim() ||
            (apiStyle === 'gemini' ? 'x-goog-api-key' : 'Authorization'),
          authPrefix:
            process.env.COMICODE_CUSTOM_AUTH_PREFIX ?? (apiStyle === 'gemini' ? '' : 'Bearer '),
          supportsModelDiscovery: process.env.COMICODE_CUSTOM_DISCOVERY !== '0',
          testWithChat: true,
        },
      });

      const connection = await testProfileConnection(store, profile);
      expect(connection.ok, redactSecrets(connection.message)).toBe(true);
      await expectUsableResponse(profile, customModel!);
    },
    60_000,
  );
});
