import crypto from 'crypto';
import { getDb } from '../db/connection';
import type {
  SiblingWorkspaceContext,
  WorkspaceGroup,
  WorkspaceGroupMember,
  WorkspaceGroupRole,
} from './types';

export class WorkspaceGroupStore {
  create(name: string, workspaceIds: string[] = []): WorkspaceGroup {
    const db = getDb();
    const id = crypto.randomUUID();
    const createdAt = Date.now();

    db.prepare('INSERT INTO workspace_groups (id, name, project_group_id, created_at) VALUES (?, ?, ?, ?)').run(
      id,
      name,
      null,
      createdAt,
    );

    workspaceIds.forEach((workspaceId, index) => {
      this.insertMember(id, workspaceId, index === 0 ? 'primary' : 'sibling', index);
    });

    return this.getGroup(id)!;
  }

  addMember(groupId: string, workspaceId: string, role: WorkspaceGroupRole = 'sibling'): WorkspaceGroup | null {
    const group = this.getGroup(groupId);
    if (!group) return null;
    this.insertMember(groupId, workspaceId, role, group.members.length);
    return this.getGroup(groupId);
  }

  removeMember(groupId: string, workspaceId: string): WorkspaceGroup | null {
    const db = getDb();
    if (!this.getGroup(groupId)) return null;

    db.prepare('DELETE FROM workspace_group_members WHERE group_id = ? AND workspace_id = ?').run(groupId, workspaceId);
    this.resequence(groupId);

    const remaining = this.listMembers(groupId);
    if (remaining.length <= 1) {
      this.delete(groupId);
      return null;
    }

    if (!remaining.some((member) => member.role === 'primary')) {
      db.prepare("UPDATE workspace_group_members SET role = 'primary' WHERE group_id = ? AND workspace_id = ?").run(
        groupId,
        remaining[0].workspaceId,
      );
    }

    return this.getGroup(groupId);
  }

  getGroup(groupId: string): WorkspaceGroup | null {
    const db = getDb();
    const row = db.prepare('SELECT * FROM workspace_groups WHERE id = ?').get(groupId) as any;
    if (!row) return null;

    return {
      id: row.id,
      name: row.name,
      projectGroupId: row.project_group_id ?? undefined,
      createdAt: row.created_at,
      members: this.listMembers(groupId),
    };
  }

  getGroupForWorkspace(workspaceId: string): { group: WorkspaceGroup; siblings: SiblingWorkspaceContext[] } | null {
    const db = getDb();
    const row = db.prepare('SELECT group_id FROM workspace_group_members WHERE workspace_id = ?').get(workspaceId) as
      | { group_id: string }
      | undefined;
    if (!row) return null;

    const group = this.getGroup(row.group_id);
    if (!group) return null;

    return {
      group,
      siblings: group.members
        .filter((member) => member.workspaceId !== workspaceId)
        .map((member) => ({
          workspaceId: member.workspaceId,
          role: member.role,
          worktreePath: member.worktreePath,
          parentRepo: member.parentRepo,
          branch: member.branch,
          label: member.workspaceName,
        })),
    };
  }

  listMembers(groupId: string): WorkspaceGroupMember[] {
    const db = getDb();
    const rows = db.prepare(`
      SELECT
        m.group_id,
        m.workspace_id,
        m.role,
        m.position,
        w.name AS workspace_name,
        w.branch,
        w.parent_repo,
        w.worktree_path
      FROM workspace_group_members m
      INNER JOIN workspaces w ON w.id = m.workspace_id
      WHERE m.group_id = ?
      ORDER BY m.position ASC
    `).all(groupId) as any[];

    return rows.map((row) => ({
      groupId: row.group_id,
      workspaceId: row.workspace_id,
      role: row.role,
      position: row.position,
      workspaceName: row.workspace_name,
      branch: row.branch,
      parentRepo: row.parent_repo,
      worktreePath: row.worktree_path,
    }));
  }

  delete(groupId: string): void {
    const db = getDb();
    db.prepare('DELETE FROM workspace_group_members WHERE group_id = ?').run(groupId);
    db.prepare('DELETE FROM workspace_groups WHERE id = ?').run(groupId);
  }

  cleanupWorkspaceMembership(workspaceId: string): void {
    const db = getDb();
    const rows = db.prepare('SELECT group_id FROM workspace_group_members WHERE workspace_id = ?').all(workspaceId) as Array<{
      group_id: string;
    }>;

    for (const row of rows) {
      db.prepare('DELETE FROM workspace_group_members WHERE group_id = ? AND workspace_id = ?').run(
        row.group_id,
        workspaceId,
      );
      this.resequence(row.group_id);
      this.normalizeGroup(row.group_id);
    }
  }

  private insertMember(groupId: string, workspaceId: string, role: WorkspaceGroupRole, position: number): void {
    const db = getDb();
    this.detachWorkspaceFromExistingGroups(workspaceId, groupId);
    db.prepare(
      'INSERT OR IGNORE INTO workspace_group_members (group_id, workspace_id, role, position) VALUES (?, ?, ?, ?)',
    ).run(groupId, workspaceId, role, position);
  }

  private resequence(groupId: string): void {
    const db = getDb();
    const members = db.prepare(
      'SELECT workspace_id FROM workspace_group_members WHERE group_id = ? ORDER BY position ASC',
    ).all(groupId) as Array<{ workspace_id: string }>;

    members.forEach((member, index) => {
      db.prepare('UPDATE workspace_group_members SET position = ? WHERE group_id = ? AND workspace_id = ?').run(
        index,
        groupId,
        member.workspace_id,
      );
    });
  }

  private detachWorkspaceFromExistingGroups(workspaceId: string, nextGroupId: string): void {
    const db = getDb();
    const rows = db.prepare(
      'SELECT group_id FROM workspace_group_members WHERE workspace_id = ? AND group_id != ?',
    ).all(workspaceId, nextGroupId) as Array<{ group_id: string }>;

    for (const row of rows) {
      db.prepare('DELETE FROM workspace_group_members WHERE group_id = ? AND workspace_id = ?').run(
        row.group_id,
        workspaceId,
      );
      this.resequence(row.group_id);
      this.normalizeGroup(row.group_id);
    }
  }

  private normalizeGroup(groupId: string): void {
    const db = getDb();
    const remaining = this.listMembers(groupId);
    if (remaining.length <= 1) {
      this.delete(groupId);
      return;
    }
    if (!remaining.some((member) => member.role === 'primary')) {
      db.prepare("UPDATE workspace_group_members SET role = 'primary' WHERE group_id = ? AND workspace_id = ?").run(
        groupId,
        remaining[0].workspaceId,
      );
    }
  }
}
