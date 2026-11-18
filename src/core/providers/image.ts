import { mkdir, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import type { AppContext } from '../app.js';
import type { ModelInfo, ProviderProfile } from '../types.js';
import { getProviderDefinition } from './definitions.js';
import { asRecord, joinUrl, normalizeBaseUrl, withTimeout } from './adapter.js';
import { classifyProviderError, classifyThrown, ProviderError } from './errors.js';
import { readEndpointConfig, sanitizeExtraHeaders } from './profile-config.js';
import { resolveProfileCredential } from './service.js';
import { owningProfileForModel } from './catalog.js';
import { registerSecret } from '../security/redact.js';

export interface ImageGenerationInput {
  prompt: string;
  model?: string;
  profileId?: string;
  size?: string;
  n?: number;
}

export interface GeneratedImage {
  data: string;
  mimeType: string;
  url?: string;
  path?: string;
}

export interface ImageGenerationResult {
  images: GeneratedImage[];
  model: string;
  profileId: string;
  savedPaths: string[];
}

export interface ImageModelCandidate {
  profile: ProviderProfile;
  model: ModelInfo;
  profileId: string;
}

function isImageCapableModel(model: ModelInfo): boolean {
  const meta = (model.metadata ?? {}) as Record<string, unknown>;
  if (meta.supportsImageGeneration === true) return true;
  const id = `${model.modelId} ${model.displayName}`.toLowerCase();
  return /imagen|dall-e|gpt-image|image-generation|flash-image|gemini.*image|image.*preview|flux|stable-diffusion/.test(
    id,
  );
}

function pickPreferredImageModel(models: ModelInfo[]): ModelInfo | null {
  const candidates = models.filter((m) => isImageCapableModel(m));
  if (candidates.length === 0) return null;
  const score = (m: ModelInfo): number => {
    let s = 0;
    if (m.available) s += 10;
    const id = m.modelId.toLowerCase();
    if (/flash-image|gpt-image|image-generation/.test(id)) s += 5;
    if (/gemini-2\.5/.test(id)) s += 3;
    if (/dall-e-3/.test(id)) s += 2;
    if (/imagen/.test(id)) s += 1;
    s += Math.min(3, (m.codingSuitability ?? 0) / 2);
    return s;
  };
  return [...candidates].sort((a, b) => score(b) - score(a))[0] ?? null;
}

function modelBelongsToProfile(model: ModelInfo, profile: ProviderProfile): boolean {
  if (model.providerId !== profile.providerId) return false;
  if (model.profileId) return model.profileId === profile.id;
  return true;
}

/**
 * Find an enabled profile/model pair capable of image generation.
 * Prefers an explicit profile/model, then the selected profile/model, then the
 * best available image-capable model on an enabled profile.
 */
export async function findImageCapableModel(
  ctx: AppContext,
  preferredProfileId?: string,
): Promise<ImageModelCandidate | null> {
  const profiles = ctx.store.listProfiles().filter((p) => p.enabled);
  const allModels = ctx.store.listModels();

  const resolveByIds = (profileId?: string | null, modelId?: string | null): ImageModelCandidate | null => {
    if (!profileId && !modelId) return null;
    const profile = profileId
      ? profiles.find((p) => p.id === profileId) ?? ctx.store.getProfile(profileId)
      : null;
    if (modelId) {
      const exact = allModels.filter((m) => m.modelId === modelId || m.id === modelId);
      for (const model of exact) {
        if (!isImageCapableModel(model)) continue;
        const owner = profile && modelBelongsToProfile(model, profile)
          ? profile
          : owningProfileForModel(profiles, model) ?? (profile ?? null);
        if (owner && owner.enabled) return { profile: owner, model, profileId: owner.id };
      }
    }
    if (profile && profile.enabled) {
      const scoped = ctx.store
        .listModels(profile.providerId, profile.providerId === 'custom' ? profile.id : undefined)
        .filter((m) => modelBelongsToProfile(m, profile));
      const picked = pickPreferredImageModel(scoped);
      if (picked) return { profile, model: picked, profileId: profile.id };
    }
    return null;
  };

  const explicit = resolveByIds(preferredProfileId, null);
  if (explicit) return explicit;

  const selectedProfileId = ctx.store.getSelectedProfileId();
  const selectedModelId = ctx.store.getSelectedModelId();
  if (selectedModelId) {
    const selectedModel = allModels.find((m) => m.id === selectedModelId || m.modelId === selectedModelId);
    if (selectedModel && isImageCapableModel(selectedModel)) {
      const owner = owningProfileForModel(profiles, selectedModel) ??
        (selectedProfileId ? profiles.find((p) => p.id === selectedProfileId) ?? null : null);
      if (owner) return { profile: owner, model: selectedModel, profileId: owner.id };
    }
  }
  const selectedProfile = resolveByIds(selectedProfileId, null);
  if (selectedProfile) return selectedProfile;

  const ranked: ImageModelCandidate[] = [];
  for (const profile of profiles) {
    const models = ctx.store
      .listModels(profile.providerId, profile.providerId === 'custom' ? profile.id : undefined)
      .filter((m) => modelBelongsToProfile(m, profile));
    const picked = pickPreferredImageModel(models);
    if (picked) ranked.push({ profile, model: picked, profileId: profile.id });
  }
  ranked.sort((a, b) => Number(b.model.available) - Number(a.model.available));
  return ranked[0] ?? null;
}

function extensionForMime(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes('jpeg') || m.includes('jpg')) return '.jpg';
  if (m.includes('webp')) return '.webp';
  if (m.includes('gif')) return '.gif';
  if (m.includes('bmp')) return '.bmp';
  return '.png';
}

async function saveImageToDisk(cwd: string, image: GeneratedImage, index: number): Promise<string> {
  const dir = join(cwd, '.comicode', 'images');
  await mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const ext = extensionForMime(image.mimeType) || extname(image.url ?? '') || '.png';
  const file = join(dir, `${stamp}-${index}${ext}`);
  const buffer = Buffer.from(image.data, 'base64');
  await writeFile(file, buffer);
  return file.replace(/\\/g, '/');
}

function buildGeminiHeaders(apiKey: string, extra: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json',
    ...sanitizeExtraHeaders(extra),
  };
  const key = apiKey.trim();
  if (key) {
    registerSecret(key);
    headers['x-goog-api-key'] = key;
  }
  return headers;
}

async function fetchJsonChecked(
  url: string,
  init: RequestInit,
  providerId: string,
  timeoutMs = 180_000,
  signal?: AbortSignal,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: withTimeout(signal, timeoutMs) });
  } catch (error) {
    throw classifyThrown(error, providerId);
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw classifyProviderError({
      providerId,
      status: response.status,
      headers: response.headers,
      body,
    });
  }
  const text = await response.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ProviderError({
      category: 'unknown',
      providerId,
      message: `Provider returned non-JSON response: ${text.slice(0, 300)}`,
      retryable: false,
    });
  }
}

function extractGeminiImages(payload: unknown): GeneratedImage[] {
  const record = asRecord(payload);
  const candidates = Array.isArray(record?.candidates) ? record.candidates : [];
  const images: GeneratedImage[] = [];
  for (const candidate of candidates) {
    const content = asRecord(asRecord(candidate)?.content);
    const parts = Array.isArray(content?.parts) ? content.parts : [];
    for (const part of parts) {
      const p = asRecord(part);
      if (!p) continue;
      const inline = asRecord(p.inlineData ?? p.inline_data);
      if (inline && typeof inline.data === 'string') {
        images.push({
          data: inline.data,
          mimeType: typeof inline.mimeType === 'string'
            ? inline.mimeType
            : typeof inline.mime_type === 'string'
              ? inline.mime_type
              : 'image/png',
        });
      }
    }
  }
  // Imagen predict-style responses: predictions[].bytesBase64Encoded / mimeType
  const predictions = Array.isArray(record?.predictions) ? record.predictions : [];
  for (const pred of predictions) {
    const p = asRecord(pred);
    if (!p) continue;
    const data = typeof p.bytesBase64Encoded === 'string'
      ? p.bytesBase64Encoded
      : typeof p.bytes_base64_encoded === 'string'
        ? p.bytes_base64_encoded
        : typeof p.image === 'string'
          ? p.image
          : null;
    if (data) {
      images.push({
        data,
        mimeType: typeof p.mimeType === 'string' ? p.mimeType : typeof p.mime_type === 'string' ? p.mime_type : 'image/png',
      });
    }
  }
  return images;
}

async function generateWithGemini(
  profile: ProviderProfile,
  apiKey: string,
  modelId: string,
  input: ImageGenerationInput,
  signal?: AbortSignal,
): Promise<GeneratedImage[]> {
  const base = normalizeBaseUrl(profile.baseUrl || getProviderDefinition(profile.providerId).defaultBaseUrl);
  if (!base) {
    throw new ProviderError({
      category: 'invalid_request',
      providerId: profile.providerId,
      message: 'No base URL configured for Gemini image generation.',
      retryable: false,
    });
  }
  const config = readEndpointConfig(profile);
  const stripped = modelId.replace(/^models\//, '');
  const isImagen = /^imagen/i.test(stripped);
  const url = isImagen
    ? `${base}/models/${encodeURIComponent(stripped)}:predict`
    : `${base}/models/${encodeURIComponent(stripped)}:generateContent`;

  const body: Record<string, unknown> = isImagen
    ? {
        instances: [{ prompt: input.prompt }],
        parameters: {
          sampleCount: Math.max(1, Math.min(input.n ?? 1, 4)),
          ...(input.size ? { aspectRatio: input.size } : {}),
        },
      }
    : {
        contents: [{ role: 'user', parts: [{ text: input.prompt }] }],
        generationConfig: {
          responseModalities: ['TEXT', 'IMAGE'],
          ...(input.n && input.n > 1 ? { candidateCount: Math.max(1, Math.min(input.n, 4)) } : {}),
        },
      };

  const payload = await fetchJsonChecked(
    url,
    { method: 'POST', headers: buildGeminiHeaders(apiKey, config.extraHeaders), body: JSON.stringify(body) },
    profile.providerId,
    180_000,
    signal,
  );
  const images = extractGeminiImages(payload);
  if (images.length === 0) {
    const preview = JSON.stringify(payload).slice(0, 500);
    throw new ProviderError({
      category: 'unknown',
      providerId: profile.providerId,
      message: `Gemini image response contained no image data. Response preview: ${preview}`,
      retryable: false,
    });
  }
  return images;
}

function buildOpenAICompatibleHeaders(profile: ProviderProfile, apiKey: string): Record<string, string> {
  const config = readEndpointConfig(profile);
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json',
    ...sanitizeExtraHeaders(config.extraHeaders),
  };
  const key = apiKey.trim();
  if (key) {
    registerSecret(key);
    const headerName = config.authHeader || 'Authorization';
    const prefix = config.authPrefix ?? 'Bearer ';
    headers[headerName] = `${prefix}${key}`;
  } else if (!config.allowNoAuth && profile.providerId !== 'custom') {
    throw new ProviderError({
      category: 'invalid_api_key',
      providerId: profile.providerId,
      message: `No API key configured for profile "${profile.name}".`,
      retryable: false,
    });
  }
  return headers;
}

async function fetchBinaryAsBase64(url: string): Promise<{ data: string; mimeType: string }> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to download image URL (${response.status})`);
  const mimeType = response.headers.get('content-type') || 'image/png';
  const arrayBuffer = await response.arrayBuffer();
  return { data: Buffer.from(arrayBuffer).toString('base64'), mimeType };
}

async function generateWithOpenAICompatible(
  profile: ProviderProfile,
  apiKey: string,
  modelId: string,
  input: ImageGenerationInput,
  signal?: AbortSignal,
): Promise<GeneratedImage[]> {
  const base = normalizeBaseUrl(profile.baseUrl || getProviderDefinition(profile.providerId).defaultBaseUrl);
  if (!base) {
    throw new ProviderError({
      category: 'invalid_request',
      providerId: profile.providerId,
      message: 'No base URL configured for image generation.',
      retryable: false,
    });
  }
  const url = joinUrl(base, '/images/generations');
  const body: Record<string, unknown> = {
    model: modelId,
    prompt: input.prompt,
    n: Math.max(1, Math.min(input.n ?? 1, 4)),
  };
  if (input.size) body.size = input.size;
  // Prefer base64 when supported; many providers accept response_format.
  body.response_format = 'b64_json';

  const payload = await fetchJsonChecked(
    url,
    { method: 'POST', headers: buildOpenAICompatibleHeaders(profile, apiKey), body: JSON.stringify(body) },
    profile.providerId,
    180_000,
    signal,
  );
  const record = asRecord(payload);
  const data = Array.isArray(record?.data) ? record.data : [];
  const images: GeneratedImage[] = [];
  for (const entry of data) {
    const item = asRecord(entry);
    if (!item) continue;
    if (typeof item.b64_json === 'string' && item.b64_json) {
      images.push({ data: item.b64_json, mimeType: 'image/png' });
      continue;
    }
    if (typeof item.url === 'string' && item.url) {
      try {
        const downloaded = await fetchBinaryAsBase64(item.url);
        images.push({ ...downloaded, url: item.url });
      } catch {
        // As a fallback, return URL marker without data.
        images.push({ data: '', mimeType: 'image/png', url: item.url });
      }
    }
  }
  if (images.length === 0) {
    const preview = JSON.stringify(payload).slice(0, 500);
    throw new ProviderError({
      category: 'unknown',
      providerId: profile.providerId,
      message: `Image generation response contained no image data. Response preview: ${preview}`,
      retryable: false,
    });
  }
  return images;
}

export async function generateImage(
  ctx: AppContext,
  input: ImageGenerationInput,
): Promise<ImageGenerationResult> {
  const prompt = (input.prompt ?? '').trim();
  if (!prompt) {
    throw new Error('Image prompt is required.');
  }

  let profile: ProviderProfile | null = null;
  let modelId = input.model?.trim() || '';

  if (input.profileId) profile = ctx.store.getProfile(input.profileId);
  if (profile && !modelId) {
    const picked = await findImageCapableModel(ctx, profile.id);
    if (picked && picked.profile.id === profile.id) modelId = picked.model.modelId;
  }
  if (!profile || !modelId) {
    const candidate = await findImageCapableModel(ctx, input.profileId);
    if (!candidate) {
      throw new Error(
        'No image-capable model/profile found. Connect a provider with an image model (e.g. Gemini image, gpt-image-1, dall-e-3) and refresh models.',
      );
    }
    profile = profile ?? candidate.profile;
    modelId = modelId || candidate.model.modelId;
  }

  const credential = await resolveProfileCredential(profile);
  const apiKey = credential.apiKey;
  const isGemini = profile.providerId === 'gemini' || readEndpointConfig(profile).apiStyle === 'gemini';

  let images: GeneratedImage[];
  try {
    images = isGemini
      ? await generateWithGemini(profile, apiKey, modelId, { ...input, prompt })
      : await generateWithOpenAICompatible(profile, apiKey, modelId, { ...input, prompt });
  } catch (error) {
    throw classifyThrown(error, profile.providerId);
  }

  const savedPaths: string[] = [];
  for (let i = 0; i < images.length; i += 1) {
    const image = images[i]!;
    if (image.data) {
      try {
        const saved = await saveImageToDisk(ctx.cwd, image, i + 1);
        image.path = saved;
        savedPaths.push(saved);
      } catch {
        // Saving is best-effort; generation already succeeded.
      }
    } else if (image.url) {
      savedPaths.push(image.url);
    }
  }

  return {
    images,
    model: modelId,
    profileId: profile.id,
    savedPaths,
  };
}
