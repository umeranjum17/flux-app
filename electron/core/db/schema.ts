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

export const CREATE_MIGRATIONS_TABLE = `
CREATE TABLE IF NOT EXISTS migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE,
  applied_at INTEGER
)`;
