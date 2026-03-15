import crypto from 'crypto';
import { getDb } from '../db/connection';

export interface ProjectGroup {
  id: string;
  name: string;
  projects: string[];
  createdAt: number;
  updatedAt: number;
}

export class ProjectGroupStore {
  create(name: string, projects: string[] = []): ProjectGroup {
    const db = getDb();
    const id = crypto.randomUUID();
    const now = Date.now();

    db.prepare(
      'INSERT INTO project_groups (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)',
    ).run(id, name, now, now);

    for (let i = 0; i < projects.length; i++) {
      db.prepare(
        'INSERT INTO project_group_items (group_id, project_path, position) VALUES (?, ?, ?)',
      ).run(id, projects[i], i);
    }

    return { id, name, projects, createdAt: now, updatedAt: now };
  }

  get(id: string): ProjectGroup | null {
    const db = getDb();
    const row = db.prepare('SELECT * FROM project_groups WHERE id = ?').get(id) as any;
    if (!row) return null;
    return this.hydrateGroup(row);
  }

  list(): ProjectGroup[] {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM project_groups ORDER BY updated_at DESC').all() as any[];
    return rows.map((row) => this.hydrateGroup(row));
  }

  addProject(groupId: string, projectPath: string): ProjectGroup | null {
    const db = getDb();
    const group = this.get(groupId);
    if (!group) return null;

    const maxPos = (
      db.prepare('SELECT MAX(position) as p FROM project_group_items WHERE group_id = ?').get(groupId) as any
    )?.p ?? -1;

    db.prepare(
      'INSERT OR IGNORE INTO project_group_items (group_id, project_path, position) VALUES (?, ?, ?)',
    ).run(groupId, projectPath, maxPos + 1);

    db.prepare('UPDATE project_groups SET updated_at = ? WHERE id = ?').run(Date.now(), groupId);

    return this.get(groupId);
  }

  removeProject(groupId: string, projectPath: string): ProjectGroup | null {
    const db = getDb();
    const group = this.get(groupId);
    if (!group) return null;

    db.prepare(
      'DELETE FROM project_group_items WHERE group_id = ? AND project_path = ?',
    ).run(groupId, projectPath);

    db.prepare('UPDATE project_groups SET updated_at = ? WHERE id = ?').run(Date.now(), groupId);

    return this.get(groupId);
  }

  rename(groupId: string, name: string): ProjectGroup | null {
    const db = getDb();
    db.prepare('UPDATE project_groups SET name = ?, updated_at = ? WHERE id = ?').run(
      name,
      Date.now(),
      groupId,
    );
    return this.get(groupId);
  }

  delete(groupId: string): void {
    const db = getDb();
    db.prepare('DELETE FROM project_group_items WHERE group_id = ?').run(groupId);
    db.prepare('DELETE FROM project_groups WHERE id = ?').run(groupId);
  }

  private hydrateGroup(row: any): ProjectGroup {
    const db = getDb();
    const items = db
      .prepare('SELECT project_path FROM project_group_items WHERE group_id = ? ORDER BY position ASC')
      .all(row.id) as any[];

    return {
      id: row.id,
      name: row.name,
      projects: items.map((item) => item.project_path),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
