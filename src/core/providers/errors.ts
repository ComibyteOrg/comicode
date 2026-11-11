import type { ErrorCategory } from '../types.js';
import { redactSecrets, safeErrorMessage } from '../security/redact.js';

export class ProviderError extends Error {
  readonly category: ErrorCategory;
  readonly status: number | null;
  readonly retryable: boolean;
  readonly retryAfterAt: string | null;
  readonly resetAt: string | null;
  readonly providerCode: string | null;
  readonly providerId: string;

  constructor(input: {
    message: string;
    category: ErrorCategory;
    providerId: string;
    status?: number | null;
    retryable?: boolean;
    retryAfterAt?: string | null;
    resetAt?: string | null;
    providerCode?: string | null;
  }) {
    super(redactSecrets(input.message));
    this.name = 'ProviderError';
    this.category = input.category;
    this.providerId = input.providerId;
    this.status = input.status ?? null;
    this.retryable = input.retryable ?? isRetryableCategory(input.category);
    this.retryAfterAt = input.retryAfterAt ?? null;
    this.resetAt = input.resetAt ?? null;
    this.providerCode = input.providerCode ?? null;
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      category: this.category,
      status: this.status,
      providerId: this.providerId,
      retryable: this.retryable,
      retryAfterAt: this.retryAfterAt,
      resetAt: this.resetAt,
      providerCode: this.providerCode,
    };
  }
}

export function isRetryableCategory(category: ErrorCategory): boolean {
  return category === 'rate_limit' || category === 'provider_outage' || category === 'network';
}

export function isQuotaCategory(category: ErrorCategory): boolean {
  return (
    category === 'rate_limit' ||
    category === 'daily_quota' ||
    category === 'billing_restriction' ||
    category === 'auth_failure' ||
    category === 'invalid_api_key' ||
    category === 'permission_error' ||
    category === 'model_unavailable' ||
    category === 'provider_outage' ||
    category === 'unsupported_tool_calling' ||
    category === 'context_length'
  );
}

export type HeaderSource = Headers | Record<string, string | string[] | undefined> | undefined;

export function getHeader(headers: HeaderSource, name: string): string | null {
  if (!headers) return null;
  if (typeof (headers as Headers).get === 'function') {
    return (headers as Headers).get(name);
  }
  const record = headers as Record<string, string | string[] | undefined>;
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(record)) {
    if (key.toLowerCase() === lower) {
      if (Array.isArray(value)) return value[0] ?? null;
      return value ?? null;
    }
  }
  return null;
}

/** Parse `Retry-After` (seconds or HTTP date) into an ISO timestamp, if valid. */
export function parseRetryAfter(value: string | null, nowMs = Date.now()): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  // A signed number is not a valid Retry-After value, and Date.parse() would
  // otherwise interpret things like "-5" as a year.
  if (/^[+-]/.test(trimmed)) return null;
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    if (!Number.isFinite(seconds) || seconds < 0) return null;
    return new Date(nowMs + seconds * 1000).toISOString();
  }
  const date = Date.parse(trimmed);
  if (Number.isFinite(date)) return new Date(date).toISOString();
  return null;
}

/** Parse provider duration syntax such as `2m59.56s` or `1h2m` into milliseconds. */
export function parseDurationMs(value: string | null): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Math.round(Number(trimmed) * 1000);
  const match = /^(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)m)?(?:(\d+(?:\.\d+)?)s)?$/.exec(trimmed);
  if (!match) return null;
  const [, h, m, s] = match;
  if (!h && !m && !s) return null;
  return Math.round((Number(h ?? 0) * 3600 + Number(m ?? 0) * 60 + Number(s ?? 0)) * 1000);
}

function parseUnixOrIso(value: string): string | null {
  const trimmed = value.trim();
  if (/^\d{10}$/.test(trimmed)) return new Date(Number(trimmed) * 1000).toISOString();
  if (/^\d{13}$/.test(trimmed)) return new Date(Number(trimmed)).toISOString();
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

export interface ClassifiedBody {
  message: string;
  code: string | null;
  type: string | null;
  statusText: string | null;
  retryDelay: string | null;
}

/** Extract useful fields from OpenAI-, Gemini-, Groq-, and OpenRouter-style errors. */
export function parseErrorBody(raw: string): ClassifiedBody {
  const fallback = raw.replace(/\s+/g, ' ').trim().slice(0, 800);
  if (!raw.trim()) {
    return { message: '', code: null, type: null, statusText: null, retryDelay: null };
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const error = (
      parsed.error && typeof parsed.error === 'object' ? parsed.error : parsed
    ) as Record<string, unknown>;
    let message = '';
    if (typeof error.message === 'string') message = error.message;
    else if (typeof parsed.message === 'string') message = parsed.message;
    else message = fallback;

    let retryDelay: string | null = null;
    const details = error.details;
    if (Array.isArray(details)) {
      for (const item of details) {
        if (item && typeof item === 'object') {
          const record = item as Record<string, unknown>;
          if (typeof record.retryDelay === 'string') retryDelay = record.retryDelay;
        }
      }
    }
    if (!retryDelay && typeof error.retryDelay === 'string') retryDelay = error.retryDelay;
    if (!retryDelay && typeof parsed.retryDelay === 'string') retryDelay = parsed.retryDelay;

    const codeValue = error.code ?? parsed.code;
    const typeValue = error.type ?? parsed.type;
    const statusValue = error.status ?? parsed.status;
    const inferredRetry = /retry in ([\d.]+)\s*s/i.exec(message)?.[1];
    if (!retryDelay && inferredRetry) retryDelay = `${inferredRetry}s`;

    return {
      message: redactSecrets(message).slice(0, 800),
      code: codeValue === undefined || codeValue === null ? null : String(codeValue),
      type: typeValue === undefined || typeValue === null ? null : String(typeValue),
      statusText: statusValue === undefined || statusValue === null ? null : String(statusValue),
      retryDelay,
    };
  } catch {
    return {
      message: redactSecrets(fallback),
      code: null,
      type: null,
      statusText: null,
      retryDelay: /retry in ([\d.]+)\s*s/i.exec(fallback)?.[1]
        ? `${/retry in ([\d.]+)\s*s/i.exec(fallback)![1]}s`
        : null,
    };
  }
}

export interface ClassifyInput {
  providerId: string;
  status?: number | null;
  headers?: HeaderSource;
  body?: string;
  error?: unknown;
  nowMs?: number;
}

function detectContextLength(text: string): boolean {
  return /context (?:window|length)|maximum context|too many tokens|context_length_exceeded|input is too long|token limit/i.test(
    text,
  );
}

function detectDailyQuota(text: string): boolean {
  return /per day|daily|today['’]s quota|quota (?:has been )?(?:exceeded|exhausted)|exceeded (?:your|the) (?:current )?quota|free.?tier.*(?:limit|quota)|RPD\b|requests per day|insufficient_quota/i.test(
    text,
  );
}

function detectToolSupport(text: string): boolean {
  return /tool(?:s| calling| use)? (?:is |are )?not supported|function calling (?:is )?not supported|does not support (?:tools|function)/i.test(
    text,
  );
}

function detectBilling(text: string): boolean {
  return /billing|payment required|credit balance|insufficient (?:funds|credits)|spend limit|hard limit|requires a paid|paid plan/i.test(
    text,
  );
}

/**
 * Classify provider failures based on status codes, provider headers, and
 * documented error shapes. This deliberately does not guess reset times that
 * the provider did not supply.
 */
export function classifyProviderError(input: ClassifyInput): ProviderError {
  const nowMs = input.nowMs ?? Date.now();
  const providerId = input.providerId;
  const status = input.status ?? null;
  const body = input.body ?? '';
  const parsed = parseErrorBody(body);
  const text = [parsed.message, parsed.code, parsed.type, parsed.statusText, body]
    .filter(Boolean)
    .join(' ')
    .slice(0, 4000);

  const retryAfterAt = parseRetryAfter(getHeader(input.headers, 'retry-after'), nowMs);
  let resetAt: string | null = null;
  const resetHeader =
    getHeader(input.headers, 'x-ratelimit-reset-requests') ??
    getHeader(input.headers, 'x-ratelimit-reset-tokens') ??
    getHeader(input.headers, 'x-ratelimit-reset');
  if (resetHeader) {
    resetAt = parseUnixOrIso(resetHeader);
    if (!resetAt) {
      const duration = parseDurationMs(resetHeader);
      if (duration !== null) resetAt = new Date(nowMs + duration).toISOString();
    }
  }
  const geminiReset = parsed.retryDelay ? parseDurationMs(parsed.retryDelay) : null;
  const effectiveRetryAfter =
    retryAfterAt ?? (geminiReset !== null ? new Date(nowMs + geminiReset).toISOString() : null);

  const failure = input.error;
  if (failure) {
    const message = safeErrorMessage(failure);
    const isAbort =
      (failure instanceof Error && failure.name === 'AbortError') ||
      /aborted|cancell?ed/i.test(message);
    if (isAbort) {
      return new ProviderError({
        category: 'cancelled',
        message: 'Request cancelled.',
        providerId,
        retryable: false,
      });
    }
    const isNetwork =
      failure instanceof TypeError ||
      /fetch failed|network|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|socket hang up|getaddrinfo/i.test(
        message,
      );
    return new ProviderError({
      category: isNetwork ? 'network' : 'unknown',
      message: message || 'Network request failed.',
      providerId,
      status,
      retryable: isNetwork,
      retryAfterAt: effectiveRetryAfter,
      resetAt,
      providerCode: parsed.code,
    });
  }

  const base = {
    providerId,
    status,
    retryAfterAt: effectiveRetryAfter,
    resetAt,
    providerCode: parsed.code ?? parsed.statusText,
    message: parsed.message || `Provider request failed${status ? ` with HTTP ${status}` : ''}.`,
  };

  if (status === 401) {
    const category: ErrorCategory = /invalid.*(?:api key|key)|api key not valid/i.test(text)
      ? 'invalid_api_key'
      : 'auth_failure';
    return new ProviderError({ ...base, category, retryable: false });
  }
  if (status === 402) {
    return new ProviderError({ ...base, category: 'billing_restriction', retryable: false });
  }
  if (status === 403) {
    return new ProviderError({
      ...base,
      category: detectBilling(text) ? 'billing_restriction' : 'permission_error',
      retryable: false,
    });
  }
  if (status === 404) {
    return new ProviderError({ ...base, category: 'model_unavailable', retryable: false });
  }
  if (status === 429) {
    return new ProviderError({
      ...base,
      category: detectDailyQuota(text) ? 'daily_quota' : 'rate_limit',
      retryable: true,
    });
  }
  if (status === 408 || status === 504) {
    return new ProviderError({ ...base, category: 'provider_outage', retryable: true });
  }
  if (status && status >= 500) {
    return new ProviderError({ ...base, category: 'provider_outage', retryable: true });
  }
  if (status === 400 || status === 413 || status === 422) {
    if (detectContextLength(text)) {
      return new ProviderError({ ...base, category: 'context_length', retryable: false });
    }
    if (detectToolSupport(text)) {
      return new ProviderError({
        ...base,
        category: 'unsupported_tool_calling',
        retryable: false,
      });
    }
    if (/invalid.*(?:api key|key)|api key not valid/i.test(text)) {
      return new ProviderError({ ...base, category: 'invalid_api_key', retryable: false });
    }
    if (/model.*(?:not found|does not exist|not available|unavailable|decommissioned)/i.test(text)) {
      return new ProviderError({ ...base, category: 'model_unavailable', retryable: false });
    }
    return new ProviderError({ ...base, category: 'invalid_request', retryable: false });
  }
  if (/model.*(?:not found|does not exist|not available|unavailable|decommissioned)/i.test(text)) {
    return new ProviderError({ ...base, category: 'model_unavailable', retryable: false });
  }
  if (detectDailyQuota(text)) {
    return new ProviderError({ ...base, category: 'daily_quota', retryable: true });
  }
  if (/rate limit|too many requests|quota exceeded/i.test(text)) {
    return new ProviderError({ ...base, category: 'rate_limit', retryable: true });
  }
  if (detectContextLength(text)) {
    return new ProviderError({ ...base, category: 'context_length', retryable: false });
  }
  return new ProviderError({ ...base, category: 'unknown', retryable: false });
}

export function classifyThrown(error: unknown, providerId: string): ProviderError {
  if (error instanceof ProviderError) return error;
  return classifyProviderError({ providerId, error });
}

export function describeCategory(category: ErrorCategory): string {
  switch (category) {
    case 'rate_limit':
      return 'Rate limit';
    case 'daily_quota':
      return 'Daily/provider quota exhausted';
    case 'provider_outage':
      return 'Provider outage';
    case 'network':
      return 'Network failure';
    case 'invalid_api_key':
      return 'Invalid API key';
    case 'auth_failure':
      return 'Authentication failure';
    case 'permission_error':
      return 'Permission denied';
    case 'model_unavailable':
      return 'Model unavailable';
    case 'unsupported_tool_calling':
      return 'Tool calling unsupported';
    case 'context_length':
      return 'Context length exceeded';
    case 'billing_restriction':
      return 'Billing restriction';
    case 'invalid_request':
      return 'Invalid request';
    case 'cancelled':
      return 'Cancelled';
    default:
      return 'Unknown provider error';
  }
}
