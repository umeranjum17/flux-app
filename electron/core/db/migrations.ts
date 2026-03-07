import { getDb } from './connection';
import {
  CREATE_SESSIONS_TABLE,
  CREATE_MESSAGES_TABLE,
  CREATE_CONFIG_TABLE,
  CREATE_USAGE_METRICS_TABLE,
  CREATE_MIGRATIONS_TABLE,
} from './schema';

const MIGRATIONS: Array<{ name: string; sql: string }> = [
  { name: '001_create_sessions', sql: CREATE_SESSIONS_TABLE },
  { name: '002_create_messages', sql: CREATE_MESSAGES_TABLE },
  { name: '003_create_config', sql: CREATE_CONFIG_TABLE },
  { name: '004_create_usage_metrics', sql: CREATE_USAGE_METRICS_TABLE },
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

    db.exec(migration.sql);
    db.prepare('INSERT INTO migrations (name, applied_at) VALUES (?, ?)').run(
      migration.name,
      Date.now()
    );
  }
}
