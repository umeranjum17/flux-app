import fs from 'fs';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let db: DatabaseSync;

vi.mock('../../db/connection', () => ({
  getDb: () => db,
}));

import { WorkspaceStore } from '../store';

describe('WorkspaceStore', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        parent_repo TEXT NOT NULL,
        worktree_path TEXT NOT NULL,
        branch TEXT NOT NULL,
        base_branch TEXT,
        agent_id TEXT NOT NULL,
        model TEXT NOT NULL,
        mode TEXT NOT NULL DEFAULT 'act',
        thinking TEXT,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        session_id TEXT,
        archived_at INTEGER,
        outcome TEXT NOT NULL DEFAULT 'in_progress'
      )
    `);
  });

  it('updates a workspace after its worktree path has moved', () => {
    const store = new WorkspaceStore();
    const existingPaths = new Set(['/tmp/worktrees/original']);
    vi.spyOn(fs, 'existsSync').mockImplementation((target) => existingPaths.has(String(target)));

    store.create({
      id: 'ws-1',
      name: 'Original workspace',
      parentRepo: '/tmp/repo',
      worktreePath: '/tmp/worktrees/original',
      branch: 'flux/original',
      agentId: 'codex',
      model: 'gpt-5-codex',
      status: 'idle',
    });

    existingPaths.delete('/tmp/worktrees/original');
    existingPaths.add('/tmp/worktrees/renamed');

    const updated = store.update('ws-1', {
      name: 'Renamed workspace',
      worktreePath: '/tmp/worktrees/renamed',
      branch: 'flux/renamed',
    });

    expect(updated).toMatchObject({
      id: 'ws-1',
      name: 'Renamed workspace',
      worktreePath: '/tmp/worktrees/renamed',
      branch: 'flux/renamed',
    });
    expect(store.get('ws-1')).toMatchObject({
      id: 'ws-1',
      worktreePath: '/tmp/worktrees/renamed',
      branch: 'flux/renamed',
    });
  });
});
