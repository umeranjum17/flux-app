import { getDb } from './connection';
import {
  CREATE_SESSIONS_TABLE,
  CREATE_MESSAGES_TABLE,
  CREATE_CONFIG_TABLE,
  CREATE_USAGE_METRICS_TABLE,
  CREATE_USAGE_WINDOW_SNAPSHOTS_TABLE,
  CREATE_WORKSPACES_TABLE,
  CREATE_CHECKPOINTS_TABLE,
  CREATE_WORKSPACE_SESSIONS_TABLE,
  CREATE_PROJECT_GROUPS_TABLE,
  CREATE_PROJECT_GROUP_ITEMS_TABLE,
  CREATE_WORKSPACE_GROUPS_TABLE,
  CREATE_WORKSPACE_GROUP_MEMBERS_TABLE,
  CREATE_REMOTE_CLIENTS_TABLE,
  CREATE_REMOTE_PAIRING_SESSIONS_TABLE,
  RENAME_REMOTE_AUTH_COLUMNS,
  CREATE_MIGRATIONS_TABLE,
} from './schema';

const MIGRATIONS: Array<{ name: string; sql: string }> = [
  { name: '001_create_sessions', sql: CREATE_SESSIONS_TABLE },
  { name: '002_create_messages', sql: CREATE_MESSAGES_TABLE },
  { name: '003_create_config', sql: CREATE_CONFIG_TABLE },
  { name: '004_create_usage_metrics', sql: CREATE_USAGE_METRICS_TABLE },
  { name: '005_add_message_payload_json', sql: 'ALTER TABLE messages ADD COLUMN payload_json TEXT' },
  { name: '006_create_workspaces', sql: CREATE_WORKSPACES_TABLE },
  { name: '007_create_checkpoints', sql: CREATE_CHECKPOINTS_TABLE },
  { name: '008_create_usage_window_snapshots', sql: CREATE_USAGE_WINDOW_SNAPSHOTS_TABLE },
  { name: '009_create_workspace_sessions', sql: CREATE_WORKSPACE_SESSIONS_TABLE },
  {
    name: '009_backfill_workspace_sessions',
    sql: `INSERT OR IGNORE INTO workspace_sessions (workspace_id, session_id, position, created_at)
SELECT id, session_id, 0, created_at FROM workspaces WHERE session_id IS NOT NULL`,
  },
  {
    name: '010_add_workspace_archived_at',
    sql: 'ALTER TABLE workspaces ADD COLUMN archived_at INTEGER',
  },
  {
    name: '011_add_workspace_outcome',
    sql: "ALTER TABLE workspaces ADD COLUMN outcome TEXT NOT NULL DEFAULT 'in_progress'",
  },
  {
    name: '012_create_usage_snapshot_lookup_index',
    sql: 'CREATE INDEX IF NOT EXISTS idx_usage_window_snapshots_lookup ON usage_window_snapshots(provider_id, window_key, sampled_at)',
  },
  {
    name: '013_create_project_groups',
    sql: CREATE_PROJECT_GROUPS_TABLE,
  },
  {
    name: '014_create_project_group_items',
    sql: CREATE_PROJECT_GROUP_ITEMS_TABLE,
  },
  {
    name: '015_add_workspace_mode',
    sql: "ALTER TABLE workspaces ADD COLUMN mode TEXT NOT NULL DEFAULT 'act'",
  },
  {
    name: '016_add_workspace_base_branch',
    sql: 'ALTER TABLE workspaces ADD COLUMN base_branch TEXT',
  },
  {
    name: '017_add_workspace_thinking',
    sql: 'ALTER TABLE workspaces ADD COLUMN thinking TEXT',
  },
  {
    name: '018_add_workspace_mode_selections',
    sql: `
      ALTER TABLE workspaces ADD COLUMN plan_agent_id TEXT;
      ALTER TABLE workspaces ADD COLUMN plan_model TEXT;
      ALTER TABLE workspaces ADD COLUMN plan_thinking TEXT;
      ALTER TABLE workspaces ADD COLUMN act_agent_id TEXT;
      ALTER TABLE workspaces ADD COLUMN act_model TEXT;
      ALTER TABLE workspaces ADD COLUMN act_thinking TEXT;
    `,
  },
  {
    name: '019_create_remote_clients',
    sql: CREATE_REMOTE_CLIENTS_TABLE,
  },
  {
    name: '020_create_remote_pairing_sessions',
    sql: CREATE_REMOTE_PAIRING_SESSIONS_TABLE,
  },
  {
    name: '021_create_workspace_groups',
    sql: CREATE_WORKSPACE_GROUPS_TABLE,
  },
  {
    name: '022_create_workspace_group_members',
    sql: CREATE_WORKSPACE_GROUP_MEMBERS_TABLE,
  },
  {
    name: '023_rename_remote_auth_columns',
    sql: RENAME_REMOTE_AUTH_COLUMNS,
  },
  {
    name: '024_add_workspace_direct',
    sql: 'ALTER TABLE workspaces ADD COLUMN direct INTEGER NOT NULL DEFAULT 0',
  },
  {
    name: '025_add_workspace_ssh_host',
    sql: 'ALTER TABLE workspaces ADD COLUMN ssh_host TEXT',
  },
];

export function runMigrations(): void {
  const db = getDb();

  // Ensure migrations tracking table exists
  db.exec(CREATE_MIGRATIONS_TABLE);

  const applied = new Set(
    db
      .prepare('SELECT name FROM migrations')
      .all()
      .map((row: any) => row.name)
  );

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.name)) continue;

    if (migration.name === '005_add_message_payload_json' && hasColumn(db, 'messages', 'payload_json')) {
      db.prepare('INSERT INTO migrations (name, applied_at) VALUES (?, ?)').run(
        migration.name,
        Date.now()
      );
      continue;
    }

    if (migration.name === '010_add_workspace_archived_at' && hasColumn(db, 'workspaces', 'archived_at')) {
      db.prepare('INSERT INTO migrations (name, applied_at) VALUES (?, ?)').run(
        migration.name,
        Date.now()
      );
      continue;
    }

    if (migration.name === '011_add_workspace_outcome' && hasColumn(db, 'workspaces', 'outcome')) {
      db.prepare('INSERT INTO migrations (name, applied_at) VALUES (?, ?)').run(
        migration.name,
        Date.now()
      );
      continue;
    }

    if (migration.name === '015_add_workspace_mode' && hasColumn(db, 'workspaces', 'mode')) {
      db.prepare('INSERT INTO migrations (name, applied_at) VALUES (?, ?)').run(
        migration.name,
        Date.now()
      );
      continue;
    }

    if (migration.name === '018_add_workspace_mode_selections' && hasColumn(db, 'workspaces', 'plan_agent_id')) {
      db.prepare('INSERT INTO migrations (name, applied_at) VALUES (?, ?)').run(
        migration.name,
        Date.now()
      );
      continue;
    }

    if (migration.name === '024_add_workspace_direct' && hasColumn(db, 'workspaces', 'direct')) {
      db.prepare('INSERT INTO migrations (name, applied_at) VALUES (?, ?)').run(
        migration.name,
        Date.now()
      );
      continue;
    }

    if (migration.name === '025_add_workspace_ssh_host' && hasColumn(db, 'workspaces', 'ssh_host')) {
      db.prepare('INSERT INTO migrations (name, applied_at) VALUES (?, ?)').run(
        migration.name,
        Date.now()
      );
      continue;
    }

    // Skip column rename if already using new schema (fresh install)
    if (migration.name === '023_rename_remote_auth_columns' && hasColumn(db, 'remote_clients', 'token')) {
      db.prepare('INSERT INTO migrations (name, applied_at) VALUES (?, ?)').run(
        migration.name,
        Date.now()
      );
      continue;
    }

    db.exec(migration.sql);
    db.prepare('INSERT INTO migrations (name, applied_at) VALUES (?, ?)').run(
      migration.name,
      Date.now()
    );
  }
}

function hasColumn(db: ReturnType<typeof getDb>, table: string, column: string): boolean {
  return db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .some((row: any) => row.name === column);
}
