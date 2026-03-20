export const CREATE_SESSIONS_TABLE = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  title TEXT,
  agent_id TEXT,
  model TEXT,
  mode TEXT,
  cwd TEXT,
  created_at INTEGER,
  updated_at INTEGER,
  metadata TEXT
)`;

export const CREATE_MESSAGES_TABLE = `
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT REFERENCES sessions(id),
  role TEXT,
  type TEXT,
  content TEXT,
  tool_name TEXT,
  tool_input TEXT,
  tool_call_id TEXT,
  cost_usd REAL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  timestamp INTEGER
)`;

export const CREATE_CONFIG_TABLE = `
CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT
)`;

export const CREATE_USAGE_METRICS_TABLE = `
CREATE TABLE IF NOT EXISTS usage_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT,
  date TEXT,
  cost_usd REAL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  requests INTEGER
)`;

export const CREATE_USAGE_WINDOW_SNAPSHOTS_TABLE = `
CREATE TABLE IF NOT EXISTS usage_window_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id TEXT NOT NULL,
  window_key TEXT NOT NULL,
  sampled_at INTEGER NOT NULL,
  used_percent REAL NOT NULL,
  resets_at INTEGER,
  used_value REAL,
  limit_value REAL,
  remaining_value REAL,
  unit TEXT,
  source TEXT NOT NULL
 );
CREATE INDEX IF NOT EXISTS idx_usage_window_snapshots_lookup
  ON usage_window_snapshots(provider_id, window_key, sampled_at)`;

export const CREATE_WORKSPACES_TABLE = `
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  parent_repo TEXT NOT NULL,
  worktree_path TEXT NOT NULL,
  branch TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  model TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'act',
  plan_agent_id TEXT,
  plan_model TEXT,
  plan_thinking TEXT,
  act_agent_id TEXT,
  act_model TEXT,
  act_thinking TEXT,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  session_id TEXT
)`;

export const CREATE_CHECKPOINTS_TABLE = `
CREATE TABLE IF NOT EXISTS checkpoints (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  session_id TEXT NOT NULL REFERENCES sessions(id),
  message_index INTEGER NOT NULL,
  git_commit_sha TEXT NOT NULL,
  parent_sha TEXT NOT NULL,
  description TEXT NOT NULL,
  files_changed INTEGER NOT NULL,
  additions INTEGER NOT NULL,
  deletions INTEGER NOT NULL,
  created_at INTEGER NOT NULL
)`;

export const CREATE_WORKSPACE_SESSIONS_TABLE = `
CREATE TABLE IF NOT EXISTS workspace_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  task_id TEXT,
  label TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ws_sessions_workspace ON workspace_sessions(workspace_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ws_sessions_pair ON workspace_sessions(workspace_id, session_id)`;

export const CREATE_PROJECT_GROUPS_TABLE = `
CREATE TABLE IF NOT EXISTS project_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)`;

export const CREATE_PROJECT_GROUP_ITEMS_TABLE = `
CREATE TABLE IF NOT EXISTS project_group_items (
  group_id TEXT NOT NULL REFERENCES project_groups(id) ON DELETE CASCADE,
  project_path TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (group_id, project_path)
)`;

export const CREATE_WORKSPACE_GROUPS_TABLE = `
CREATE TABLE IF NOT EXISTS workspace_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  project_group_id TEXT,
  created_at INTEGER NOT NULL
)`;

export const CREATE_WORKSPACE_GROUP_MEMBERS_TABLE = `
CREATE TABLE IF NOT EXISTS workspace_group_members (
  group_id TEXT NOT NULL REFERENCES workspace_groups(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('primary', 'sibling')),
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (group_id, workspace_id)
);
CREATE INDEX IF NOT EXISTS idx_workspace_group_members_workspace
  ON workspace_group_members(workspace_id)`;

export const CREATE_REMOTE_CLIENTS_TABLE = `
CREATE TABLE IF NOT EXISTS remote_clients (
  id TEXT PRIMARY KEY,
  client_name TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  token_preview TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_seen_at INTEGER,
  revoked_at INTEGER,
  last_address TEXT
);
CREATE INDEX IF NOT EXISTS idx_remote_clients_revoked ON remote_clients(revoked_at)`;

export const CREATE_REMOTE_PAIRING_SESSIONS_TABLE = `
CREATE TABLE IF NOT EXISTS remote_pairing_sessions (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_remote_pairing_expires ON remote_pairing_sessions(expires_at, consumed_at)`;

export const RENAME_REMOTE_AUTH_COLUMNS = `
ALTER TABLE remote_clients RENAME COLUMN token_hash TO token;
ALTER TABLE remote_pairing_sessions RENAME COLUMN code_hash TO code`;

export const CREATE_MIGRATIONS_TABLE = `
CREATE TABLE IF NOT EXISTS migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE,
  applied_at INTEGER
)`;
