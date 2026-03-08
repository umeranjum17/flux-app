import fs from 'fs';
import { getDb } from '../db/connection';
import type { Workspace, WorkspaceStatus } from './types';

interface CreateWorkspaceInput {
  id: string;
  name: string;
  parentRepo: string;
  worktreePath: string;
  branch: string;
  agentId: string;
  model: string;
  status?: WorkspaceStatus;
  sessionId?: string;
}

export class WorkspaceStore {
  list(parentRepo?: string): Workspace[] {
    const db = getDb();
    const rows = parentRepo
      ? db
          .prepare('SELECT * FROM workspaces WHERE parent_repo = ? ORDER BY updated_at DESC')
          .all(parentRepo)
      : db.prepare('SELECT * FROM workspaces ORDER BY updated_at DESC').all();

    return (rows as any[])
      .map(rowToWorkspace)
      .filter((workspace) => fs.existsSync(workspace.worktreePath));
  }

  get(id: string): Workspace | null {
    const db = getDb();
    const row = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id) as any;
    if (!row) return null;

    const workspace = rowToWorkspace(row);
    return fs.existsSync(workspace.worktreePath) ? workspace : null;
  }

  create(input: CreateWorkspaceInput): Workspace {
    const db = getDb();
    const now = Date.now();
    const workspace: Workspace = {
      id: input.id,
      name: input.name,
      parentRepo: input.parentRepo,
      worktreePath: input.worktreePath,
      branch: input.branch,
      agentId: input.agentId as any,
      model: input.model,
      status: input.status ?? 'idle',
      createdAt: now,
      updatedAt: now,
      sessionId: input.sessionId,
    };

    db.prepare(
      `INSERT INTO workspaces (
        id, name, parent_repo, worktree_path, branch, agent_id, model, status, created_at, updated_at, session_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      workspace.id,
      workspace.name,
      workspace.parentRepo,
      workspace.worktreePath,
      workspace.branch,
      workspace.agentId,
      workspace.model,
      workspace.status,
      workspace.createdAt,
      workspace.updatedAt,
      workspace.sessionId ?? null,
    );

    return workspace;
  }

  update(id: string, updates: Partial<Workspace>): Workspace | null {
    const current = this.get(id);
    if (!current) return null;

    const db = getDb();
    const next: Workspace = {
      ...current,
      ...updates,
      updatedAt: Date.now(),
    };

    db.prepare(
      `UPDATE workspaces
       SET name = ?, parent_repo = ?, worktree_path = ?, branch = ?, agent_id = ?, model = ?, status = ?, updated_at = ?, session_id = ?
       WHERE id = ?`,
    ).run(
      next.name,
      next.parentRepo,
      next.worktreePath,
      next.branch,
      next.agentId,
      next.model,
      next.status,
      next.updatedAt,
      next.sessionId ?? null,
      id,
    );

    return next;
  }

  delete(id: string): void {
    const db = getDb();
    db.prepare('DELETE FROM checkpoints WHERE workspace_id = ?').run(id);
    db.prepare('DELETE FROM workspaces WHERE id = ?').run(id);
  }
}

function rowToWorkspace(row: any): Workspace {
  return {
    id: row.id,
    name: row.name,
    parentRepo: row.parent_repo,
    worktreePath: row.worktree_path,
    branch: row.branch,
    agentId: row.agent_id,
    model: row.model,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sessionId: row.session_id ?? undefined,
  };
}
