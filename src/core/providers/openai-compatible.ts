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
import { classifyProviderError, classifyThrown, ProviderError } from './errors.js';
import { readEndpointConfig, sanitizeExtraHeaders } from './profile-config.js';

const NON_CHAT_PATTERN =
  /embedding|embed-|whisper|tts|text-to-speech|dall-e|moderation|rerank|image-generation|stable-diffusion|flux/i;

function contentToString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value
      .map((part) => {
        const record = asRecord(part);
        if (!record) return '';
        if (typeof record.text === 'string') return record.text;
        return '';
      })
      .join('');
  }
  return '';
}

function parseArguments(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    const record = asRecord(parsed);
    return record ?? { value: parsed };
  } catch {
    return {};
  }
}

function decodeToolCalls(raw: unknown): ToolCall[] {
  if (!Array.isArray(raw)) return [];
  const calls: ToolCall[] = [];
  raw.forEach((entry, index) => {
    const record = asRecord(entry);
    if (!record) return;
    const fn = asRecord(record.function);
    const name = fn && typeof fn.name === 'string' ? fn.name : '';
    if (!name) return;
    const args =
      fn && typeof fn.arguments === 'string'
        ? parseArguments(fn.arguments)
        : fn && asRecord(fn.arguments)
          ? (fn.arguments as Record<string, unknown>)
          : {};
    calls.push({
      id:
        typeof record.id === 'string' && record.id
          ? record.id
          : `call_${index}_${randomUUID().slice(0, 8)}`,
      name,
      arguments: args,
    });
  });
  return calls;
}

function decodeUsage(raw: unknown): TokenUsage | null {
  const record = asRecord(raw);
  if (!record) return null;
  const input = toNumber(record.prompt_tokens ?? record.input_tokens) ?? 0;
  const output = toNumber(record.completion_tokens ?? record.output_tokens) ?? 0;
  const total = toNumber(record.total_tokens) ?? input + output;
  if (input === 0 && output === 0 && total === 0) return null;
  return { inputTokens: input, outputTokens: output, totalTokens: total };
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
    const headerName = config.authHeader || 'Authorization';
    const prefix = config.authPrefix ?? 'Bearer ';
    headers[headerName] = `${prefix}${key}`;
  } else if (!config.allowNoAuth && context.profile.providerId !== 'custom') {
    throw new ProviderError({
      category: 'invalid_api_key',
      providerId: context.profile.providerId,
      message: `No API key configured for profile "${context.profile.name}".`,
      retryable: false,
    });
  }
  if (context.profile.providerId === 'openrouter') {
    if (!headers['HTTP-Referer'] && !headers['http-referer']) {
      headers['HTTP-Referer'] = 'https://github.com/YOUR_USERNAME/comicode';
    }
    if (!headers['X-Title'] && !headers['x-title']) {
      headers['X-Title'] = 'ComiCode';
    }
  }
  return headers;
}

function buildMessages(messages: AgentMessage[]): Array<Record<string, unknown>> {
  return messages.map((message) => {
    if (message.role === 'assistant') {
      const output: Record<string, unknown> = {
        role: 'assistant',
        content: message.content ?? '',
      };
      if (message.toolCalls?.length) {
        output.tool_calls = message.toolCalls.map((call) => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: JSON.stringify(call.arguments ?? {}) },
        }));
      }
      return output;
    }
    if (message.role === 'tool') {
      return {
        role: 'tool',
        tool_call_id: message.toolCallId,
        name: message.name,
        content: message.content,
      };
    }
    return { role: message.role, content: message.content };
  });
}

function buildRequestBody(
  context: AdapterContext,
  request: ChatRequest,
  streaming: boolean,
): Record<string, unknown> {
  const config = readEndpointConfig(context.profile);
  const body: Record<string, unknown> = {
    model: request.model,
    messages: buildMessages(request.messages),
    stream: streaming,
  };
  if (request.tools?.length) {
    body.tools = request.tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
    body.tool_choice = 'auto';
  }
  if (request.temperature !== undefined) body.temperature = request.temperature;
  if (request.maxOutputTokens !== undefined) {
    body[config.maxTokensParam] = request.maxOutputTokens;
  }
  if (streaming && config.streamUsage) {
    body.stream_options = { include_usage: true };
  }
  return body;
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
    response = await fetchImpl(url, {
      ...init,
      signal: withTimeout(context.signal, timeoutMs),
    });
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

function parseCompletion(data: unknown, providerId: ProviderKind): ChatResponse {
  const record = asRecord(data);
  const choices = record?.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new ProviderError({
      category: 'unknown',
      providerId,
      message: 'Provider returned no completion choices.',
      retryable: false,
    });
  }
  const choice = asRecord(choices[0]);
  const message = asRecord(choice?.message);
  const content = contentToString(message?.content);
  const toolCalls = decodeToolCalls(message?.tool_calls);
  return {
    content,
    toolCalls,
    usage: decodeUsage(record?.usage),
    finishReason: typeof choice?.finish_reason === 'string' ? choice.finish_reason : null,
  };
}

export class OpenAICompatibleAdapter implements ProviderAdapter {
  readonly kind: ProviderKind;
  readonly supportsStreaming = true;

  constructor(kind: ProviderKind) {
    this.kind = kind;
  }

  private endpoint(context: AdapterContext, path: string): string {
    const base = normalizeBaseUrl(context.baseUrl ?? context.profile.baseUrl);
    if (!base) {
      throw new ProviderError({
        category: 'invalid_request',
        providerId: this.kind,
        message: 'No base URL configured for this profile.',
        retryable: false,
      });
    }
    return joinUrl(base, path);
  }

  async chat(
    context: AdapterContext,
    request: ChatRequest,
    options: ChatOptions = {},
  ): Promise<ChatResponse> {
    const config = readEndpointConfig(context.profile);
    const wantsStream = Boolean(options.onText) && config.supportsStreaming;
    const response = await fetchChecked(
      context,
      this.endpoint(context, config.chatPath),
      {
        method: 'POST',
        headers: buildHeaders(context),
        body: JSON.stringify(buildRequestBody(context, request, wantsStream)),
      },
      180_000,
    );

    const contentType = response.headers.get('content-type') ?? '';
    if (!wantsStream || contentType.includes('application/json')) {
      const text = await response.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new ProviderError({
          category: 'unknown',
          providerId: this.kind,
          message: `Provider returned malformed JSON: ${text.slice(0, 300)}`,
          retryable: false,
        });
      }
      return parseCompletion(parsed, this.kind);
    }
    return this.consumeStream(response, options);
  }

  private async consumeStream(response: Response, options: ChatOptions): Promise<ChatResponse> {
    if (!response.body) {
      throw new ProviderError({
        category: 'network',
        providerId: this.kind,
        message: 'Provider returned an empty streaming response.',
        retryable: true,
      });
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    let finishReason: string | null = null;
    let usage: TokenUsage | null = null;
    const calls = new Map<number, { id: string; name: string; args: string }>();

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
      const decodedUsage = decodeUsage(record.usage);
      if (decodedUsage) usage = decodedUsage;
      const choices = record.choices;
      if (!Array.isArray(choices) || choices.length === 0) return;
      const choice = asRecord(choices[0]);
      if (!choice) return;
      const delta = asRecord(choice.delta);
      if (delta) {
        const text = contentToString(delta.content);
        if (text) {
          content += text;
          options.onText?.(text);
        }
        const toolDeltas = delta.tool_calls;
        if (Array.isArray(toolDeltas)) {
          toolDeltas.forEach((entry, fallbackIndex) => {
            const tool = asRecord(entry);
            if (!tool) return;
            const index = typeof tool.index === 'number' ? tool.index : fallbackIndex;
            const existing = calls.get(index) ?? { id: '', name: '', args: '' };
            if (typeof tool.id === 'string' && tool.id) existing.id = tool.id;
            const fn = asRecord(tool.function);
            if (fn) {
              if (typeof fn.name === 'string' && fn.name) existing.name += fn.name;
              if (typeof fn.arguments === 'string') existing.args += fn.arguments;
            }
            calls.set(index, existing);
          });
        }
      }
      if (typeof choice.finish_reason === 'string') finishReason = choice.finish_reason;
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

    const toolCalls: ToolCall[] = [...calls.entries()]
      .sort((a, b) => a[0] - b[0])
      .filter(([, call]) => call.name.length > 0)
      .map(([index, call]) => ({
        id: call.id || `call_${index}_${randomUUID().slice(0, 8)}`,
        name: call.name,
        arguments: parseArguments(call.args),
      }));

    return { content, toolCalls, usage, finishReason };
  }

  async listModels(context: AdapterContext): Promise<DiscoveredModel[]> {
    const config = readEndpointConfig(context.profile);
    if (!config.supportsModelDiscovery) {
      throw new ProviderError({
        category: 'invalid_request',
        providerId: this.kind,
        message: 'Model discovery is disabled for this profile.',
        retryable: false,
      });
    }
    const response = await fetchChecked(
      context,
      this.endpoint(context, config.modelsPath),
      { method: 'GET', headers: buildHeaders(context) },
      30_000,
    );
    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      throw classifyThrown(error, this.kind);
    }
    const record = asRecord(payload);
    const list = Array.isArray(payload)
      ? payload
      : record && Array.isArray(record.data)
        ? record.data
        : [];
    if (!Array.isArray(list)) {
      throw new ProviderError({
        category: 'invalid_request',
        providerId: this.kind,
        message: 'Provider model list response did not contain a model array.',
        retryable: false,
      });
    }
    const models: DiscoveredModel[] = [];
    for (const entry of list) {
      if (typeof entry === 'string') {
        if (!NON_CHAT_PATTERN.test(entry)) {
          models.push({ modelId: entry, displayName: entry });
        }
        continue;
      }
      const model = asRecord(entry);
      if (!model) continue;
      const id =
        typeof model.id === 'string' ? model.id : typeof model.name === 'string' ? model.name : '';
      if (!id || NON_CHAT_PATTERN.test(id)) continue;
      if (model.active === false) continue;
      const pricing = asRecord(model.pricing);
      const priceToMillion = (value: unknown): number | null => {
        const parsed = toNumber(value);
        return parsed === null ? null : Math.round(parsed * 1_000_000 * 1_000_000) / 1_000_000;
      };
      const supported = Array.isArray(model.supported_parameters)
        ? model.supported_parameters.filter((entry): entry is string => typeof entry === 'string')
        : null;
      const architecture = asRecord(model.architecture);
      const modalities = Array.isArray(architecture?.input_modalities)
        ? architecture.input_modalities.filter(
            (entry): entry is string => typeof entry === 'string',
          )
        : null;
      const context =
        toNumber(
          model.context_length ?? model.context_window ?? model.max_context_length ?? model.context,
        ) ?? null;
      const maxOutput =
        toNumber(
          model.max_completion_tokens ??
            model.max_output_tokens ??
            asRecord(model.top_provider)?.max_completion_tokens,
        ) ?? null;
      models.push({
        modelId: id,
        displayName: typeof model.name === 'string' && model.name.trim() ? model.name : id,
        contextWindow: context,
        maxOutputTokens: maxOutput,
        supportsTools: supported ? supported.includes('tools') : undefined,
        supportsVision: modalities ? modalities.some((m) => /image|vision/i.test(m)) : undefined,
        inputPricePerMillion: pricing ? priceToMillion(pricing.prompt) : null,
        outputPricePerMillion: pricing ? priceToMillion(pricing.completion) : null,
        metadata: {
          rawId: id,
          ownedBy: typeof model.owned_by === 'string' ? model.owned_by : undefined,
        },
      });
    }
    return models;
  }

  async testConnection(context: AdapterContext): Promise<TestConnectionResult> {
    const started = Date.now();
    const config = readEndpointConfig(context.profile);
    try {
      if (!config.supportsModelDiscovery) {
        if (config.testWithChat) {
          await this.chat(
            context,
            {
              model: context.profile.defaultModel || 'unknown',
              messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
              temperature: 0,
              maxOutputTokens: 2,
            },
            {},
          );
          return {
            ok: true,
            latencyMs: Date.now() - started,
            modelCount: null,
            message: 'Live test request succeeded (model discovery is disabled).',
          };
        }
        return {
          ok: true,
          latencyMs: Date.now() - started,
          modelCount: null,
          message:
            'Endpoint configuration saved. Model discovery is disabled, so no live request was made. Add a model manually or enable testWithChat.',
        };
      }
      const models = await this.listModels(context);
      return {
        ok: true,
        latencyMs: Date.now() - started,
        modelCount: models.length,
        message: `Connected. ${models.length} chat model${models.length === 1 ? '' : 's'} discovered.`,
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
