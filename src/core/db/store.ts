import { randomUUID } from 'node:crypto';
import { statSync } from 'node:fs';
import { Db, safeJsonParse } from './database.js';
import { parseSettings, type AppSettings } from '../settings.js';
import { classifyDiscoveredAccess } from '../providers/catalog.js';
import { getProviderDefinition } from '../providers/definitions.js';
import type {
  AgentMessage,
  AccessClassification,
  CheckpointRecord,
  CheckpointState,
  DiscoveredModel,
  ErrorCategory,
  ModelInfo,
  ProviderHealthRecord,
  ProviderKind,
  ProviderLimit,
  ProviderProfile,
  ResumeSummary,
  RouteAttemptFailure,
  RoutingEvent,
  StoredMessage,
  TaskPlan,
  TaskRecord,
  TaskStatus,
  TaskType,
  ToolCall,
  UsageAggregate,
} from '../types.js';
import { TASK_PHASES } from '../types.js';

type Row = Record<string, unknown>;

const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const nullableStr = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;
const num = (value: unknown): number => (typeof value === 'number' ? value : Number(value ?? 0));
const nullableNum = (value: unknown): number | null =>
  value === null || value === undefined ? null : Number(value);
const bool = (value: unknown): boolean => Number(value) === 1;

function nowIso(): string {
  return new Date().toISOString();
}

function mapProfile(row: Row): ProviderProfile {
  return {
    id: str(row.id),
    providerId: str(row.provider_id) as ProviderKind,
    name: str(row.name),
    baseUrl: str(row.base_url),
    authType: (row.auth_type === 'bearer' ? 'bearer' : 'api-key') as 'api-key' | 'bearer',
    defaultModel: nullableStr(row.default_model),
    apiKeyEnv: nullableStr(row.api_key_env),
    enabled: bool(row.enabled),
    accessClassification: str(row.access_classification) as AccessClassification,
    config: safeJsonParse<Record<string, unknown>>(str(row.config_json), {}),
    createdAt: str(row.created_at),
    updatedAt: str(row.updated_at),
    lastSuccessAt: nullableStr(row.last_success_at),
    lastError: nullableStr(row.last_error),
    lastErrorAt: nullableStr(row.last_error_at),
    lastCheckedAt: nullableStr(row.last_checked_at),
    modelsRefreshedAt: nullableStr(row.models_refreshed_at),
  };
}

function mapModel(row: Row): ModelInfo {
  return {
    id: str(row.id),
    providerId: str(row.provider_id) as ProviderKind,
    profileId: nullableStr(row.profile_id),
    modelId: str(row.model_id),
    displayName: str(row.display_name),
    contextWindow: nullableNum(row.context_window),
    maxOutputTokens: nullableNum(row.max_output_tokens),
    supportsTools: bool(row.supports_tools),
    supportsStreaming: bool(row.supports_streaming),
    supportsVision: bool(row.supports_vision),
    codingSuitability: num(row.coding_suitability),
    reasoningSuitability: num(row.reasoning_suitability),
    inputPricePerMillion: nullableNum(row.input_price_per_million),
    outputPricePerMillion: nullableNum(row.output_price_per_million),
    access: str(row.access) as AccessClassification,
    accessSource: str(row.access_source),
    accessNotes: nullableStr(row.access_notes),
    available: bool(row.available),
    lastCheckedAt: nullableStr(row.last_checked_at),
    userClassification:
      (nullableStr(row.user_classification) as AccessClassification | null) ?? null,
    metadata: safeJsonParse<Record<string, unknown>>(str(row.metadata_json), {}),
  };
}

function mapTask(row: Row): TaskRecord {
  const planRaw = nullableStr(row.plan_json);
  const metadata = safeJsonParse<Record<string, unknown>>(str(row.metadata_json), {});
  return {
    id: str(row.id),
    projectPath: str(row.project_path),
    projectName: str(row.project_name),
    userRequest: str(row.user_request),
    taskType: (str(row.task_type) || 'coding') as TaskType,
    status: str(row.status) as TaskStatus,
    phase: (TASK_PHASES as string[]).includes(str(row.phase))
      ? (str(row.phase) as TaskRecord['phase'])
      : 'intake',
    plan: planRaw ? safeJsonParse<TaskPlan | null>(planRaw, null) : null,
    completedSteps: safeJsonParse<string[]>(str(row.completed_steps_json), []),
    pendingSteps: safeJsonParse<string[]>(str(row.pending_steps_json), []),
    relevantFiles: safeJsonParse<string[]>(str(row.relevant_files_json), []),
    changedFiles: safeJsonParse<string[]>(str(row.changed_files_json), []),
    currentProfileId: nullableStr(row.current_profile_id),
    currentModelId: nullableStr(row.current_model_id),
    attempts: safeJsonParse<RouteAttemptFailure[]>(str(row.attempts_json), []),
    metadata,
    summary: nullableStr(row.summary),
    error: nullableStr(row.error),
    createdAt: str(row.created_at),
    updatedAt: str(row.updated_at),
    completedAt: nullableStr(row.completed_at),
    resumeCount: num(row.resume_count),
    lastCheckpointId: nullableStr(row.last_checkpoint_id),
  };
}

function mapMessage(row: Row): StoredMessage {
  return {
    id: num(row.id),
    taskId: str(row.task_id),
    seq: num(row.seq),
    role: str(row.role),
    content: str(row.content),
    toolCalls: safeJsonParse<ToolCall[] | null>(
      row.tool_calls_json ? str(row.tool_calls_json) : null,
      null,
    ),
    toolCallId: nullableStr(row.tool_call_id),
    name: nullableStr(row.name),
    isError: bool(row.is_error),
    tokenEstimate: num(row.token_estimate),
    createdAt: str(row.created_at),
  };
}

function mapLimit(row: Row, nowMs = Date.now()): ProviderLimit {
  const limit: ProviderLimit = {
    profileId: str(row.profile_id),
    modelId: str(row.model_id),
    category: str(row.category) as ErrorCategory,
    message: nullableStr(row.message),
    retryAfterAt: nullableStr(row.retry_after_at),
    resetAt: nullableStr(row.reset_at),
    attempts: num(row.attempts),
    updatedAt: str(row.updated_at),
    active: false,
  };
  limit.active = isLimitActive(limit, nowMs);
  return limit;
}

/**
 * A limit supplied by the provider is authoritative. If a provider gives no
 * reset information we apply a short internal cooldown so a profile cannot
 * remain quarantined forever. The UI still reports the reset time as unknown.
 */
export function isLimitActive(limit: ProviderLimit, nowMs = Date.now()): boolean {
  const retry = limit.retryAfterAt ? Date.parse(limit.retryAfterAt) : NaN;
  const reset = limit.resetAt ? Date.parse(limit.resetAt) : NaN;
  if (Number.isFinite(retry) && retry > nowMs) return true;
  if (Number.isFinite(reset) && reset > nowMs) return true;
  if (Number.isFinite(retry) || Number.isFinite(reset)) return false;
  const updated = Date.parse(limit.updatedAt);
  if (!Number.isFinite(updated)) return false;
  const cooldown =
    limit.category === 'daily_quota' || limit.category === 'billing_restriction'
      ? 30 * 60_000
      : 2 * 60_000;
  return nowMs - updated < cooldown;
}

export interface CreateProfileInput {
  providerId: ProviderKind;
  name: string;
  baseUrl: string;
  authType: 'api-key' | 'bearer';
  defaultModel?: string | null;
  apiKeyEnv?: string | null;
  accessClassification?: AccessClassification;
  config?: Record<string, unknown>;
  enabled?: boolean;
}

export interface CreateTaskInput {
  projectPath: string;
  projectName: string;
  userRequest: string;
  taskType?: TaskType;
  currentProfileId?: string | null;
  currentModelId?: string | null;
  metadata?: Record<string, unknown>;
}

export class Store {
  readonly db: Db;

  constructor(readonly path: string) {
    this.db = new Db(path);
    this.applyNativeSelectionDefault();
    this.applyMouseScrollDefault();
    this.applyMouseScrollDefaultV3();
    this.reclassifyModelAccess();
  }

  /**
   * v2 re-enabled wheel scrolling by default, but users kept reporting that
   * plain drag-selection broke. Keyboard-first default wins: mouse capture
   * stays off unless the user explicitly enables it in settings.
   */
  private applyMouseScrollDefaultV3(): void {
    if (this.db.metaGet('ui.mouse_scroll_default_v3')) return;
    const settings = this.getSettings();
    if (settings.ui.mouseScroll) {
      settings.ui.mouseScroll = false;
      this.saveSettings(settings);
    }
    this.db.metaSet('ui.mouse_scroll_default_v3', '1');
  }

  /**
   * The first selection-default migration forced mouseScroll off as a
   * workaround for stale mouse-capture modes, which are now cleared properly
   * on startup. Re-enable wheel scrolling once; users who prefer native
   * selection can turn it back off in settings.
   */
  private applyMouseScrollDefault(): void {
    if (this.db.metaGet('ui.mouse_scroll_default_v2')) return;
    const settings = this.getSettings();
    if (!settings.ui.mouseScroll) {
      settings.ui.mouseScroll = true;
      this.saveSettings(settings);
    }
    this.db.metaSet('ui.mouse_scroll_default_v2', '1');
  }

  /**
   * One-time migration: model access labels stored by older builds used
   * host-level heuristics that marked every model on a free-tier host as
   * "free-confirmed". Recompute access from the same classifier used at
   * discovery time so paid models stop showing as free. Rows with an explicit
   * user classification are left untouched.
   */
  private reclassifyModelAccess(): void {
    if (this.db.metaGet('models.access_reclassified_v2')) return;
    const rows = this.db.all<{
      id: string;
      provider_id: string;
      profile_id: string | null;
      model_id: string;
      input_price_per_million: number | null;
      output_price_per_million: number | null;
    }>(
      `SELECT id, provider_id, profile_id, model_id, input_price_per_million,
              output_price_per_million
       FROM models WHERE user_classification IS NULL`,
    );
    const profileUrls = new Map<string, string>();
    for (const row of rows) {
      const providerId = row.provider_id as ProviderKind;
      let baseUrl = getProviderDefinition(providerId).defaultBaseUrl;
      if (row.profile_id) {
        if (!profileUrls.has(row.profile_id)) {
          const profile = this.db.get<{ base_url: string }>(
            'SELECT base_url FROM provider_profiles WHERE id = ?',
            row.profile_id,
          );
          profileUrls.set(row.profile_id, profile?.base_url ?? '');
        }
        baseUrl = profileUrls.get(row.profile_id) || baseUrl;
      }
      const classified = classifyDiscoveredAccess(
        providerId,
        {
          modelId: row.model_id,
          displayName: row.model_id,
          inputPricePerMillion: row.input_price_per_million,
          outputPricePerMillion: row.output_price_per_million,
        },
        { baseUrl },
      );
      this.db.run(
        'UPDATE models SET access = ?, access_source = ?, access_notes = ? WHERE id = ?',
        classified.access,
        classified.source,
        classified.notes,
        row.id,
      );
    }
    this.db.metaSet('models.access_reclassified_v2', '1');
  }

  /**
   * Older builds enabled mouse capture by default, which blocked native text
   * selection. Force it off once per database; users can re-enable it from
   * settings afterwards.
   */
  private applyNativeSelectionDefault(): void {
    if (this.db.metaGet('ui.native_selection_default')) return;
    const row = this.db.get<{ json: string }>('SELECT json FROM settings WHERE id = 1');
    if (row) {
      const settings = this.getSettings();
      if (settings.ui.mouseScroll) {
        settings.ui.mouseScroll = false;
        this.saveSettings(settings);
      }
    }
    this.db.metaSet('ui.native_selection_default', '1');
  }

  close(): void {
    this.db.close();
  }

  // ---------------------------------------------------------------- settings
  getSettings(): AppSettings {
    const row = this.db.get<{ json: string }>('SELECT json FROM settings WHERE id = 1');
    return row ? parseSettings(safeJsonParse(row.json, {})) : parseSettings({});
  }

  saveSettings(settings: AppSettings): void {
    const validated = parseSettings(settings);
    this.db.run(
      `INSERT INTO settings(id, json, updated_at) VALUES(1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`,
      JSON.stringify(validated),
      nowIso(),
    );
  }

  updateSettings(mutator: (settings: AppSettings) => AppSettings | void): AppSettings {
    const current = this.getSettings();
    const result = mutator(structuredClone(current)) ?? current;
    this.saveSettings(result);
    return this.getSettings();
  }

  // ----------------------------------------------------------- project cache
  getProjectSnapshot(projectPath: string): { snapshot: unknown; updatedAt: string } | null {
    const row = this.db.get<{ snapshot_json: string; updated_at: string }>(
      'SELECT snapshot_json, updated_at FROM project_cache WHERE project_path = ?',
      projectPath,
    );
    if (!row) return null;
    return { snapshot: safeJsonParse(row.snapshot_json, null), updatedAt: row.updated_at };
  }

  saveProjectSnapshot(projectPath: string, snapshot: unknown): void {
    this.db.run(
      `INSERT INTO project_cache(project_path, snapshot_json, updated_at) VALUES(?, ?, ?)
       ON CONFLICT(project_path) DO UPDATE SET snapshot_json = excluded.snapshot_json, updated_at = excluded.updated_at`,
      projectPath,
      JSON.stringify(snapshot),
      nowIso(),
    );
  }

  // --------------------------------------------------------------- providers
  listProfiles(providerId?: string): ProviderProfile[] {
    const rows = providerId
      ? this.db.all<Row>(
          'SELECT * FROM provider_profiles WHERE provider_id = ? ORDER BY provider_id, name COLLATE NOCASE',
          providerId,
        )
      : this.db.all<Row>(
          'SELECT * FROM provider_profiles ORDER BY provider_id, name COLLATE NOCASE',
        );
    return rows.map(mapProfile);
  }

  getProfile(id: string): ProviderProfile | null {
    const row = this.db.get<Row>('SELECT * FROM provider_profiles WHERE id = ?', id);
    return row ? mapProfile(row) : null;
  }

  findProfile(providerId: string, name: string): ProviderProfile | null {
    const row = this.db.get<Row>(
      'SELECT * FROM provider_profiles WHERE provider_id = ? AND name = ? COLLATE NOCASE',
      providerId,
      name,
    );
    return row ? mapProfile(row) : null;
  }

  createProfile(input: CreateProfileInput): ProviderProfile {
    const timestamp = nowIso();
    const id = randomUUID();
    this.db.run(
      `INSERT INTO provider_profiles(
        id, provider_id, name, base_url, auth_type, default_model, api_key_env,
        enabled, access_classification, config_json, created_at, updated_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      input.providerId,
      input.name,
      input.baseUrl,
      input.authType,
      input.defaultModel ?? null,
      input.apiKeyEnv ?? null,
      input.enabled === false ? 0 : 1,
      input.accessClassification ?? 'unknown',
      JSON.stringify(input.config ?? {}),
      timestamp,
      timestamp,
    );
    const profile = this.getProfile(id);
    if (!profile) throw new Error('Failed to create provider profile.');
    return profile;
  }

  updateProfile(id: string, patch: Partial<ProviderProfile>): ProviderProfile {
    const current = this.getProfile(id);
    if (!current) throw new Error(`Provider profile not found: ${id}`);
    const merged: ProviderProfile = { ...current, ...patch, id: current.id, updatedAt: nowIso() };
    this.db.run(
      `UPDATE provider_profiles SET
        name = ?, base_url = ?, auth_type = ?, default_model = ?, api_key_env = ?,
        enabled = ?, access_classification = ?, config_json = ?, updated_at = ?,
        last_success_at = ?, last_error = ?, last_error_at = ?, last_checked_at = ?,
        models_refreshed_at = ?
       WHERE id = ?`,
      merged.name,
      merged.baseUrl,
      merged.authType,
      merged.defaultModel,
      merged.apiKeyEnv,
      merged.enabled ? 1 : 0,
      merged.accessClassification,
      JSON.stringify(merged.config),
      merged.updatedAt,
      merged.lastSuccessAt,
      merged.lastError,
      merged.lastErrorAt,
      merged.lastCheckedAt,
      merged.modelsRefreshedAt,
      id,
    );
    return this.getProfile(id)!;
  }

  deleteProfile(id: string): void {
    this.db.transaction(() => {
      this.db.run('DELETE FROM provider_profiles WHERE id = ?', id);
      this.db.run('DELETE FROM provider_limits WHERE profile_id = ?', id);
      this.db.run('DELETE FROM provider_health WHERE profile_id = ?', id);
      if (this.getSelectedProfileId() === id) this.setSelectedProfileId(null);
    });
  }

  recordProfileSuccess(id: string): void {
    const timestamp = nowIso();
    this.db.run(
      'UPDATE provider_profiles SET last_success_at = ?, last_checked_at = ?, last_error = NULL WHERE id = ?',
      timestamp,
      timestamp,
      id,
    );
  }

  recordProfileError(id: string, message: string): void {
    const timestamp = nowIso();
    this.db.run(
      'UPDATE provider_profiles SET last_error = ?, last_error_at = ?, last_checked_at = ? WHERE id = ?',
      message,
      timestamp,
      timestamp,
      id,
    );
  }

  // ------------------------------------------------------------------ models
  upsertModels(
    providerId: ProviderKind,
    models: DiscoveredModel[],
    profileId: string | null = null,
  ): ModelInfo[] {
    const timestamp = nowIso();
    const scope = profileId ?? '';
    const scopePrefix = scope ? `${scope}:` : '';
    this.db.transaction(() => {
      for (const model of models) {
        const id = `${providerId}:${scopePrefix}${model.modelId}`;
        this.db.run(
          `INSERT INTO models(
            id, provider_id, profile_id, model_id, display_name, context_window, max_output_tokens,
            supports_tools, supports_streaming, supports_vision, coding_suitability,
            reasoning_suitability, input_price_per_million, output_price_per_million,
            access, access_source, access_notes, available, last_checked_at, metadata_json
          ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
          ON CONFLICT(provider_id, profile_id, model_id) DO UPDATE SET
            display_name = excluded.display_name,
            context_window = COALESCE(excluded.context_window, models.context_window),
            max_output_tokens = COALESCE(excluded.max_output_tokens, models.max_output_tokens),
            supports_tools = excluded.supports_tools,
            supports_streaming = excluded.supports_streaming,
            supports_vision = excluded.supports_vision,
            coding_suitability = excluded.coding_suitability,
            reasoning_suitability = excluded.reasoning_suitability,
            input_price_per_million = COALESCE(excluded.input_price_per_million, models.input_price_per_million),
            output_price_per_million = COALESCE(excluded.output_price_per_million, models.output_price_per_million),
            access = excluded.access,
            access_source = excluded.access_source,
            access_notes = excluded.access_notes,
            available = 1,
            last_checked_at = excluded.last_checked_at,
            metadata_json = excluded.metadata_json`,
          id,
          providerId,
          scope,
          model.modelId,
          model.displayName,
          model.contextWindow ?? null,
          model.maxOutputTokens ?? null,
          model.supportsTools === false ? 0 : 1,
          model.supportsStreaming === false ? 0 : 1,
          model.supportsVision ? 1 : 0,
          model.metadata?.codingSuitability ?? 2,
          model.metadata?.reasoningSuitability ?? 2,
          model.inputPricePerMillion ?? null,
          model.outputPricePerMillion ?? null,
          model.metadata?.access ?? 'unknown',
          String(model.metadata?.accessSource ?? 'provider-model-list'),
          (model.metadata?.accessNotes as string | undefined) ?? null,
          timestamp,
          JSON.stringify(model.metadata ?? {}),
        );
      }
    });
    return this.listModels(providerId);
  }

  /** Insert catalog metadata without marking a model as remotely discovered. */
  seedModel(providerId: ProviderKind, model: ModelInfo): void {
    this.db.run(
      `INSERT INTO models(
        id, provider_id, profile_id, model_id, display_name, context_window, max_output_tokens,
        supports_tools, supports_streaming, supports_vision, coding_suitability,
        reasoning_suitability, input_price_per_million, output_price_per_million,
        access, access_source, access_notes, available, last_checked_at, metadata_json
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING`,
      model.id,
      model.providerId,
      model.profileId ?? '',
      model.modelId,
      model.displayName,
      model.contextWindow,
      model.maxOutputTokens,
      model.supportsTools ? 1 : 0,
      model.supportsStreaming ? 1 : 0,
      model.supportsVision ? 1 : 0,
      model.codingSuitability,
      model.reasoningSuitability,
      model.inputPricePerMillion,
      model.outputPricePerMillion,
      model.access,
      model.accessSource,
      model.accessNotes,
      model.available ? 1 : 0,
      model.lastCheckedAt,
      JSON.stringify(model.metadata),
    );
  }

  listModels(providerId?: string, profileId?: string | null): ModelInfo[] {
    let rows: Row[];
    if (providerId) {
      rows = this.db.all<Row>(
        'SELECT * FROM models WHERE provider_id = ? ORDER BY coding_suitability DESC, model_id',
        providerId,
      );
      if (profileId !== undefined) {
        rows = rows.filter((row) => {
          const scope = nullableStr(row.profile_id);
          return profileId === null ? scope === null : scope === null || scope === profileId;
        });
      }
    } else {
      rows = this.db.all<Row>(
        'SELECT * FROM models ORDER BY provider_id, coding_suitability DESC, model_id',
      );
    }
    return rows.map(mapModel);
  }

  getModel(providerId: string, modelId: string, profileId: string | null = null): ModelInfo | null {
    const row = this.db.get<Row>(
      'SELECT * FROM models WHERE provider_id = ? AND profile_id = ? AND model_id = ?',
      providerId,
      profileId ?? '',
      modelId,
    );
    return row ? mapModel(row) : null;
  }

  getModelById(id: string): ModelInfo | null {
    const row = this.db.get<Row>('SELECT * FROM models WHERE id = ?', id);
    return row ? mapModel(row) : null;
  }

  setUserClassification(id: string, classification: AccessClassification | null): void {
    this.db.run('UPDATE models SET user_classification = ? WHERE id = ?', classification, id);
  }

  setModelAvailable(providerId: string, modelId: string, available: boolean): void {
    this.db.run(
      'UPDATE models SET available = ?, last_checked_at = ? WHERE provider_id = ? AND model_id = ?',
      available ? 1 : 0,
      nowIso(),
      providerId,
      modelId,
    );
  }

  markProviderModelsStale(
    providerId: string,
    exceptIds: string[] = [],
    profileScope = '',
  ): void {
    const placeholders = exceptIds.map(() => '?').join(',');
    const scopeClause = 'AND profile_id = ?';
    const params = [providerId, ...exceptIds, profileScope];
    if (exceptIds.length === 0) {
      this.db.run(
        `UPDATE models SET available = 0 WHERE provider_id = ? ${scopeClause}`,
        providerId,
        profileScope,
      );
      return;
    }
    this.db.run(
      `UPDATE models SET available = 0 WHERE provider_id = ? AND model_id NOT IN (${placeholders}) ${scopeClause}`,
      ...params,
    );
  }

  deleteModel(id: string): void {
    this.db.run('DELETE FROM models WHERE id = ?', id);
  }

  // --------------------------------------------------------------- selection
  getSelectedProfileId(): string | null {
    const value = this.db.metaGet('ui.selected_profile_id');
    return value ? value : null;
  }

  setSelectedProfileId(id: string | null): void {
    this.db.metaSet('ui.selected_profile_id', id ?? '');
  }

  getSelectedModelId(): string | null {
    const value = this.db.metaGet('ui.selected_model_id');
    return value ? value : null;
  }

  /** When the user last picked a model (ISO timestamp), or null. */
  getSelectedModelChangedAt(): string | null {
    const value = this.db.metaGet('ui.selected_model_at');
    return value ? value : null;
  }

  setSelectedModelId(id: string | null): void {
    this.db.metaSet('ui.selected_model_id', id ?? '');
    this.db.metaSet('ui.selected_model_at', id ? nowIso() : '');
  }

  // ------------------------------------------------------------------- tasks
  createTask(input: CreateTaskInput): TaskRecord {
    const id = randomUUID();
    const timestamp = nowIso();
    this.db.run(
      `INSERT INTO tasks(
        id, project_path, project_name, user_request, task_type, status, phase,
        pending_steps_json, metadata_json, current_profile_id, current_model_id,
        created_at, updated_at
      ) VALUES(?, ?, ?, ?, ?, 'running', 'intake', '[]', ?, ?, ?, ?, ?)`,
      id,
      input.projectPath,
      input.projectName,
      input.userRequest,
      input.taskType ?? 'coding',
      JSON.stringify(input.metadata ?? {}),
      input.currentProfileId ?? null,
      input.currentModelId ?? null,
      timestamp,
      timestamp,
    );
    return this.getTask(id)!;
  }

  getTask(id: string): TaskRecord | null {
    const row = this.db.get<Row>('SELECT * FROM tasks WHERE id = ?', id);
    return row ? mapTask(row) : null;
  }

  updateTask(id: string, patch: Partial<TaskRecord>): TaskRecord {
    const current = this.getTask(id);
    if (!current) throw new Error(`Task not found: ${id}`);
    const merged: TaskRecord = { ...current, ...patch, id: current.id, updatedAt: nowIso() };
    this.db.run(
      `UPDATE tasks SET
        status = ?, phase = ?, plan_json = ?, completed_steps_json = ?, pending_steps_json = ?,
        relevant_files_json = ?, changed_files_json = ?, current_profile_id = ?, current_model_id = ?,
        attempts_json = ?, metadata_json = ?, summary = ?, error = ?, updated_at = ?,
        completed_at = ?, resume_count = ?, last_checkpoint_id = ?, task_type = ?
       WHERE id = ?`,
      merged.status,
      merged.phase,
      merged.plan ? JSON.stringify(merged.plan) : null,
      JSON.stringify(merged.completedSteps),
      JSON.stringify(merged.pendingSteps),
      JSON.stringify(merged.relevantFiles),
      JSON.stringify(merged.changedFiles),
      merged.currentProfileId,
      merged.currentModelId,
      JSON.stringify(merged.attempts),
      JSON.stringify(merged.metadata),
      merged.summary,
      merged.error,
      merged.updatedAt,
      merged.completedAt,
      merged.resumeCount,
      merged.lastCheckpointId,
      merged.taskType,
      id,
    );
    return this.getTask(id)!;
  }

  addAttempt(id: string, attempt: RouteAttemptFailure): TaskRecord {
    const task = this.getTask(id);
    if (!task) throw new Error(`Task not found: ${id}`);
    const attempts = [...task.attempts, attempt].slice(-100);
    return this.updateTask(id, { attempts });
  }

  listTasks(
    options: { projectPath?: string; limit?: number; statuses?: TaskStatus[] } = {},
  ): TaskRecord[] {
    const limit = options.limit ?? 50;
    if (options.projectPath && options.statuses?.length) {
      const placeholders = options.statuses.map(() => '?').join(',');
      return this.db
        .all<Row>(
          `SELECT * FROM tasks WHERE project_path = ? AND status IN (${placeholders})
           ORDER BY updated_at DESC LIMIT ?`,
          options.projectPath,
          ...options.statuses,
          limit,
        )
        .map(mapTask);
    }
    if (options.projectPath) {
      return this.db
        .all<Row>(
          'SELECT * FROM tasks WHERE project_path = ? ORDER BY updated_at DESC LIMIT ?',
          options.projectPath,
          limit,
        )
        .map(mapTask);
    }
    if (options.statuses?.length) {
      const placeholders = options.statuses.map(() => '?').join(',');
      return this.db
        .all<Row>(
          `SELECT * FROM tasks WHERE status IN (${placeholders}) ORDER BY updated_at DESC LIMIT ?`,
          ...options.statuses,
          limit,
        )
        .map(mapTask);
    }
    return this.db
      .all<Row>('SELECT * FROM tasks ORDER BY updated_at DESC LIMIT ?', limit)
      .map(mapTask);
  }

  latestResumableTask(projectPath: string): TaskRecord | null {
    const row = this.db.get<Row>(
      `SELECT * FROM tasks WHERE project_path = ? AND status IN ('paused','failed','running')
       ORDER BY updated_at DESC LIMIT 1`,
      projectPath,
    );
    return row ? mapTask(row) : null;
  }

  deleteTask(id: string): void {
    this.db.transaction(() => {
      this.db.run('DELETE FROM task_messages WHERE task_id = ?', id);
      this.db.run('DELETE FROM checkpoints WHERE task_id = ?', id);
      this.db.run('DELETE FROM usage_events WHERE task_id = ?', id);
      this.db.run('DELETE FROM routing_events WHERE task_id = ?', id);
      this.db.run('DELETE FROM tasks WHERE id = ?', id);
    });
  }

  /** Row counts per table plus the on-disk size of the database file. */
  storageStats(): { path: string; tables: Record<string, number>; dbBytes: number } {
    const tables = [
      'meta',
      'settings',
      'provider_profiles',
      'models',
      'tasks',
      'task_messages',
      'checkpoints',
      'usage_events',
      'provider_limits',
      'routing_events',
      'provider_health',
    ];
    const counts: Record<string, number> = {};
    for (const table of tables) {
      const row = this.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`);
      counts[table] = Number(row?.n ?? 0);
    }
    let dbBytes = 0;
    try {
      dbBytes = statSync(this.path).size;
    } catch {
      // Database file may not exist yet.
    }
    return { path: this.path, tables: counts, dbBytes };
  }

  /**
   * Delete completed/failed tasks older than `days` (with their messages,
   * checkpoints, and events) and vacuum the database. Paused/running tasks are
   * never touched.
   */
  cleanupCompletedOlderThan(days: number): { deletedTasks: number } {
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
    const rows = this.db.all<{ id: string }>(
      `SELECT id FROM tasks
       WHERE status IN ('completed', 'failed') AND updated_at < ?`,
      cutoff,
    );
    this.db.transaction(() => {
      for (const row of rows) this.deleteTask(row.id);
    });
    try {
      this.db.run('VACUUM');
    } catch {
      // VACUUM can fail inside a transaction on some SQLite builds; skip.
    }
    return { deletedTasks: rows.length };
  }

  appendMessage(taskId: string, message: AgentMessage): StoredMessage {
    const seqRow = this.db.get<{ seq: number }>(
      'SELECT COALESCE(MAX(seq), 0) AS seq FROM task_messages WHERE task_id = ?',
      taskId,
    );
    const seq = Number(seqRow?.seq ?? 0) + 1;
    const timestamp = nowIso();
    const toolCalls =
      message.role === 'assistant' && message.toolCalls?.length ? message.toolCalls : null;
    const toolCallId = message.role === 'tool' ? message.toolCallId : null;
    const name = message.role === 'tool' ? message.name : null;
    const isError = message.role === 'tool' && message.isError ? 1 : 0;
    const content = message.content ?? '';
    this.db.run(
      `INSERT INTO task_messages(
        task_id, seq, role, content, tool_calls_json, tool_call_id, name, is_error, token_estimate, created_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      taskId,
      seq,
      message.role,
      content,
      toolCalls ? JSON.stringify(toolCalls) : null,
      toolCallId,
      name,
      isError,
      Math.ceil(content.length / 4) +
        (toolCalls ? Math.ceil(JSON.stringify(toolCalls).length / 4) : 0),
      timestamp,
    );
    const row = this.db.get<Row>(
      'SELECT * FROM task_messages WHERE task_id = ? AND seq = ?',
      taskId,
      seq,
    );
    return mapMessage(row!);
  }

  loadMessages(taskId: string, limit = 500): AgentMessage[] {
    const rows = this.db.all<Row>(
      'SELECT * FROM task_messages WHERE task_id = ? ORDER BY seq ASC LIMIT ?',
      taskId,
      limit,
    );
    return rows.map((row) => {
      const message = mapMessage(row);
      if (message.role === 'assistant') {
        return {
          role: 'assistant' as const,
          content: message.content,
          ...(message.toolCalls?.length ? { toolCalls: message.toolCalls } : {}),
        };
      }
      if (message.role === 'tool') {
        return {
          role: 'tool' as const,
          toolCallId: message.toolCallId ?? '',
          name: message.name ?? 'tool',
          content: message.content,
          isError: message.isError,
        };
      }
      if (message.role === 'system') return { role: 'system' as const, content: message.content };
      return { role: 'user' as const, content: message.content };
    });
  }

  loadStoredMessages(taskId: string, limit = 500): StoredMessage[] {
    return this.db
      .all<Row>(
        'SELECT * FROM task_messages WHERE task_id = ? ORDER BY seq ASC LIMIT ?',
        taskId,
        limit,
      )
      .map(mapMessage);
  }

  /** Load messages newer than a compaction cutoff. */
  loadMessagesAfter(taskId: string, afterSeq: number, limit = 500): AgentMessage[] {
    const rows = this.db.all<Row>(
      'SELECT * FROM task_messages WHERE task_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?',
      taskId,
      afterSeq,
      limit,
    );
    return rows.map((row) => {
      const message = mapMessage(row);
      if (message.role === 'assistant') {
        return {
          role: 'assistant' as const,
          content: message.content,
          ...(message.toolCalls?.length ? { toolCalls: message.toolCalls } : {}),
        };
      }
      if (message.role === 'tool') {
        return {
          role: 'tool' as const,
          toolCallId: message.toolCallId ?? '',
          name: message.name ?? 'tool',
          content: message.content,
          isError: message.isError,
        };
      }
      if (message.role === 'system') return { role: 'system' as const, content: message.content };
      return { role: 'user' as const, content: message.content };
    });
  }

  messageTokenEstimate(taskId: string): number {
    const row = this.db.get<{ total: number }>(
      'SELECT COALESCE(SUM(token_estimate), 0) AS total FROM task_messages WHERE task_id = ?',
      taskId,
    );
    return Number(row?.total ?? 0);
  }

  // ------------------------------------------------------------- checkpoints
  createCheckpoint(taskId: string, state: CheckpointState): CheckpointRecord {
    const id = randomUUID();
    const timestamp = nowIso();
    const seqRow = this.db.get<{ seq: number }>(
      'SELECT COALESCE(MAX(seq), 0) AS seq FROM checkpoints WHERE task_id = ?',
      taskId,
    );
    const seq = Number(seqRow?.seq ?? 0) + 1;
    const stateJson = JSON.stringify({ ...state, savedAt: timestamp });
    this.db.transaction(() => {
      this.db.run(
        'INSERT INTO checkpoints(id, task_id, seq, state_json, created_at) VALUES(?, ?, ?, ?, ?)',
        id,
        taskId,
        seq,
        stateJson,
        timestamp,
      );
      this.db.run('UPDATE tasks SET last_checkpoint_id = ? WHERE id = ?', id, taskId);
      // Checkpoints embed message history and can grow quickly. Keep a bounded
      // window per task while always retaining the newest checkpoint.
      this.db.run(
        `DELETE FROM checkpoints WHERE task_id = ? AND seq <= ?`,
        taskId,
        Math.max(0, seq - 30),
      );
    });
    return {
      id,
      taskId,
      seq,
      state: { ...state, savedAt: timestamp },
      createdAt: timestamp,
    };
  }

  latestCheckpoint(taskId: string): CheckpointRecord | null {
    const row = this.db.get<Row>(
      'SELECT * FROM checkpoints WHERE task_id = ? ORDER BY seq DESC LIMIT 1',
      taskId,
    );
    if (!row) return null;
    return {
      id: str(row.id),
      taskId: str(row.task_id),
      seq: num(row.seq),
      state: safeJsonParse<CheckpointState>(str(row.state_json), {} as CheckpointState),
      createdAt: str(row.created_at),
    };
  }

  listCheckpoints(taskId: string, limit = 20): CheckpointRecord[] {
    return this.db
      .all<Row>(
        'SELECT * FROM checkpoints WHERE task_id = ? ORDER BY seq DESC LIMIT ?',
        taskId,
        limit,
      )
      .map((row) => ({
        id: str(row.id),
        taskId: str(row.task_id),
        seq: num(row.seq),
        state: safeJsonParse<CheckpointState>(str(row.state_json), {} as CheckpointState),
        createdAt: str(row.created_at),
      }));
  }

  // ------------------------------------------------------------------- usage
  recordUsage(input: {
    taskId?: string | null;
    profileId: string;
    providerId: string;
    modelId: string;
    inputTokens: number;
    outputTokens: number;
    costEstimate?: number | null;
    source?: string;
  }): void {
    this.db.run(
      `INSERT INTO usage_events(
        task_id, profile_id, provider_id, model_id, input_tokens, output_tokens,
        cost_estimate, source, created_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      input.taskId ?? null,
      input.profileId,
      input.providerId,
      input.modelId,
      input.inputTokens,
      input.outputTokens,
      input.costEstimate ?? null,
      input.source ?? 'agent',
      nowIso(),
    );
  }

  usageTotals(sinceIso?: string): {
    inputTokens: number;
    outputTokens: number;
    cost: number | null;
    events: number;
  } {
    const row = sinceIso
      ? this.db.get<Row>(
          `SELECT COALESCE(SUM(input_tokens),0) AS i, COALESCE(SUM(output_tokens),0) AS o,
             SUM(cost_estimate) AS c, COUNT(*) AS n FROM usage_events WHERE created_at >= ?`,
          sinceIso,
        )
      : this.db.get<Row>(
          `SELECT COALESCE(SUM(input_tokens),0) AS i, COALESCE(SUM(output_tokens),0) AS o,
             SUM(cost_estimate) AS c, COUNT(*) AS n FROM usage_events`,
        );
    return {
      inputTokens: num(row?.i),
      outputTokens: num(row?.o),
      cost: row?.c === null || row?.c === undefined ? null : Number(row.c),
      events: num(row?.n),
    };
  }

  usageByModel(sinceIso?: string): UsageAggregate[] {
    const rows = sinceIso
      ? this.db.all<Row>(
          `SELECT provider_id, model_id, profile_id, SUM(input_tokens) AS i,
             SUM(output_tokens) AS o, COUNT(*) AS n, SUM(cost_estimate) AS c
           FROM usage_events WHERE created_at >= ?
           GROUP BY provider_id, model_id, profile_id ORDER BY (SUM(input_tokens)+SUM(output_tokens)) DESC`,
          sinceIso,
        )
      : this.db.all<Row>(
          `SELECT provider_id, model_id, profile_id, SUM(input_tokens) AS i,
             SUM(output_tokens) AS o, COUNT(*) AS n, SUM(cost_estimate) AS c
           FROM usage_events
           GROUP BY provider_id, model_id, profile_id ORDER BY (SUM(input_tokens)+SUM(output_tokens)) DESC`,
        );
    return rows.map((row) => ({
      providerId: str(row.provider_id),
      modelId: str(row.model_id),
      profileId: str(row.profile_id),
      inputTokens: num(row.i),
      outputTokens: num(row.o),
      events: num(row.n),
      costEstimate: row.c === null || row.c === undefined ? null : Number(row.c),
    }));
  }

  // ------------------------------------------------------------------ limits
  saveLimit(input: {
    profileId: string;
    modelId?: string | null;
    category: ErrorCategory;
    message?: string | null;
    retryAfterAt?: string | null;
    resetAt?: string | null;
  }): void {
    const timestamp = nowIso();
    this.db.run(
      `INSERT INTO provider_limits(
        profile_id, model_id, category, message, retry_after_at, reset_at, attempts, updated_at
      ) VALUES(?, ?, ?, ?, ?, ?, 1, ?)
      ON CONFLICT(profile_id, model_id) DO UPDATE SET
        category = excluded.category, message = excluded.message,
        retry_after_at = excluded.retry_after_at, reset_at = excluded.reset_at,
        attempts = provider_limits.attempts + 1, updated_at = excluded.updated_at`,
      input.profileId,
      input.modelId ?? '*',
      input.category,
      input.message ?? null,
      input.retryAfterAt ?? null,
      input.resetAt ?? null,
      timestamp,
    );
  }

  clearLimit(profileId: string, modelId?: string | null): void {
    this.db.run(
      'DELETE FROM provider_limits WHERE profile_id = ? AND model_id = ?',
      profileId,
      modelId ?? '*',
    );
  }

  /**
   * Remove every stored limit for a profile, including model-scoped cooldowns.
   * A successful connection test or catalog refresh proves the credentials and
   * endpoint are reachable, so stale model limits must not quarantine the
   * profile on the next run.
   */
  clearLimitsForProfile(profileId: string): number {
    return this.db.run('DELETE FROM provider_limits WHERE profile_id = ?', profileId).changes;
  }

  clearExpiredLimits(nowMs = Date.now()): number {
    const rows = this.db.all<Row>('SELECT * FROM provider_limits');
    let removed = 0;
    for (const row of rows) {
      const limit = mapLimit(row, nowMs);
      if (!limit.active) {
        this.db.run(
          'DELETE FROM provider_limits WHERE profile_id = ? AND model_id = ?',
          limit.profileId,
          limit.modelId,
        );
        removed += 1;
      }
    }
    return removed;
  }

  listLimits(activeOnly = false): ProviderLimit[] {
    const limits = this.db
      .all<Row>('SELECT * FROM provider_limits ORDER BY updated_at DESC')
      .map((row) => mapLimit(row));
    return activeOnly ? limits.filter((limit) => limit.active) : limits;
  }

  getLimit(profileId: string, modelId?: string | null): ProviderLimit | null {
    const row = this.db.get<Row>(
      'SELECT * FROM provider_limits WHERE profile_id = ? AND model_id = ?',
      profileId,
      modelId ?? '*',
    );
    return row ? mapLimit(row) : null;
  }

  // ----------------------------------------------------------------- routing
  recordRoutingEvent(input: {
    taskId?: string | null;
    fromProfileId?: string | null;
    fromModelId?: string | null;
    toProfileId?: string | null;
    toModelId?: string | null;
    reason: string;
    category?: string | null;
  }): void {
    this.db.run(
      `INSERT INTO routing_events(
        task_id, from_profile_id, from_model_id, to_profile_id, to_model_id, reason, category, created_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
      input.taskId ?? null,
      input.fromProfileId ?? null,
      input.fromModelId ?? null,
      input.toProfileId ?? null,
      input.toModelId ?? null,
      input.reason,
      input.category ?? null,
      nowIso(),
    );
  }

  listRoutingEvents(limit = 50): RoutingEvent[] {
    return this.db
      .all<Row>('SELECT * FROM routing_events ORDER BY created_at DESC LIMIT ?', limit)
      .map((row) => ({
        id: num(row.id),
        taskId: nullableStr(row.task_id),
        fromProfileId: nullableStr(row.from_profile_id),
        fromModelId: nullableStr(row.from_model_id),
        toProfileId: nullableStr(row.to_profile_id),
        toModelId: nullableStr(row.to_model_id),
        reason: str(row.reason),
        category: nullableStr(row.category),
        createdAt: str(row.created_at),
      }));
  }

  // ------------------------------------------------------------------ health
  recordHealth(input: {
    profileId: string;
    ok: boolean;
    latencyMs?: number | null;
    category?: string | null;
    message?: string | null;
  }): void {
    this.db.run(
      'INSERT INTO provider_health(profile_id, ok, latency_ms, category, message, created_at) VALUES(?, ?, ?, ?, ?, ?)',
      input.profileId,
      input.ok ? 1 : 0,
      input.latencyMs ?? null,
      input.category ?? null,
      input.message ?? null,
      nowIso(),
    );
  }

  listHealth(profileId: string, limit = 10): ProviderHealthRecord[] {
    return this.db
      .all<Row>(
        'SELECT * FROM provider_health WHERE profile_id = ? ORDER BY created_at DESC LIMIT ?',
        profileId,
        limit,
      )
      .map((row) => ({
        id: num(row.id),
        profileId: str(row.profile_id),
        ok: bool(row.ok),
        latencyMs: nullableNum(row.latency_ms),
        category: nullableStr(row.category),
        message: nullableStr(row.message),
        createdAt: str(row.created_at),
      }));
  }

  // --------------------------------------------------------------- summaries
  buildResumeSummary(taskId: string, projectState: string): ResumeSummary | null {
    const task = this.getTask(taskId);
    if (!task) return null;
    const stored = this.loadStoredMessages(taskId, 200);
    const recentTools = stored
      .filter((message) => message.role === 'tool')
      .slice(-6)
      .map((message) => `${message.name}: ${message.content.slice(0, 400)}`);
    return {
      taskId: task.id,
      userRequest: task.userRequest,
      phase: task.phase,
      completedSteps: task.completedSteps,
      pendingSteps: task.pendingSteps,
      changedFiles: task.changedFiles,
      recentTools,
      projectState,
      currentModel: task.currentModelId,
    };
  }

  // ----------------------------------------------------------------- general
  stats(): {
    profiles: number;
    models: number;
    tasks: number;
    pausedTasks: number;
    databasePath: string;
    databaseBytes: number;
  } {
    const count = (table: string): number => {
      const row = this.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`);
      return num(row?.n);
    };
    let bytes = 0;
    try {
      bytes = statSync(this.path).size;
    } catch {
      bytes = 0;
    }
    return {
      profiles: count('provider_profiles'),
      models: count('models'),
      tasks: count('tasks'),
      pausedTasks: count("tasks WHERE status = 'paused'"),
      databasePath: this.path,
      databaseBytes: bytes,
    };
  }

  deleteAllData(): void {
    this.db.transaction(() => {
      this.db.run('DELETE FROM usage_events');
      this.db.run('DELETE FROM routing_events');
      this.db.run('DELETE FROM provider_health');
      this.db.run('DELETE FROM provider_limits');
      this.db.run('DELETE FROM checkpoints');
      this.db.run('DELETE FROM task_messages');
      this.db.run('DELETE FROM tasks');
      this.db.run('DELETE FROM models');
      this.db.run('DELETE FROM provider_profiles');
      this.db.run('DELETE FROM settings');
      this.db.run(
        "DELETE FROM meta WHERE key IN ('ui.selected_profile_id','ui.selected_model_id','ui.selected_model_at')",
      );
    });
  }
}

export function openStore(path: string): Store {
  return new Store(path);
}

export { TASK_PHASES };
