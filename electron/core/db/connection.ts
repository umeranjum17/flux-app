import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import fs from 'fs';
import { app } from 'electron';

let db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (db) return db;

  const homeDir = app?.getPath('home') ?? process.env.HOME ?? process.env.USERPROFILE ?? '';
  const fluxDir = path.join(homeDir, '.flux');

  if (!fs.existsSync(fluxDir)) {
    fs.mkdirSync(fluxDir, { recursive: true });
  }

  const dbPath = path.join(fluxDir, 'flux.db');
  db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL');

  return db;
}
