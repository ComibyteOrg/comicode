import type { Command } from 'commander';
import type { AccessClassification, ModelInfo, ProviderProfile } from '../../core/types.js';
import { ACCESS_CLASSIFICATIONS } from '../../core/settings.js';
import {
  ACCESS_LABELS,
  effectiveAccess,
  isFreeAccess,
  isPaidAccess,
} from '../../core/providers/catalog.js';
import { addManualModel, refreshProfileModels } from '../../core/providers/service.js';
import { providerDisplayName } from '../../core/providers/definitions.js';
import { classifyThrown } from '../../core/providers/errors.js';
import {
  bold,
  danger,
  dim,
  jsonOut,
  printSection,
  printTable,
  success,
  truncate,
  warning,
} from '../output.js';
import { isInteractive, promptConfirm } from '../prompt.js';
import { formatContext, formatPrice, resolveModel, resolveProfile, withStore } from '../shared.js';

interface ListOptions {
  profile?: string;
  provider?: string;
  free?: boolean;
  tools?: boolean;
  vision?: boolean;
  available?: boolean;
  all?: boolean;
  search?: string;
  json?: boolean;
  limit?: string;
}

function owningProfile(profiles: ProviderProfile[], model: ModelInfo): ProviderProfile | null {
  if (model.profileId) {
    return profiles.find((profile) => profile.id === model.profileId) ?? null;
  }
  return (
    profiles.find(
      (profile) =>
        profile.providerId === model.providerId && profile.defaultModel === model.modelId,
    ) ??
    profiles.find((profile) => profile.providerId === model.providerId && profile.enabled) ??
    profiles.find((profile) => profile.providerId === model.providerId) ??
    null
  );
}

async function listModels(options: ListOptions): Promise<void> {
  await withStore(({ store }) => {
    const profiles = store.listProfiles();
    const enabledProviderIds = new Set(
      profiles.filter((profile) => profile.enabled).map((profile) => profile.providerId),
    );
    const filterProfile = options.profile ? resolveProfile(store, options.profile) : null;
    let models = store.listModels();
    if (!options.all) {
      models = models.filter((model) =>
        profiles.some((profile) => profile.providerId === model.providerId),
      );
    }
    if (filterProfile) {
      models = models.filter(
        (model) =>
          model.providerId === filterProfile.providerId &&
          (model.profileId === null || model.profileId === filterProfile.id),
      );
    }
    if (options.provider) {
      models = models.filter((model) => model.providerId === options.provider);
    }
    if (options.search) {
      const needle = options.search.toLowerCase();
      models = models.filter(
        (model) =>
          model.modelId.toLowerCase().includes(needle) ||
          model.displayName.toLowerCase().includes(needle),
      );
    }
    if (options.tools) models = models.filter((model) => model.supportsTools);
    if (options.vision) models = models.filter((model) => model.supportsVision);
    if (options.available) models = models.filter((model) => model.available);
    if (options.free) {
      models = models.filter((model) => {
        const owner = owningProfile(profiles, model);
        const access = effectiveAccess(model, owner?.accessClassification ?? null);
        return isFreeAccess(access);
      });
    }
    const limit = options.limit ? Number(options.limit) : 200;
    if (Number.isFinite(limit) && limit > 0) models = models.slice(0, limit);

    if (options.json) {
      jsonOut(
        models.map((model) => {
          const owner = owningProfile(profiles, model);
          return {
            ...model,
            effectiveAccess: effectiveAccess(model, owner?.accessClassification ?? null),
            profileName: owner?.name ?? null,
          };
        }),
      );
      return;
    }

    const selectedModelId = store.getSelectedModelId();
    printSection('Models');
    console.log(
      dim(
        `${models.length} model${models.length === 1 ? '' : 's'} · ${profiles.length} profile${profiles.length === 1 ? '' : 's'}${
          options.free ? ' · free only' : ''
        }`,
      ),
    );
    printTable(
      ['MODEL', 'PROFILE / PROVIDER', 'ACCESS', 'CTX', 'PRICE IN/OUT', 'TOOLS', 'VISION', 'STATUS'],
      models.map((model) => {
        const owner = owningProfile(profiles, model);
        const access = effectiveAccess(model, owner?.accessClassification ?? null);
        const selected = selectedModelId === model.id ? success('● ') : '';
        return [
          `${selected}${model.modelId}`,
          `${owner?.name ?? '—'} ${dim(providerDisplayName(model.providerId))}`,
          access === 'free-confirmed' || access === 'user-free'
            ? success(ACCESS_LABELS[access])
            : access === 'paid' || access === 'user-paid'
              ? warning(ACCESS_LABELS[access])
              : access === 'unavailable'
                ? danger(ACCESS_LABELS[access])
                : dim(ACCESS_LABELS[access]),
          formatContext(model),
          formatPrice(model),
          model.supportsTools ? 'yes' : 'no',
          model.supportsVision ? 'yes' : 'no',
          !model.available
            ? danger('stale')
            : !enabledProviderIds.has(model.providerId)
              ? warning('profile off')
              : 'available',
        ];
      }),
    );
    if (models.length === 0) {
      console.log('');
      console.log(
        `No models matched. Refresh with ${bold('comicode models refresh')} or add one manually with ${bold(
          'comicode models add <profile> <model-id>',
        )}.`,
      );
    }
  });
}

async function refreshModels(
  reference: string | undefined,
  options: { json?: boolean },
): Promise<number> {
  return withStore(async ({ store }) => {
    const profiles = reference
      ? [resolveProfile(store, reference)]
      : store.listProfiles().filter((profile) => profile.enabled);
    if (profiles.length === 0) throw new Error('No enabled profiles to refresh.');
    let failures = 0;
    const results: Array<Record<string, unknown>> = [];
    for (const profile of profiles) {
      try {
        const result = await refreshProfileModels(store, profile);
        results.push({ profile: profile.name, ok: true, ...result });
        if (!options.json) {
          console.log(
            `${success('✔')} ${profile.name}: ${result.discovered} model${result.discovered === 1 ? '' : 's'} (${result.latencyMs}ms)`,
          );
        }
      } catch (error) {
        failures += 1;
        const classified = classifyThrown(error, profile.providerId);
        results.push({ profile: profile.name, ok: false, ...classified.toJSON() });
        if (!options.json) {
          console.log(
            `${danger('✖')} ${profile.name}: ${classified.message} (${classified.category})`,
          );
        }
      }
    }
    if (options.json) jsonOut(results);
    return failures === 0 ? 0 : 1;
  });
}

async function addModel(
  profileReference: string,
  modelId: string,
  options: { default?: boolean; json?: boolean },
): Promise<void> {
  await withStore(async ({ store }) => {
    const profile = resolveProfile(store, profileReference);
    await addManualModel(store, profile, modelId);
    if (options.default || !profile.defaultModel) {
      store.updateProfile(profile.id, { defaultModel: modelId.trim() });
    }
    const model = store
      .listModels(profile.providerId, profile.providerId === 'custom' ? profile.id : undefined)
      .find(
        (entry) =>
          entry.modelId === modelId.trim() &&
          (entry.profileId === null || entry.profileId === profile.id),
      );
    if (options.json) {
      jsonOut({ profile: profile.name, model });
      return;
    }
    console.log(`${success('✔')} Added ${modelId.trim()} to ${profile.name}.`);
    console.log(
      dim(
        'Capabilities are assumed until verified. Refresh the provider catalog for real metadata when available.',
      ),
    );
  });
}

async function removeModel(
  reference: string,
  options: { yes?: boolean; profile?: string },
): Promise<void> {
  await withStore(async ({ store }) => {
    const { model } = resolveModel(store, reference, options.profile);
    if (!options.yes) {
      if (!isInteractive())
        throw new Error('Deleting a model requires --yes in non-interactive mode.');
      const confirmed = await promptConfirm(
        `Remove model "${model.modelId}" from the catalog?`,
        false,
      );
      if (!confirmed) {
        console.log(dim('Cancelled.'));
        return;
      }
    }
    store.deleteModel(model.id);
    if (store.getSelectedModelId() === model.id) store.setSelectedModelId(null);
    const owner = model.profileId ? store.getProfile(model.profileId) : null;
    if (owner?.defaultModel === model.modelId && owner.providerId === model.providerId) {
      store.updateProfile(owner.id, { defaultModel: null });
    }
    console.log(`${success('✔')} Removed ${model.modelId}.`);
  });
}

async function selectModel(
  reference: string,
  options: { profile?: string; json?: boolean },
): Promise<void> {
  await withStore(({ store }) => {
    const { model, profile } = resolveModel(store, reference, options.profile);
    if (!profile.enabled) {
      throw new Error(
        `Profile "${profile.name}" is disabled. Enable it with "comicode providers enable ${profile.name}".`,
      );
    }
    store.setSelectedProfileId(profile.id);
    store.setSelectedModelId(model.id);
    if (options.json) {
      jsonOut({ profile: profile.id, model: model.id, modelId: model.modelId });
      return;
    }
    console.log(
      `${success('✔')} Selected ${bold(model.modelId)} via ${profile.name} (${providerDisplayName(model.providerId)}).`,
    );
    const access = effectiveAccess(model, profile.accessClassification);
    if (isPaidAccess(access)) {
      console.log(
        warning(
          'This model is classified as paid. Explicit selections are honored, but fallbacks remain blocked unless allowPaid is enabled.',
        ),
      );
    } else if (access === 'unknown') {
      console.log(
        dim(
          'Access is unknown. Routing policy controls whether unknown models may be used as fallbacks.',
        ),
      );
    }
  });
}

async function setDefaultModel(profileReference: string, modelReference: string): Promise<void> {
  await withStore(({ store }) => {
    const profile = resolveProfile(store, profileReference);
    const { model } = resolveModel(store, modelReference, profile.name);
    store.updateProfile(profile.id, { defaultModel: model.modelId });
    console.log(`${success('✔')} Default model for ${profile.name} is now ${bold(model.modelId)}.`);
  });
}

async function classifyModel(
  reference: string,
  access: string,
  options: { profile?: string },
): Promise<void> {
  await withStore(({ store }) => {
    const { model } = resolveModel(store, reference, options.profile);
    if (access === 'auto' || access === 'clear' || access === 'default') {
      store.setUserClassification(model.id, null);
      console.log(`${success('✔')} Cleared the user classification for ${model.modelId}.`);
      return;
    }
    if (!(ACCESS_CLASSIFICATIONS as string[]).includes(access)) {
      throw new Error(
        `Unknown access classification "${access}". Choose: ${ACCESS_CLASSIFICATIONS.join(', ')} or auto.`,
      );
    }
    store.setUserClassification(model.id, access as AccessClassification);
    console.log(
      `${success('✔')} ${model.modelId} is now classified as ${ACCESS_LABELS[access as AccessClassification]}.`,
    );
    console.log(dim('User classifications override provider metadata for routing.'));
  });
}

async function showModel(
  reference: string,
  options: { profile?: string; json?: boolean },
): Promise<void> {
  await withStore(({ store }) => {
    const { model, profile } = resolveModel(store, reference, options.profile);
    if (options.json) {
      jsonOut({ ...model, profileName: profile.name });
      return;
    }
    const access = effectiveAccess(model, profile.accessClassification);
    printSection(model.displayName);
    printTable(
      ['FIELD', 'VALUE'],
      [
        ['Model ID', model.modelId],
        ['Provider', providerDisplayName(model.providerId)],
        ['Profile', profile.name],
        ['Access', ACCESS_LABELS[access]],
        ['Access source', model.accessSource],
        ['User override', model.userClassification ?? '—'],
        ['Context window', model.contextWindow?.toLocaleString() ?? '—'],
        ['Max output', model.maxOutputTokens?.toLocaleString() ?? '—'],
        ['Tools', model.supportsTools ? 'yes' : 'no'],
        ['Streaming', model.supportsStreaming ? 'yes' : 'no'],
        ['Vision', model.supportsVision ? 'yes' : 'no'],
        ['Coding suitability', `${model.codingSuitability}/5`],
        ['Reasoning suitability', `${model.reasoningSuitability}/5`],
        ['Input price / M', formatPrice(model).split('/')[0] ?? '—'],
        ['Output price / M', formatPrice(model).split('/')[1] ?? '—'],
        ['Available', model.available ? success('yes') : warning('stale')],
        ['Last checked', model.lastCheckedAt ?? '—'],
        ['Notes', truncate(model.accessNotes ?? '—', 100)],
      ],
    );
    console.log('');
    console.log(dim(`Select with: comicode models select ${model.id}`));
  });
}

function parseBool(value: string): boolean {
  if (['true', 'yes', '1', 'on'].includes(value.toLowerCase())) return true;
  if (['false', 'no', '0', 'off'].includes(value.toLowerCase())) return false;
  throw new Error(`Invalid boolean "${value}". Use true or false.`);
}

export function registerModelCommands(program: Command): void {
  const models = program
    .command('models')
    .description('Inspect, refresh, and select models')
    .option('--profile <profile>', 'limit to one profile')
    .option('--provider <provider>', 'limit to one provider kind')
    .option('--free', 'only free or user-free models')
    .option('--tools', 'only models with tool calling')
    .option('--vision', 'only vision models')
    .option('--available', 'only currently available models')
    .option('--all', 'include providers without a connected profile')
    .option('--search <text>', 'filter by model id or name')
    .option('--limit <number>', 'maximum rows', '200')
    .option('--json', 'machine-readable output')
    .action(async (options: ListOptions) => {
      await listModels(options);
    });

  models
    .command('list')
    .alias('ls')
    .description('List models')
    .option('--profile <profile>', 'limit to one profile')
    .option('--provider <provider>', 'limit to one provider kind')
    .option('--free', 'only free or user-free models')
    .option('--tools', 'only models with tool calling')
    .option('--vision', 'only vision models')
    .option('--available', 'only currently available models')
    .option('--all', 'include providers without a connected profile')
    .option('--search <text>', 'filter by model id or name')
    .option('--limit <number>', 'maximum rows', '200')
    .option('--json', 'machine-readable output')
    .action(async (options: ListOptions) => {
      await listModels(options);
    });

  models
    .command('refresh [profile]')
    .description('Refresh model catalogs (all enabled profiles by default)')
    .option('--json', 'machine-readable output')
    .action(async (reference: string | undefined, options: { json?: boolean }) => {
      const code = await refreshModels(reference, options);
      if (code !== 0) process.exitCode = code;
    });

  models
    .command('add <profile> <modelId>')
    .description('Add a model manually (useful when discovery is unavailable)')
    .option('--default', 'also set it as the profile default')
    .option('--json', 'machine-readable output')
    .action(async (profile: string, modelId: string, options) => {
      await addModel(profile, modelId, options);
    });

  models
    .command('remove <model>')
    .alias('rm')
    .description('Remove a model from the catalog')
    .option('--profile <profile>', 'disambiguate the model by profile')
    .option('--yes', 'do not prompt for confirmation')
    .action(async (reference: string, options) => {
      await removeModel(reference, options);
    });

  models
    .command('select <model>')
    .alias('use')
    .description('Select the model used by new tasks')
    .option('--profile <profile>', 'disambiguate the model by profile')
    .option('--json', 'machine-readable output')
    .action(async (reference: string, options) => {
      await selectModel(reference, options);
    });

  models
    .command('default <profile> <model>')
    .description('Set a profile default model')
    .action(async (profile: string, model: string) => {
      await setDefaultModel(profile, model);
    });

  models
    .command('classify <model> <access>')
    .description(`Override access classification (${ACCESS_CLASSIFICATIONS.join('|')}|auto)`)
    .option('--profile <profile>', 'disambiguate the model by profile')
    .action(async (reference: string, access: string, options) => {
      await classifyModel(reference, access, options);
    });

  models
    .command('show <model>')
    .description('Show model metadata')
    .option('--profile <profile>', 'disambiguate the model by profile')
    .option('--json', 'machine-readable output')
    .action(async (reference: string, options) => {
      await showModel(reference, options);
    });
}

export { parseBool };
