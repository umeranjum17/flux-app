import fs from 'fs';
import { getDb } from '../db/connection';
import type { Workspace, WorkspaceOutcome, WorkspaceSession, WorkspaceStatus } from './types';
import type { TaskMode, ThinkingLevel } from '../agents/types';
import { WorkspaceGroupStore } from '../workspace-group/store';

interface CreateWorkspaceInput {
  id: string;
  name: string;
  parentRepo: string;
  worktreePath: string;
  branch: string;
  baseBranch?: string;
  agentId: string;
  model: string;
  mode?: TaskMode;
  thinking?: ThinkingLevel;
  planAgentId?: string;
  planModel?: string;
  planThinking?: ThinkingLevel;
  actAgentId?: string;
  actModel?: string;
  actThinking?: ThinkingLevel;
  sshHost?: string;
  status?: WorkspaceStatus;
  outcome?: WorkspaceOutcome;
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
      // Remote worktree paths don't exist locally — skip fs check for SSH workspaces
      .filter((workspace) => workspace.sshHost || fs.existsSync(workspace.worktreePath));
  }

  get(id: string): Workspace | null {
    const row = getWorkspaceRow(id);
    if (!row) return null;

    const workspace = rowToWorkspace(row);
    // Remote worktree paths don't exist locally — skip fs check for SSH workspaces
    return (workspace.sshHost || fs.existsSync(workspace.worktreePath)) ? workspace : null;
  }

  getIncludingMissing(id: string): Workspace | null {
    const row = getWorkspaceRow(id);
    if (!row) return null;
    return rowToWorkspace(row);
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
      baseBranch: input.baseBranch,
      agentId: input.agentId as any,
      model: input.model,
      mode: input.mode ?? 'act',
      thinking: input.thinking,
      planAgentId: (input.planAgentId ?? input.agentId) as any,
      planModel: input.planModel ?? input.model,
      planThinking: input.planThinking ?? input.thinking,
      actAgentId: (input.actAgentId ?? input.agentId) as any,
      actModel: input.actModel ?? input.model,
      actThinking: input.actThinking ?? input.thinking,
      sshHost: input.sshHost,
      status: input.status ?? 'idle',
      outcome: input.outcome ?? 'in_progress',
      createdAt: now,
      updatedAt: now,
      sessionId: input.sessionId,
    };

    db.prepare(
      `INSERT INTO workspaces (
        id, name, parent_repo, worktree_path, branch, base_branch, agent_id, model, mode, thinking,
        plan_agent_id, plan_model, plan_thinking, act_agent_id, act_model, act_thinking,
        ssh_host, status, outcome, created_at, updated_at, session_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      workspace.id,
      workspace.name,
      workspace.parentRepo,
      workspace.worktreePath,
      workspace.branch,
      workspace.baseBranch ?? null,
      workspace.agentId,
      workspace.model,
      workspace.mode,
      workspace.thinking ?? null,
      workspace.planAgentId ?? null,
      workspace.planModel ?? null,
      workspace.planThinking ?? null,
      workspace.actAgentId ?? null,
      workspace.actModel ?? null,
      workspace.actThinking ?? null,
      workspace.sshHost ?? null,
      workspace.status,
      workspace.outcome,
      workspace.createdAt,
      workspace.updatedAt,
      workspace.sessionId ?? null,
    );

    return workspace;
  }

  update(id: string, updates: Partial<Workspace>): Workspace | null {
    const row = getWorkspaceRow(id);
    if (!row) return null;

    const current = rowToWorkspace(row);

    const db = getDb();
    const next: Workspace = {
      ...current,
      ...updates,
      updatedAt: Date.now(),
    };

    db.prepare(
      `UPDATE workspaces
       SET name = ?, parent_repo = ?, worktree_path = ?, branch = ?, base_branch = ?, agent_id = ?, model = ?, mode = ?, thinking = ?,
           plan_agent_id = ?, plan_model = ?, plan_thinking = ?, act_agent_id = ?, act_model = ?, act_thinking = ?,
           ssh_host = ?, status = ?, outcome = ?, updated_at = ?, session_id = ?
       WHERE id = ?`,
    ).run(
      next.name,
      next.parentRepo,
      next.worktreePath,
      next.branch,
      next.baseBranch ?? null,
      next.agentId,
      next.model,
      next.mode,
      next.thinking ?? null,
      next.planAgentId ?? null,
      next.planModel ?? null,
      next.planThinking ?? null,
      next.actAgentId ?? null,
      next.actModel ?? null,
      next.actThinking ?? null,
      next.sshHost ?? null,
      next.status,
      next.outcome,
      next.updatedAt,
      next.sessionId ?? null,
      id,
    );

    return next;
  }

  delete(id: string): void {
    const db = getDb();
    const workspaceGroupStore = new WorkspaceGroupStore();
    db.exec('BEGIN');
    try {
      workspaceGroupStore.cleanupWorkspaceMembership(id);
      db.prepare('DELETE FROM workspace_sessions WHERE workspace_id = ?').run(id);
      db.prepare('DELETE FROM checkpoints WHERE workspace_id = ?').run(id);
      db.prepare('DELETE FROM workspaces WHERE id = ?').run(id);
      db.exec('COMMIT');
    } catch (error) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // best effort rollback
      }
      throw error;
    }
  }

  addSession(workspaceId: string, sessionId: string, taskId?: string, label?: string): void {
    const db = getDb();
    const maxPos = (db.prepare('SELECT MAX(position) as p FROM workspace_sessions WHERE workspace_id = ?').get(workspaceId) as any)?.p ?? -1;
    db.prepare(
      `INSERT OR IGNORE INTO workspace_sessions (workspace_id, session_id, task_id, label, position, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(workspaceId, sessionId, taskId ?? null, label ?? null, maxPos + 1, Date.now());
    // Update task_id if row already existed (session_id+workspace_id unique)
    if (taskId) {
      db.prepare('UPDATE workspace_sessions SET task_id = ? WHERE workspace_id = ? AND session_id = ?').run(taskId, workspaceId, sessionId);
    }
  }

  listSessions(workspaceId: string): WorkspaceSession[] {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM workspace_sessions WHERE workspace_id = ? ORDER BY position ASC').all(workspaceId) as any[];
    return rows.map((row) => ({
      id: row.id,
      workspaceId: row.workspace_id,
      sessionId: row.session_id,
      taskId: row.task_id ?? undefined,
      label: row.label ?? undefined,
      position: row.position,
      createdAt: row.created_at,
    }));
  }

  removeSession(workspaceId: string, sessionId: string): void {
    const db = getDb();
    db.prepare('DELETE FROM workspace_sessions WHERE workspace_id = ? AND session_id = ?').run(workspaceId, sessionId);
  }
}

function rowToWorkspace(row: any): Workspace {
  return {
    id: row.id,
    name: row.name,
    parentRepo: row.parent_repo,
    worktreePath: row.worktree_path,
    branch: row.branch,
    baseBranch: row.base_branch ?? undefined,
    agentId: row.agent_id,
    model: row.model,
    mode: row.mode ?? 'act',
    thinking: row.thinking ?? undefined,
    planAgentId: row.plan_agent_id ?? undefined,
    planModel: row.plan_model ?? undefined,
    planThinking: row.plan_thinking ?? undefined,
    actAgentId: row.act_agent_id ?? undefined,
    actModel: row.act_model ?? undefined,
    actThinking: row.act_thinking ?? undefined,
    sshHost: row.ssh_host ?? undefined,
    status: row.status,
    outcome: row.outcome ?? 'in_progress',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sessionId: row.session_id ?? undefined,
};
}

function getWorkspaceRow(id: string): any | null {
  const db = getDb();
  return (db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id) as any) ?? null;
}
