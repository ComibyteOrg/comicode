import { randomUUID } from 'node:crypto';
import type {
  AgentMessage,
  ChatRequest,
  ChatResponse,
  DiscoveredModel,
  ProviderKind,
  TokenUsage,
  ToolCall,
} from '../types.js';
import { registerSecret } from '../security/redact.js';
import {
  type AdapterContext,
  type ChatOptions,
  type ProviderAdapter,
  type TestConnectionResult,
  asRecord,
  joinUrl,
  normalizeBaseUrl,
  toNumber,
  withTimeout,
} from './adapter.js';
import { classifyProviderError, classifyThrown } from './errors.js';
import { readEndpointConfig, sanitizeExtraHeaders } from './profile-config.js';

const NON_CHAT_PATTERN = /embedding|aqa|imagen|veo|learnlm/i;

function stripModelPrefix(model: string): string {
  return model.replace(/^models\//, '');
}

function geminiType(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const upper = value.toUpperCase();
    if (['STRING', 'NUMBER', 'INTEGER', 'BOOLEAN', 'ARRAY', 'OBJECT'].includes(upper)) return upper;
    return 'STRING';
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (entry !== 'null' && entry !== null) {
        const converted = geminiType(entry);
        if (converted) return converted;
      }
    }
  }
  return undefined;
}

/** Normalize a JSON schema into the subset accepted by the Gemini API. */
export function toGeminiSchema(schema: unknown): Record<string, unknown> {
  const record = asRecord(schema);
  if (!record) return { type: 'OBJECT', properties: {} };
  const output: Record<string, unknown> = {};
  const type = geminiType(record.type);
  if (type) output.type = type;
  if (typeof record.description === 'string') output.description = record.description;
  if (Array.isArray(record.enum)) output.enum = record.enum.map((entry) => String(entry));
  if (typeof record.format === 'string') output.format = record.format;
  if (record.nullable === true) output.nullable = true;
  if (record.properties && typeof record.properties === 'object') {
    const properties: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(record.properties as Record<string, unknown>)) {
      properties[key] = toGeminiSchema(value);
    }
    output.properties = properties;
    if (!output.type) output.type = 'OBJECT';
  }
  if (record.items) output.items = toGeminiSchema(record.items);
  if (Array.isArray(record.required)) {
    output.required = record.required.filter((entry): entry is string => typeof entry === 'string');
  }
  if (output.type === 'OBJECT' && !output.properties) output.properties = {};
  return output;
}

function buildContents(messages: AgentMessage[]): {
  contents: Array<Record<string, unknown>>;
  systemInstruction: string | null;
} {
  const contents: Array<Record<string, unknown>> = [];
  const systemParts: string[] = [];

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (!message) continue;
    if (message.role === 'system') {
      systemParts.push(message.content);
      continue;
    }
    if (message.role === 'assistant') {
      const parts: Array<Record<string, unknown>> = [];
      if (message.content) parts.push({ text: message.content });
      for (const call of message.toolCalls ?? []) {
        parts.push({ functionCall: { name: call.name, args: call.arguments ?? {} } });
      }
      if (parts.length) contents.push({ role: 'model', parts });
      continue;
    }
    if (message.role === 'tool') {
      const responseParts: Array<Record<string, unknown>> = [];
      let cursor = index;
      while (cursor < messages.length) {
        const toolMessage = messages[cursor];
        if (!toolMessage || toolMessage.role !== 'tool') break;
        let parsed: unknown = toolMessage.content;
        try {
          parsed = JSON.parse(toolMessage.content);
        } catch {
          // Keep raw text.
        }
        responseParts.push({
          functionResponse: {
            name: toolMessage.name,
            response:
              asRecord(parsed) !== null
                ? parsed
                : { result: String(toolMessage.content).slice(0, 100_000) },
          },
        });
        cursor += 1;
      }
      contents.push({ role: 'user', parts: responseParts });
      index = cursor - 1;
      continue;
    }
    contents.push({ role: 'user', parts: [{ text: message.content }] });
  }

  return {
    contents,
    systemInstruction: systemParts.length ? systemParts.join('\n\n') : null,
  };
}

function parseFunctionCalls(parts: unknown[]): ToolCall[] {
  const calls: ToolCall[] = [];
  parts.forEach((part, index) => {
    const record = asRecord(part);
    const fn = record ? asRecord(record.functionCall) : null;
    if (!fn || typeof fn.name !== 'string' || !fn.name) return;
    const args = asRecord(fn.args) ?? {};
    calls.push({
      id: `gemini_${index}_${randomUUID().slice(0, 8)}`,
      name: fn.name,
      arguments: args,
    });
  });
  return calls;
}

function parseGeminiResponse(data: unknown): ChatResponse {
  const record = asRecord(data);
  const candidates = record?.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new Error('Gemini returned no candidates.');
  }
  const candidate = asRecord(candidates[0]);
  const content = asRecord(candidate?.content);
  const parts = Array.isArray(content?.parts) ? content.parts : [];
  let text = '';
  for (const part of parts) {
    const partRecord = asRecord(part);
    if (partRecord && typeof partRecord.text === 'string' && partRecord.thought !== true) {
      text += partRecord.text;
    }
  }
  const usageMeta = asRecord(record?.usageMetadata);
  const usage: TokenUsage | null = usageMeta
    ? {
        inputTokens: toNumber(usageMeta.promptTokenCount) ?? 0,
        outputTokens: toNumber(usageMeta.candidatesTokenCount) ?? 0,
        totalTokens:
          toNumber(usageMeta.totalTokenCount) ??
          (toNumber(usageMeta.promptTokenCount) ?? 0) +
            (toNumber(usageMeta.candidatesTokenCount) ?? 0),
      }
    : null;
  return {
    content: text,
    toolCalls: parseFunctionCalls(parts),
    usage,
    finishReason: typeof candidate?.finishReason === 'string' ? candidate.finishReason : null,
  };
}

function buildHeaders(context: AdapterContext): Record<string, string> {
  const config = readEndpointConfig(context.profile);
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json',
    ...sanitizeExtraHeaders(config.extraHeaders),
  };
  const key = context.apiKey.trim();
  if (key) {
    registerSecret(key);
    headers['x-goog-api-key'] = key;
  } else if (!config.allowNoAuth) {
    throw classifyProviderError({
      providerId: context.profile.providerId,
      status: 401,
      body: JSON.stringify({
        error: { message: `No API key configured for profile "${context.profile.name}".` },
      }),
    });
  }
  return headers;
}

async function fetchChecked(
  context: AdapterContext,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const fetchImpl = context.fetchImpl ?? globalThis.fetch;
  let response: Response;
  try {
    response = await fetchImpl(url, { ...init, signal: withTimeout(context.signal, timeoutMs) });
  } catch (error) {
    throw classifyThrown(error, context.profile.providerId);
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw classifyProviderError({
      providerId: context.profile.providerId,
      status: response.status,
      headers: response.headers,
      body,
    });
  }
  return response;
}

export class GeminiAdapter implements ProviderAdapter {
  readonly kind: ProviderKind;
  readonly supportsStreaming = true;

  constructor(kind: ProviderKind = 'gemini') {
    this.kind = kind;
  }

  private base(context: AdapterContext): string {
    const base = normalizeBaseUrl(context.baseUrl ?? context.profile.baseUrl);
    if (!base) {
      throw classifyProviderError({
        providerId: context.profile.providerId,
        status: 400,
        body: JSON.stringify({ error: { message: 'No base URL configured for this profile.' } }),
      });
    }
    return base;
  }

  async chat(
    context: AdapterContext,
    request: ChatRequest,
    options: ChatOptions = {},
  ): Promise<ChatResponse> {
    const config = readEndpointConfig(context.profile);
    const model = stripModelPrefix(request.model);
    const streaming = Boolean(options.onText) && config.supportsStreaming;
    const url = streaming
      ? `${this.base(context)}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`
      : `${this.base(context)}/models/${encodeURIComponent(model)}:generateContent`;
    const { contents, systemInstruction } = buildContents(request.messages);
    const body: Record<string, unknown> = { contents };
    if (systemInstruction) body.systemInstruction = { parts: [{ text: systemInstruction }] };
    if (request.tools?.length) {
      body.tools = [
        {
          functionDeclarations: request.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            parameters: toGeminiSchema(tool.parameters),
          })),
        },
      ];
    }
    const generationConfig: Record<string, unknown> = {};
    if (request.temperature !== undefined) generationConfig.temperature = request.temperature;
    if (request.maxOutputTokens !== undefined) {
      generationConfig.maxOutputTokens = request.maxOutputTokens;
    }
    if (Object.keys(generationConfig).length) body.generationConfig = generationConfig;

    const response = await fetchChecked(
      context,
      url,
      { method: 'POST', headers: buildHeaders(context), body: JSON.stringify(body) },
      180_000,
    );

    const contentType = response.headers.get('content-type') ?? '';
    if (!streaming || !contentType.includes('text/event-stream')) {
      const data = await response.json();
      return parseGeminiResponse(data);
    }
    return this.consumeStream(response, options);
  }

  private async consumeStream(response: Response, options: ChatOptions): Promise<ChatResponse> {
    if (!response.body) {
      throw classifyProviderError({
        providerId: this.kind,
        status: 502,
        body: JSON.stringify({ error: { message: 'Gemini returned an empty stream.' } }),
      });
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    let finishReason: string | null = null;
    let usage: TokenUsage | null = null;
    const calls: ToolCall[] = [];
    const seen = new Set<string>();

    const handleEvent = (data: string) => {
      if (!data || data === '[DONE]') return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(data);
      } catch {
        return;
      }
      const record = asRecord(parsed);
      if (!record) return;
      const usageMeta = asRecord(record.usageMetadata);
      if (usageMeta) {
        usage = {
          inputTokens: toNumber(usageMeta.promptTokenCount) ?? usage?.inputTokens ?? 0,
          outputTokens: toNumber(usageMeta.candidatesTokenCount) ?? usage?.outputTokens ?? 0,
          totalTokens:
            toNumber(usageMeta.totalTokenCount) ??
            (toNumber(usageMeta.promptTokenCount) ?? 0) +
              (toNumber(usageMeta.candidatesTokenCount) ?? 0),
        };
      }
      const candidates = record.candidates;
      if (!Array.isArray(candidates) || candidates.length === 0) return;
      const candidate = asRecord(candidates[0]);
      if (!candidate) return;
      if (typeof candidate.finishReason === 'string') finishReason = candidate.finishReason;
      const parts = asRecord(candidate.content)?.parts;
      if (!Array.isArray(parts)) return;
      for (const part of parts) {
        const partRecord = asRecord(part);
        if (!partRecord) continue;
        if (typeof partRecord.text === 'string' && partRecord.thought !== true) {
          content += partRecord.text;
          options.onText?.(partRecord.text);
        }
        const fn = asRecord(partRecord.functionCall);
        if (fn && typeof fn.name === 'string' && fn.name) {
          const args = asRecord(fn.args) ?? {};
          const signature = `${fn.name}:${JSON.stringify(args)}`;
          if (!seen.has(signature)) {
            seen.add(signature);
            calls.push({
              id: `gemini_${calls.length}_${randomUUID().slice(0, 8)}`,
              name: fn.name,
              arguments: args,
            });
          }
        }
      }
    };

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let boundary = buffer.search(/\r?\n\r?\n/);
        while (boundary !== -1) {
          const rawEvent = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + (buffer[boundary] === '\r' ? 4 : 2));
          const dataLines = rawEvent
            .split(/\r?\n/)
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trimStart());
          if (dataLines.length) handleEvent(dataLines.join('\n'));
          boundary = buffer.search(/\r?\n\r?\n/);
        }
      }
      if (buffer.trim()) {
        const dataLines = buffer
          .split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart());
        if (dataLines.length) handleEvent(dataLines.join('\n'));
      }
    } catch (error) {
      throw classifyThrown(error, this.kind);
    } finally {
      reader.releaseLock();
    }

    return { content, toolCalls: calls, usage, finishReason };
  }

  async listModels(context: AdapterContext): Promise<DiscoveredModel[]> {
    const config = readEndpointConfig(context.profile);
    if (!config.supportsModelDiscovery) {
      throw classifyProviderError({
        providerId: this.kind,
        status: 400,
        body: JSON.stringify({
          error: { message: 'Model discovery is disabled for this profile.' },
        }),
      });
    }
    const models: DiscoveredModel[] = [];
    let pageToken: string | null = null;
    for (let page = 0; page < 10; page += 1) {
      const url = new URL(joinUrl(this.base(context), config.modelsPath));
      url.searchParams.set('pageSize', '1000');
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      const response = await fetchChecked(
        context,
        url.toString(),
        { method: 'GET', headers: buildHeaders(context) },
        30_000,
      );
      const payload = (await response.json()) as unknown;
      const record = asRecord(payload);
      const list = record && Array.isArray(record.models) ? record.models : [];
      for (const entry of list) {
        const model = asRecord(entry);
        if (!model) continue;
        const name = typeof model.name === 'string' ? model.name : '';
        const id = stripModelPrefix(name);
        if (!id || NON_CHAT_PATTERN.test(id)) continue;
        const methods = Array.isArray(model.supportedGenerationMethods)
          ? model.supportedGenerationMethods.filter(
              (item): item is string => typeof item === 'string',
            )
          : [];
        if (methods.length && !methods.includes('generateContent')) continue;
        models.push({
          modelId: id,
          displayName:
            typeof model.displayName === 'string' && model.displayName.trim()
              ? model.displayName
              : id,
          contextWindow: toNumber(model.inputTokenLimit) ?? null,
          maxOutputTokens: toNumber(model.outputTokenLimit) ?? null,
          supportsTools: undefined,
          supportsVision: undefined,
          metadata: {
            description: typeof model.description === 'string' ? model.description : undefined,
            supportedGenerationMethods: methods,
          },
        });
      }
      pageToken =
        record && typeof record.nextPageToken === 'string' && record.nextPageToken
          ? record.nextPageToken
          : null;
      if (!pageToken) break;
    }
    return models;
  }

  async testConnection(context: AdapterContext): Promise<TestConnectionResult> {
    const started = Date.now();
    try {
      const models = await this.listModels(context);
      return {
        ok: true,
        latencyMs: Date.now() - started,
        modelCount: models.length,
        message: `Connected. ${models.length} model${models.length === 1 ? '' : 's'} discovered.`,
      };
    } catch (error) {
      const classified = classifyThrown(error, this.kind);
      return {
        ok: false,
        latencyMs: Date.now() - started,
        modelCount: null,
        message: classified.message,
        category: classified.category,
      };
    }
  }
}
