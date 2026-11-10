import { describe, expect, it } from 'vitest';
import {
  classifyProviderError,
  classifyThrown,
  describeCategory,
  parseDurationMs,
  parseErrorBody,
  parseRetryAfter,
  ProviderError,
} from '../src/core/providers/errors.js';

const NOW = Date.parse('2026-06-01T12:00:00.000Z');

function isoIn(ms: number): string {
  return new Date(NOW + ms).toISOString();
}

describe('Retry-After and duration parsing', () => {
  it('parses Retry-After seconds into an absolute timestamp', () => {
    expect(parseRetryAfter('30', NOW)).toBe(isoIn(30_000));
    expect(parseRetryAfter('0', NOW)).toBe(new Date(NOW).toISOString());
  });

  it('parses HTTP-date Retry-After values', () => {
    const date = 'Mon, 01 Jun 2026 12:05:00 GMT';
    expect(parseRetryAfter(date, NOW)).toBe(new Date(date).toISOString());
  });

  it('returns null for missing or invalid Retry-After values', () => {
    expect(parseRetryAfter(null, NOW)).toBeNull();
    expect(parseRetryAfter('', NOW)).toBeNull();
    expect(parseRetryAfter('later', NOW)).toBeNull();
    expect(parseRetryAfter('-5', NOW)).toBeNull();
  });

  it('parses provider duration syntax without inventing precision', () => {
    expect(parseDurationMs('30')).toBe(30_000);
    expect(parseDurationMs('2m59.56s')).toBe(179_560);
    expect(parseDurationMs('1h2m')).toBe(3_720_000);
    expect(parseDurationMs('450ms')).toBeNull();
    expect(parseDurationMs('')).toBeNull();
  });
});

describe('provider error classification', () => {
  it('distinguishes a daily quota from a short rate limit on 429', () => {
    const daily = classifyProviderError({
      providerId: 'gemini',
      status: 429,
      headers: { 'retry-after': '30' },
      body: JSON.stringify({
        error: { message: 'You exceeded your current quota. Quota exceeded for metric: per day' },
      }),
      nowMs: NOW,
    });
    expect(daily.category).toBe('daily_quota');
    expect(daily.retryAfterAt).toBe(isoIn(30_000));
    expect(daily.resetAt).toBeNull();

    const rate = classifyProviderError({
      providerId: 'groq',
      status: 429,
      body: 'Rate limit reached. Please retry in 12.5s.',
      nowMs: NOW,
    });
    expect(rate.category).toBe('rate_limit');
    expect(rate.retryAfterAt).toBe(isoIn(12_500));
  });

  it('honors provider reset headers and Gemini retryDelay', () => {
    const header = classifyProviderError({
      providerId: 'groq',
      status: 429,
      headers: { 'x-ratelimit-reset-requests': '1m30s' },
      body: 'Rate limit exceeded',
      nowMs: NOW,
    });
    expect(header.resetAt).toBe(isoIn(90_000));

    const gemini = classifyProviderError({
      providerId: 'gemini',
      status: 429,
      body: JSON.stringify({
        error: {
          message: 'Quota exceeded',
          details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '59s' }],
        },
      }),
      nowMs: NOW,
    });
    expect(gemini.retryAfterAt).toBe(isoIn(59_000));
  });

  it('classifies authentication, billing, model, context, and tool failures', () => {
    expect(
      classifyProviderError({
        providerId: 'openai',
        status: 401,
        body: JSON.stringify({
          error: { message: 'Incorrect API key provided', code: 'invalid_api_key' },
        }),
      }).category,
    ).toBe('invalid_api_key');

    expect(
      classifyProviderError({ providerId: 'openai', status: 401, body: 'Unauthorized' }).category,
    ).toBe('auth_failure');

    expect(
      classifyProviderError({ providerId: 'openai', status: 402, body: 'Payment required' })
        .category,
    ).toBe('billing_restriction');

    expect(
      classifyProviderError({
        providerId: 'openai',
        status: 403,
        body: 'Your credit balance is too low for this request',
      }).category,
    ).toBe('billing_restriction');

    expect(
      classifyProviderError({ providerId: 'groq', status: 404, body: 'model not found' }).category,
    ).toBe('model_unavailable');

    expect(
      classifyProviderError({
        providerId: 'openai',
        status: 400,
        body: JSON.stringify({ error: { message: 'context_length_exceeded' } }),
      }).category,
    ).toBe('context_length');

    expect(
      classifyProviderError({
        providerId: 'openai',
        status: 400,
        body: 'This model does not support tools or function calling.',
      }).category,
    ).toBe('unsupported_tool_calling');

    expect(
      classifyProviderError({ providerId: 'groq', status: 400, body: 'bad request' }).category,
    ).toBe('invalid_request');
  });

  it('classifies outages, network failures, cancellation, and unknowns', () => {
    expect(
      classifyProviderError({ providerId: 'groq', status: 503, body: 'unavailable' }).category,
    ).toBe('provider_outage');
    expect(
      classifyProviderError({ providerId: 'groq', status: 504, body: 'gateway timeout' }).category,
    ).toBe('provider_outage');

    const network = classifyThrown(new TypeError('fetch failed'), 'groq');
    expect(network.category).toBe('network');
    expect(network.retryable).toBe(true);

    const abort = new Error('The operation was aborted');
    abort.name = 'AbortError';
    expect(classifyThrown(abort, 'openai').category).toBe('cancelled');

    expect(classifyThrown(new Error('something odd'), 'openai').category).toBe('unknown');
    expect(classifyThrown(new Error('something odd'), 'openai').retryable).toBe(false);
  });

  it('never invents a reset time when the provider supplies none', () => {
    const error = classifyProviderError({
      providerId: 'gemini',
      status: 429,
      body: 'Quota exceeded for this day',
      nowMs: NOW,
    });
    expect(error.category).toBe('daily_quota');
    expect(error.retryAfterAt).toBeNull();
    expect(error.resetAt).toBeNull();
  });

  it('redacts secrets found inside provider error bodies', () => {
    const parsed = parseErrorBody(
      JSON.stringify({ error: { message: 'bad key AIza' + 'a'.repeat(35) } }),
    );
    expect(parsed.message).not.toContain('AIza');
    expect(parsed.message).toContain('[REDACTED');

    const error = new ProviderError({
      providerId: 'openai',
      category: 'auth_failure',
      message: 'Authorization: Bearer sk-' + 'x'.repeat(30),
    });
    expect(error.message).not.toContain('sk-xxxx');
  });

  it('has a human-readable label for every category it emits', () => {
    for (const category of [
      'rate_limit',
      'daily_quota',
      'provider_outage',
      'network',
      'invalid_api_key',
      'auth_failure',
      'permission_error',
      'model_unavailable',
      'unsupported_tool_calling',
      'context_length',
      'billing_restriction',
      'invalid_request',
      'cancelled',
    ] as const) {
      expect(describeCategory(category)).not.toBe('Unknown provider error');
    }
    expect(describeCategory('unknown')).toBe('Unknown provider error');
  });
});
