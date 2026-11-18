import type { AppContext } from '../../app.js';
import type { ToolDefinition } from '../../types.js';
import type { ToolResult } from '../types.js';
import { generateImage } from '../../providers/image.js';

export const GENERATE_IMAGE_TOOL_NAME = 'generate_image';

export const generateImageToolDefinition: ToolDefinition = {
  name: GENERATE_IMAGE_TOOL_NAME,
  description:
    'Generate an image, logo, illustration, diagram, or screenshot-style visual asset from a text prompt using a configured image-capable provider/model. Saves generated files under .comicode/images and returns their paths. Use this when the user asks you to create, draw, design, or generate an image or visual asset.',
  parameters: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description: 'Detailed description of the image to generate.',
      },
      size: {
        type: 'string',
        description:
          'Optional size/aspect hint (provider-specific), e.g. 1024x1024, 1024x1536, 1536x1024, or 16:9 for supported Gemini/Imagen models.',
      },
      n: {
        type: 'integer',
        description: 'Optional number of images to generate (default 1, max 4 when supported).',
      },
    },
    required: ['prompt'],
  },
};

export interface GenerateImageToolArgs {
  prompt?: string;
  size?: string;
  n?: number;
}

export interface GenerateImageToolContext {
  appContext?: AppContext;
  cwd: string;
  store?: AppContext['store'];
  settings?: AppContext['settings'];
}

function buildMinimalContext(input: GenerateImageToolContext): AppContext | null {
  if (input.appContext) return input.appContext;
  if (input.store && input.settings) {
    return {
      store: input.store,
      cwd: input.cwd,
      settings: input.settings,
      close: () => {},
    };
  }
  return null;
}

export async function executeGenerateImageTool(
  args: GenerateImageToolArgs | undefined,
  context: GenerateImageToolContext,
): Promise<ToolResult> {
  const prompt = typeof args?.prompt === 'string' ? args.prompt.trim() : '';
  if (!prompt) {
    return { ok: false, content: 'generate_image requires a non-empty "prompt" string.' };
  }

  const ctx = buildMinimalContext(context);
  if (!ctx) {
    return {
      ok: false,
      content:
        'Image generation is not wired with application context yet. Integration must pass AppContext/store+settings to the tool executor so profiles and credentials can be resolved.',
    };
  }

  try {
    const result = await generateImage(ctx, {
      prompt,
      size: typeof args?.size === 'string' ? args.size : undefined,
      n: typeof args?.n === 'number' && Number.isFinite(args.n) ? Math.max(1, Math.min(Math.floor(args.n), 4)) : undefined,
    });

    const lines = [
      `Generated ${result.images.length} image${result.images.length === 1 ? '' : 's'} with ${result.model} (${result.profileId}).`,
    ];
    if (result.savedPaths.length) {
      lines.push('Saved files:');
      for (const p of result.savedPaths) lines.push(`- ${p}`);
    } else {
      lines.push('No files were saved to disk; provider returned image data/URLs only.');
    }
    return {
      ok: true,
      content: lines.join('\n'),
      metadata: {
        model: result.model,
        profileId: result.profileId,
        savedPaths: result.savedPaths,
        imageCount: result.images.length,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, content: `Image generation failed: ${message}` };
  }
}
