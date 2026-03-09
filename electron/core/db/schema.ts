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
)`;

export const CREATE_WORKSPACES_TABLE = `
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  parent_repo TEXT NOT NULL,
  worktree_path TEXT NOT NULL,
  branch TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  model TEXT NOT NULL,
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

export const CREATE_MIGRATIONS_TABLE = `
CREATE TABLE IF NOT EXISTS migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE,
  applied_at INTEGER
)`;
