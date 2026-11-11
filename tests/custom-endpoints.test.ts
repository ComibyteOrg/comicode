import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { openStore, type Store } from '../src/core/db/store.js';
import {
  endpointConfigForStorage,
  readEndpointConfig,
  sanitizeExtraHeaders,
} from '../src/core/providers/profile-config.js';
import { resolveProfileCredential } from '../src/core/providers/service.js';
import { ProviderError } from '../src/core/providers/errors.js';
import { OpenAICompatibleAdapter } from '../src/core/providers/openai-compatible.js';
import { GeminiAdapter } from '../src/core/providers/gemini.js';
import { createAdapter } from '../src/core/providers/registry.js';
import type { ProviderProfile } from '../src/core/types.js';

const stores: Store[] = [];
const previousHome = process.env.COMICODE_HOME;
let tempHome = '';

beforeAll(() => {
  // Credential resolution for no-auth profiles can still touch the credential
  // store. Keep every test in a disposable home so the developer's real keys
  // and database are never read or modified.
  tempHome = mkdtempSync(join(tmpdir(), 'comicode-custom-endpoints-'));
  process.env.COMICODE_HOME = tempHome;
});

afterAll(() => {
  if (previousHome === undefined) {
    delete process.env.COMICODE_HOME;
  } else {
    process.env.COMICODE_HOME = previousHome;
  }
  try {
    rmSync(tempHome, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    // Best-effort cleanup on Windows.
  }
});

function makeStore(): Store {
  const store = openStore(':memory:');
  stores.push(store);
  return store;
}

afterEach(() => {
  delete process.env.COMICODE_TEST_API_KEY;
  while (stores.length > 0) {
    try {
      stores.pop()?.db.close();
    } catch {
      // Already closed.
    }
  }
});

function customProfile(store: Store, config: Record<string, unknown> = {}): ProviderProfile {
  return store.createProfile({
    providerId: 'custom',
    name: 'My platform',
    baseUrl: 'https://gateway.example.com/v1/',
    authType: 'bearer',
    defaultModel: 'my-model',
    accessClassification: 'unknown',
    config,
  });
}

describe('custom endpoint configuration', () => {
  it('applies safe defaults for arbitrary OpenAI-compatible endpoints', () => {
    const store = makeStore();
    const profile = customProfile(store);
    const config = readEndpointConfig(profile);
    expect(config.apiStyle).toBe('openai-compatible');
    expect(config.authHeader).toBe('Authorization');
    expect(config.authPrefix).toBe('Bearer ');
    expect(config.chatPath).toBe('/chat/completions');
    expect(config.modelsPath).toBe('/models');
    expect(config.maxTokensParam).toBe('max_tokens');
    expect(config.supportsModelDiscovery).toBe(true);
    expect(config.supportsStreaming).toBe(true);
    expect(config.allowNoAuth).toBe(false);
  });

  it('supports custom auth headers, paths, headers, and token parameters', () => {
    const store = makeStore();
    const profile = customProfile(store, {
      apiStyle: 'openai-compatible',
      authHeader: 'x-api-key',
      authPrefix: '',
      chatPath: '/v2/chat',
      modelsPath: '/v2/models',
      maxTokensParam: 'max_completion_tokens',
      extraHeaders: { 'X-Organization': 'comicode' },
      preset: 'azure-like',
      notes: 'self-hosted gateway',
    });
    const config = readEndpointConfig(profile);
    expect(config.authHeader).toBe('x-api-key');
    expect(config.authPrefix).toBe('');
    expect(config.chatPath).toBe('/v2/chat');
    expect(config.maxTokensParam).toBe('max_completion_tokens');
    expect(config.extraHeaders).toEqual({ 'X-Organization': 'comicode' });
    expect(config.preset).toBe('azure-like');
  });

  it('never persists credential-like keys inside profile config', () => {
    const config = endpointConfigForStorage({
      apiStyle: 'openai-compatible',
      apiKey: 'should-not-persist',
      api_key: 'should-not-persist',
      token: 'should-not-persist',
      authorization: 'Bearer should-not-persist',
      extraHeaders: { 'X-Trace': 'ok' },
    });
    expect(JSON.stringify(config)).not.toContain('should-not-persist');
    expect(config.extraHeaders).toEqual({ 'X-Trace': 'ok' });
    expect(config.apiStyle).toBe('openai-compatible');
  });

  it('sanitizes extra headers to safe names and strips newlines', () => {
    const headers = sanitizeExtraHeaders({
      'X-Trace': 'abc\r\ndef',
      Authorization: 'Bearer secret',
      'x-api-key': 'secret',
      Cookie: 'session=1',
      'Bad Header': 'nope',
      'X-Custom': 'ok',
    });
    expect(headers).toEqual({ 'X-Trace': 'abcdef', 'X-Custom': 'ok' });
  });

  it('rejects invalid endpoint configuration before it hits the database', () => {
    expect(() => endpointConfigForStorage({ apiStyle: 'unknown' as never })).toThrow(
      /Invalid endpoint configuration/,
    );
    expect(() => endpointConfigForStorage({ chatPath: '' })).toThrow(
      /Invalid endpoint configuration/,
    );
  });

  it('resolves credentials from environment variables without touching the database', async () => {
    const store = makeStore();
    const profile = store.createProfile({
      providerId: 'gemini',
      name: 'Env key',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      authType: 'api-key',
      apiKeyEnv: 'COMICODE_TEST_API_KEY',
      accessClassification: 'user-free',
    });
    process.env.COMICODE_TEST_API_KEY = 'env-secret-1234567890';
    const resolved = await resolveProfileCredential(profile);
    expect(resolved).toEqual({
      apiKey: 'env-secret-1234567890',
      source: 'environment',
      keyIndex: 0,
      keyCount: 1,
    });

    delete process.env.COMICODE_TEST_API_KEY;
    await expect(resolveProfileCredential(profile)).rejects.toBeInstanceOf(ProviderError);
  });

  it('allows no-auth local endpoints', async () => {
    const store = makeStore();
    const profile = customProfile(store, { allowNoAuth: true, apiStyle: 'openai-compatible' });
    const resolved = await resolveProfileCredential(profile);
    expect(resolved).toEqual({ apiKey: '', source: 'none', keyIndex: 0, keyCount: 1 });
  });
});

describe('custom endpoint transport', () => {
  it('uses the configured paths, auth header, and extra headers', async () => {
    const store = makeStore();
    const profile = customProfile(store, {
      apiStyle: 'openai-compatible',
      authHeader: 'x-api-key',
      authPrefix: '',
      chatPath: '/v2/chat',
      modelsPath: '/v2/models',
      maxTokensParam: 'max_completion_tokens',
      extraHeaders: { 'X-Organization': 'comicode', Authorization: 'must-be-removed' },
    });
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      if (String(url).endsWith('/v2/models')) {
        return new Response(
          JSON.stringify({
            data: [
              { id: 'chat-model', name: 'Chat Model', context_length: 32000 },
              { id: 'text-embedding-3-small', name: 'embedding' },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: 'hello' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;

    const adapter = createAdapter(profile);
    expect(adapter).toBeInstanceOf(OpenAICompatibleAdapter);

    const context = { profile, apiKey: 'custom-secret-key', fetchImpl };
    const models = await adapter.listModels(context);
    expect(calls[0]?.url).toBe('https://gateway.example.com/v1/v2/models');
    const listHeaders = calls[0]?.init.headers as Record<string, string>;
    expect(listHeaders['x-api-key']).toBe('custom-secret-key');
    expect(listHeaders['X-Organization']).toBe('comicode');
    expect(listHeaders.Authorization).toBeUndefined();
    expect(models.map((entry) => entry.modelId)).toEqual(['chat-model']);
    expect(models[0]?.contextWindow).toBe(32000);

    const response = await adapter.chat(context, {
      model: 'chat-model',
      messages: [{ role: 'user', content: 'hi' }],
      maxOutputTokens: 64,
    });
    expect(response.content).toBe('hello');
    expect(response.usage?.totalTokens).toBe(5);
    expect(calls[1]?.url).toBe('https://gateway.example.com/v1/v2/chat');
    const body = JSON.parse(String(calls[1]?.init.body)) as Record<string, unknown>;
    expect(body.stream).toBe(false);
    expect(body.max_completion_tokens).toBe(64);
    expect(body.max_tokens).toBeUndefined();
  });

  it('selects the Gemini protocol for Gemini-compatible custom endpoints', () => {
    const store = makeStore();
    const profile = customProfile(store, {
      apiStyle: 'gemini',
      authHeader: 'x-goog-api-key',
      authPrefix: '',
    });
    expect(createAdapter(profile)).toBeInstanceOf(GeminiAdapter);
  });
});
