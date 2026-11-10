import type {
  ChatRequest,
  ChatResponse,
  DiscoveredModel,
  ProviderKind,
  ProviderProfile,
} from '../types.js';

export interface AdapterContext {
  profile: ProviderProfile;
  apiKey: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}

export interface ChatOptions {
  signal?: AbortSignal;
  onText?: (delta: string) => void;
}

export interface TestConnectionResult {
  ok: boolean;
  latencyMs: number;
  message: string;
  modelCount: number | null;
  category?: string | null;
}

export interface ProviderAdapter {
  readonly kind: ProviderKind;
  readonly supportsStreaming: boolean;
  chat(context: AdapterContext, request: ChatRequest, options?: ChatOptions): Promise<ChatResponse>;
  listModels(context: AdapterContext): Promise<DiscoveredModel[]>;
  testConnection(context: AdapterContext): Promise<TestConnectionResult>;
}

export function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

export function joinUrl(baseUrl: string, path: string): string {
  const base = normalizeBaseUrl(baseUrl);
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${base}${suffix}`;
}

export function withTimeout(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!signal) return timeout;
  return AbortSignal.any([signal, timeout]);
}

export function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}
