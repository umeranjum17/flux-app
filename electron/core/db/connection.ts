import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { app } from 'electron';

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  const homeDir = app?.getPath('home') ?? process.env.HOME ?? process.env.USERPROFILE ?? '';
  const fluxDir = path.join(homeDir, '.flux');

  if (!fs.existsSync(fluxDir)) {
    fs.mkdirSync(fluxDir, { recursive: true });
  }

  const dbPath = path.join(fluxDir, 'flux.db');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  return db;
}
