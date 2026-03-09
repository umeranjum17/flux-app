import { getDb } from './connection';
import {
  CREATE_SESSIONS_TABLE,
  CREATE_MESSAGES_TABLE,
  CREATE_CONFIG_TABLE,
  CREATE_USAGE_METRICS_TABLE,
  CREATE_USAGE_WINDOW_SNAPSHOTS_TABLE,
  CREATE_WORKSPACES_TABLE,
  CREATE_CHECKPOINTS_TABLE,
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
