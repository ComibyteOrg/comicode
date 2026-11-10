import type {
  AgentAuthority,
  ModelInfo,
  ProviderProfile,
  TaskRecord,
  TaskType,
} from '../core/types.js';
import type { Store } from '../core/db/store.js';
import { openAppContext, type AppContext } from '../core/app.js';
import { CodingAgent } from '../core/agent/agent.js';
import type { AgentHooks, AgentResult, ConfirmationRequest } from '../core/agent/types.js';
import { providerDisplayName } from '../core/providers/definitions.js';
import { ACCESS_LABELS, effectiveAccess } from '../core/providers/catalog.js';
import { ProjectInspector } from '../core/project/inspector.js';
import { bold, danger, dim, formatTokens, success, warning } from './output.js';
import { isInteractive, promptConfirm } from './prompt.js';

export interface AuthorityOptions {
  yes?: boolean;
  allowCommands?: boolean;
  allowDangerousCommands?: boolean;
  allowSecrets?: boolean;
  allowPaid?: boolean;
}

export const AUTHORITY_FLAGS = [
  '--yes (file edits)',
  '--allow-commands (shell commands)',
  '--allow-dangerous-commands (risky shell commands)',
  '--allow-secrets (protected files)',
  '--allow-paid (paid fallbacks for this run)',
];

/** Open the application database and always close it, even on failure. */
export async function withStore<T>(fn: (context: AppContext) => Promise<T> | T): Promise<T> {
  const context = openAppContext(process.cwd());
  try {
    return await fn(context);
  } finally {
    context.close();
  }
}

export function authorityFrom(options: AuthorityOptions): AgentAuthority {
  return {
    allowFileWrites: Boolean(options.yes),
    allowCommands: Boolean(options.allowCommands),
    allowDangerousCommands: Boolean(options.allowDangerousCommands),
    allowSecrets: Boolean(options.allowSecrets),
    allowGitWrite: Boolean(options.allowCommands),
  };
}

export function normalizeTaskType(value: string | undefined): TaskType {
  const allowed: TaskType[] = ['coding', 'reasoning', 'review', 'vision', 'general'];
  if (!value) return 'coding';
  if (!allowed.includes(value as TaskType)) {
    throw new Error(`Invalid task type "${value}". Choose one of: ${allowed.join(', ')}.`);
  }
  return value as TaskType;
}

function matchesReference(profile: ProviderProfile, reference: string): boolean {
  const trimmed = reference.trim().toLowerCase();
  if (!trimmed) return false;
  if (profile.id.toLowerCase() === trimmed) return true;
  if (profile.name.toLowerCase() === trimmed) return true;
  if (`${profile.providerId}:${profile.name}`.toLowerCase() === trimmed) return true;
  if (`${providerDisplayName(profile.providerId)}:${profile.name}`.toLowerCase() === trimmed)
    return true;
  return false;
}

/** Resolve a profile by id, name, `provider:name`, or a unique name substring. */
export function resolveProfile(store: Store, reference?: string | null): ProviderProfile {
  const profiles = store.listProfiles();
  if (profiles.length === 0) {
    throw new Error('No provider profiles are connected. Add one with "comicode providers add".');
  }
  if (!reference?.trim()) {
    const selectedId = store.getSelectedProfileId();
    const selected = selectedId ? profiles.find((profile) => profile.id === selectedId) : null;
    if (selected) return selected;
    const enabled = profiles.find((profile) => profile.enabled);
    if (enabled) return enabled;
    throw new Error('No enabled provider profile is available. Add or enable one first.');
  }
  const exact = profiles.filter((profile) => matchesReference(profile, reference));
  if (exact.length === 1) return exact[0]!;
  if (exact.length > 1) {
    throw new Error(
      `Profile reference "${reference}" is ambiguous:\n${exact
        .map(
          (profile) =>
            `  ${profile.name} (${providerDisplayName(profile.providerId)}, ${profile.id})`,
        )
        .join('\n')}`,
    );
  }
  const lower = reference.trim().toLowerCase();
  const partial = profiles.filter(
    (profile) =>
      profile.name.toLowerCase().includes(lower) || profile.id.toLowerCase().startsWith(lower),
  );
  if (partial.length === 1) return partial[0]!;
  const providerMatches = profiles.filter((profile) => profile.providerId === lower);
  if (providerMatches.length === 1) return providerMatches[0]!;
  if (partial.length > 1) {
    throw new Error(
      `Profile reference "${reference}" matches multiple profiles:\n${partial
        .map((entry) => `  ${entry.name} (${entry.id})`)
        .join('\n')}`,
    );
  }
  throw new Error(
    `No profile matched "${reference}". Connected profiles:\n${profiles
      .map(
        (profile) =>
          `  ${profile.name} (${providerDisplayName(profile.providerId)}, ${profile.id})`,
      )
      .join('\n')}`,
  );
}

export interface ResolvedModel {
  model: ModelInfo;
  profile: ProviderProfile;
}

/** Resolve a model by database id, `profile/model`, provider/model, or unique model id. */
export function resolveModel(
  store: Store,
  reference: string,
  profileReference?: string | null,
): ResolvedModel {
  const profiles = store.listProfiles();
  if (profiles.length === 0) {
    throw new Error('No provider profiles are connected. Add one with "comicode providers add".');
  }
  const models = store.listModels();
  const trimmed = reference.trim();
  if (!trimmed) throw new Error('A model reference is required.');

  const profileFilter = profileReference ? resolveProfile(store, profileReference) : null;
  const byProfile = (model: ModelInfo): boolean =>
    !profileFilter || model.profileId === profileFilter.id || model.profileId === null;

  const exactId = models.filter((model) => model.id === trimmed);
  if (exactId.length === 1) {
    const model = exactId[0]!;
    const profile = resolveModelProfile(store, model, profileFilter);
    return { model, profile };
  }

  if (trimmed.includes('/')) {
    const [head, ...rest] = trimmed.split('/');
    const tail = rest.join('/');
    if (head && tail) {
      try {
        const profile = profileFilter ?? resolveProfile(store, head);
        const model = models.find(
          (entry) =>
            entry.modelId === tail &&
            entry.providerId === profile.providerId &&
            (entry.profileId === null || entry.profileId === profile.id),
        );
        if (model) return { model, profile };
      } catch {
        // Not a profile reference; fall through.
      }
    }
  }

  const exactModel = models.filter((model) => model.modelId === trimmed && byProfile(model));
  if (exactModel.length === 1) {
    const model = exactModel[0]!;
    return { model, profile: resolveModelProfile(store, model, profileFilter) };
  }

  const partial = models.filter(
    (model) =>
      byProfile(model) &&
      (model.modelId.toLowerCase().includes(trimmed.toLowerCase()) ||
        model.displayName.toLowerCase().includes(trimmed.toLowerCase())),
  );
  const unique = dedupeModels(partial);
  if (unique.length === 1) {
    const model = unique[0]!;
    return { model, profile: resolveModelProfile(store, model, profileFilter) };
  }
  if (unique.length > 1) {
    throw new Error(
      `Model reference "${trimmed}" is ambiguous. Candidates:\n${unique
        .slice(0, 20)
        .map((model) => `  ${model.id}`)
        .join('\n')}`,
    );
  }
  throw new Error(
    `No model matched "${trimmed}". Run "comicode models list" to see available models.`,
  );
}

function dedupeModels(models: ModelInfo[]): ModelInfo[] {
  const seen = new Set<string>();
  const output: ModelInfo[] = [];
  for (const model of models) {
    const key = `${model.providerId}:${model.profileId ?? ''}:${model.modelId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(model);
  }
  return output;
}

function resolveModelProfile(
  store: Store,
  model: ModelInfo,
  preferred: ProviderProfile | null,
): ProviderProfile {
  const profiles = store
    .listProfiles()
    .filter((profile) => profile.providerId === model.providerId);
  if (model.profileId) {
    const scoped = store.getProfile(model.profileId);
    if (scoped) return scoped;
  }
  if (preferred && preferred.providerId === model.providerId) return preferred;
  const withDefault = profiles.find((profile) => profile.defaultModel === model.modelId);
  if (withDefault) return withDefault;
  const enabled = profiles.find((profile) => profile.enabled);
  if (enabled) return enabled;
  const first = profiles[0];
  if (first) return first;
  throw new Error(
    `No profile exists for provider "${model.providerId}". Connect the provider first.`,
  );
}

export function profileLabel(profile: ProviderProfile): string {
  return `${profile.name} ${dim(`(${providerDisplayName(profile.providerId)})`)}`;
}

export function modelAccessLabel(profile: ProviderProfile, model: ModelInfo): string {
  const access = effectiveAccess(model, profile.accessClassification);
  return ACCESS_LABELS[access] ?? access;
}

export function formatPrice(model: ModelInfo): string {
  if (model.inputPricePerMillion === null && model.outputPricePerMillion === null) return '—';
  const input = model.inputPricePerMillion ?? 0;
  const output = model.outputPricePerMillion ?? 0;
  if (input === 0 && output === 0) return 'free';
  return `$${input.toFixed(2)}/$${output.toFixed(2)}`;
}

export function formatContext(model: ModelInfo): string {
  return model.contextWindow ? formatTokens(model.contextWindow) : '—';
}

export function taskTitle(task: TaskRecord): string {
  const firstLine = task.userRequest.replace(/\s+/g, ' ').trim();
  return firstLine.length > 72 ? `${firstLine.slice(0, 71)}…` : firstLine || '(empty request)';
}

export interface RunTaskOptions extends AuthorityOptions {
  json?: boolean;
  resume?: boolean;
  signal?: AbortSignal;
  maxSteps?: number;
}

function printConfirmation(request: ConfirmationRequest): void {
  console.log('');
  console.log(`${warning('Approval needed')}  ${bold(request.title)}`);
  console.log(dim(request.description));
  if (request.path) console.log(`${dim('path:')} ${request.path}`);
  if (request.command) console.log(`${dim('command:')} ${request.command}`);
  if (request.reasons?.length) {
    for (const reason of request.reasons) console.log(`${danger('risk:')} ${reason}`);
  }
  if (request.diff) {
    const lines = request.diff.split(/\r?\n/);
    const shown = lines.slice(0, 160);
    console.log(dim('─'.repeat(60)));
    for (const line of shown) {
      if (line.startsWith('+')) console.log(success(line));
      else if (line.startsWith('-')) console.log(danger(line));
      else console.log(dim(line));
    }
    if (lines.length > shown.length) {
      console.log(
        dim(`… ${lines.length - shown.length} more diff lines (full diff in checkpoint)`),
      );
    }
    console.log(dim('─'.repeat(60)));
  }
}

/** Run a persisted task with human-readable streaming output. */
export async function runTask(
  store: Store,
  taskId: string,
  options: RunTaskOptions = {},
): Promise<AgentResult> {
  const json = Boolean(options.json);
  let streamedInTurn = false;
  let streamedAny = false;

  const hooks: AgentHooks = {
    onText: (delta) => {
      if (json) return;
      streamedInTurn = true;
      streamedAny = true;
      process.stdout.write(delta);
    },
    onAssistantMessage: (content) => {
      if (json) return;
      if (streamedInTurn && content.trim()) process.stdout.write('\n');
      streamedInTurn = false;
    },
    onToolStart: (call) => {
      if (json) return;
      const args = JSON.stringify(call.arguments ?? {});
      console.log(
        `\n${dim('→')} ${bold(call.name)} ${dim(args.length > 160 ? `${args.slice(0, 159)}…` : args)}`,
      );
    },
    onToolResult: (call, result) => {
      if (json) return;
      const firstLine = result.content.split(/\r?\n/).find((line) => line.trim()) ?? '';
      const label = result.ok ? success('✔') : danger('✖');
      console.log(`${label} ${dim(`${call.name}: ${firstLine.slice(0, 220)}`)}`);
    },
    onRoute: (decision) => {
      if (json) return;
      if (streamedAny) console.log('');
      console.log(
        `${dim('◇ route')} ${bold(decision.candidate.profile.name)}/${bold(
          decision.candidate.model.modelId,
        )} ${dim(`— ${decision.reason}`)}`,
      );
    },
    onNotice: (message) => {
      if (json) return;
      console.log(`${warning('!')} ${message}`);
    },
    onRetry: (info) => {
      if (json) return;
      console.log(
        `${warning('↻')} retrying ${info.category} in ${(info.delayMs / 1000).toFixed(1)}s (attempt ${info.attempt})`,
      );
    },
    onUsage: (usage, candidate) => {
      if (json) return;
      console.log(
        dim(
          `  tokens: ${formatTokens(usage.inputTokens)} in / ${formatTokens(
            usage.outputTokens,
          )} out · ${candidate.profile.name}/${candidate.model.modelId}`,
        ),
      );
    },
    onPlan: (plan) => {
      if (json) return;
      const value = plan as { summary?: string; steps?: Array<{ title: string; status: string }> };
      if (!value?.steps) return;
      console.log(`\n${bold('Plan')} ${dim(value.summary ?? '')}`);
      for (const step of value.steps) {
        console.log(dim(`  [${step.status}] ${step.title}`));
      }
    },
    onReview: (review) => {
      if (json) return;
      console.log(`\n${bold('Reviewer')}\n${review}`);
    },
    onCheckpoint: () => {
      // Checkpoints are intentionally quiet in the CLI.
    },
    onPaused: (reason) => {
      if (json) return;
      console.log('');
      console.log(warning('Paused'));
      console.log(reason);
    },
    onTaskComplete: (summary) => {
      if (json) return;
      console.log('');
      console.log(success('Completed'));
      if (summary) console.log(summary);
    },
    confirm: async (request) => {
      if (json || !isInteractive()) {
        console.log(
          `${warning('!')} ${request.title} was not approved because no interactive confirmation is available.`,
        );
        console.log(dim(`  Re-run with ${AUTHORITY_FLAGS.join(', ')} as appropriate.`));
        return false;
      }
      printConfirmation(request);
      return promptConfirm('Approve this action?', false);
    },
  };

  const agent = new CodingAgent({
    store,
    taskId,
    hooks,
    authority: authorityFrom(options),
    settings: store.getSettings(),
    routingOverrides: options.allowPaid ? { allowPaid: true } : undefined,
  });

  let result: AgentResult;
  try {
    result = await agent.run({
      resume: options.resume,
      signal: options.signal,
      maxSteps: options.maxSteps,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (json) {
      console.log(JSON.stringify({ ok: false, taskId, error: message }, null, 2));
    } else {
      console.log(`${danger('✖')} ${message}`);
    }
    return {
      status: 'failed',
      taskId,
      summary: null,
      pauseReason: message,
      finalResponse: null,
      usage: { inputTokens: 0, outputTokens: 0 },
      steps: 0,
    };
  }

  if (json) {
    const task = store.getTask(taskId);
    console.log(
      JSON.stringify(
        {
          ok: result.status === 'completed',
          result,
          task,
          usageTotals: store.usageTotals(),
        },
        null,
        2,
      ),
    );
  } else {
    console.log(
      dim(
        `\n${result.steps} steps · ${formatTokens(result.usage.inputTokens)} in / ${formatTokens(
          result.usage.outputTokens,
        )} out · task ${result.taskId}`,
      ),
    );
  }
  return result;
}

export function createTaskForRequest(
  store: Store,
  cwd: string,
  request: string,
  options: { taskType?: TaskType; profileId?: string | null; modelId?: string | null } = {},
): TaskRecord {
  const inspector = new ProjectInspector(cwd);
  const projectName = inspector.projectName();
  return store.createTask({
    projectPath: cwd,
    projectName,
    userRequest: request,
    taskType: options.taskType ?? 'coding',
    currentProfileId: options.profileId ?? null,
    currentModelId: options.modelId ?? null,
    metadata: { createdBy: 'cli', source: 'comicode' },
  });
}

export function resultExitCode(result: AgentResult): number {
  if (result.status === 'completed') return 0;
  if (result.status === 'paused') return 2;
  return 1;
}

export function printResumeHint(result: AgentResult): void {
  if (result.status === 'paused') {
    console.log(
      dim(`Resume with: comicode resume ${result.taskId}  (progress and checkpoints are saved)`),
    );
  }
}
