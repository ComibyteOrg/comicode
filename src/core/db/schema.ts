export const SCHEMA_VERSION = 1;

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS provider_profiles (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  auth_type TEXT NOT NULL,
  default_model TEXT,
  api_key_env TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  access_classification TEXT NOT NULL DEFAULT 'unknown',
  config_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_success_at TEXT,
  last_error TEXT,
  last_error_at TEXT,
  last_checked_at TEXT,
  models_refreshed_at TEXT,
  UNIQUE(provider_id, name)
);

CREATE TABLE IF NOT EXISTS models (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  profile_id TEXT NOT NULL DEFAULT '',
  model_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  context_window INTEGER,
  max_output_tokens INTEGER,
  supports_tools INTEGER NOT NULL DEFAULT 0,
  supports_streaming INTEGER NOT NULL DEFAULT 1,
  supports_vision INTEGER NOT NULL DEFAULT 0,
  coding_suitability INTEGER NOT NULL DEFAULT 2,
  reasoning_suitability INTEGER NOT NULL DEFAULT 2,
  input_price_per_million REAL,
  output_price_per_million REAL,
  access TEXT NOT NULL DEFAULT 'unknown',
  access_source TEXT NOT NULL DEFAULT 'catalog',
  access_notes TEXT,
  available INTEGER NOT NULL DEFAULT 1,
  last_checked_at TEXT,
  user_classification TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  UNIQUE(provider_id, profile_id, model_id)
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  project_path TEXT NOT NULL,
  project_name TEXT NOT NULL,
  user_request TEXT NOT NULL,
  task_type TEXT NOT NULL DEFAULT 'coding',
  status TEXT NOT NULL,
  phase TEXT NOT NULL,
  plan_json TEXT,
  completed_steps_json TEXT NOT NULL DEFAULT '[]',
  pending_steps_json TEXT NOT NULL DEFAULT '[]',
  relevant_files_json TEXT NOT NULL DEFAULT '[]',
  changed_files_json TEXT NOT NULL DEFAULT '[]',
  current_profile_id TEXT,
  current_model_id TEXT,
  attempts_json TEXT NOT NULL DEFAULT '[]',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  summary TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  resume_count INTEGER NOT NULL DEFAULT 0,
  last_checkpoint_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_tasks_project_updated ON tasks(project_path, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);

CREATE TABLE IF NOT EXISTS task_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  tool_calls_json TEXT,
  tool_call_id TEXT,
  name TEXT,
  is_error INTEGER NOT NULL DEFAULT 0,
  token_estimate INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_messages_task_seq ON task_messages(task_id, seq);

CREATE TABLE IF NOT EXISTS checkpoints (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  state_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_checkpoints_task_seq ON checkpoints(task_id, seq DESC);

CREATE TABLE IF NOT EXISTS usage_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT,
  profile_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_estimate REAL,
  source TEXT NOT NULL DEFAULT 'agent',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_usage_created ON usage_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_profile ON usage_events(profile_id);

CREATE TABLE IF NOT EXISTS provider_limits (
  profile_id TEXT NOT NULL,
  model_id TEXT NOT NULL DEFAULT '*',
  category TEXT NOT NULL,
  message TEXT,
  retry_after_at TEXT,
  reset_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(profile_id, model_id)
);

CREATE TABLE IF NOT EXISTS routing_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT,
  from_profile_id TEXT,
  from_model_id TEXT,
  to_profile_id TEXT,
  to_model_id TEXT,
  reason TEXT NOT NULL,
  category TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_routing_task ON routing_events(task_id, created_at DESC);

CREATE TABLE IF NOT EXISTS provider_health (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id TEXT NOT NULL,
  ok INTEGER NOT NULL,
  latency_ms INTEGER,
  category TEXT,
  message TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_health_profile ON provider_health(profile_id, created_at DESC);
`;
