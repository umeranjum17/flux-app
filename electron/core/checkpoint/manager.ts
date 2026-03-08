import { execFile } from 'child_process';
import { promisify } from 'util';
import crypto from 'crypto';
import { getDb } from '../db/connection';
import type { Checkpoint } from './types';

const execFileAsync = promisify(execFile);

const CHECKPOINT_PREFIX = '[flux-checkpoint]';

export async function createCheckpoint(
  worktreePath: string,
  workspaceId: string,
  sessionId: string,
  messageIndex: number,
  description: string,
): Promise<Checkpoint> {
  // Get current HEAD as parent
  const { stdout: parentSha } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
    cwd: worktreePath,
    timeout: 10000,
  });

  // Stage all changes
  await execFileAsync('git', ['add', '-A'], {
    cwd: worktreePath,
    timeout: 10000,
  });

  // Check if there are changes to commit
  try {
    await execFileAsync('git', ['diff', '--cached', '--quiet'], {
      cwd: worktreePath,
      timeout: 10000,
    });
    // No changes — still record the checkpoint pointing at current HEAD
    const id = crypto.randomUUID();
    const checkpoint: Checkpoint = {
      id,
      workspaceId,
      sessionId,
      messageIndex,
      gitCommitSha: parentSha.trim(),
      parentSha: parentSha.trim(),
      description,
      filesChanged: 0,
      additions: 0,
      deletions: 0,
      createdAt: Date.now(),
    };
    insertCheckpoint(checkpoint);
    return checkpoint;
  } catch {
    // There are staged changes — proceed to commit
  }

  // Get stats before committing
  const { stdout: numstat } = await execFileAsync(
    'git',
    ['diff', '--cached', '--numstat'],
    { cwd: worktreePath, timeout: 10000 },
  );

  let filesChanged = 0;
  let additions = 0;
  let deletions = 0;
  for (const line of numstat.trim().split('\n')) {
    if (!line.trim()) continue;
    const [addStr, delStr] = line.split('\t');
    filesChanged++;
    additions += addStr === '-' ? 0 : parseInt(addStr, 10) || 0;
    deletions += delStr === '-' ? 0 : parseInt(delStr, 10) || 0;
  }

  // Commit
  const commitMsg = `${CHECKPOINT_PREFIX} ${description}`;
  await execFileAsync('git', ['commit', '-m', commitMsg], {
    cwd: worktreePath,
    timeout: 10000,
  });

  // Get the new commit SHA
  const { stdout: commitSha } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
    cwd: worktreePath,
    timeout: 10000,
  });

  const id = crypto.randomUUID();
  const checkpoint: Checkpoint = {
    id,
    workspaceId,
    sessionId,
    messageIndex,
    gitCommitSha: commitSha.trim(),
    parentSha: parentSha.trim(),
    description,
    filesChanged,
    additions,
    deletions,
    createdAt: Date.now(),
  };

  insertCheckpoint(checkpoint);
  return checkpoint;
}

function insertCheckpoint(checkpoint: Checkpoint): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO checkpoints (id, workspace_id, session_id, message_index, git_commit_sha, parent_sha, description, files_changed, additions, deletions, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    checkpoint.id,
    checkpoint.workspaceId,
    checkpoint.sessionId,
    checkpoint.messageIndex,
    checkpoint.gitCommitSha,
    checkpoint.parentSha,
    checkpoint.description,
    checkpoint.filesChanged,
    checkpoint.additions,
    checkpoint.deletions,
    checkpoint.createdAt,
  );
}

export function listCheckpoints(workspaceId: string): Checkpoint[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM checkpoints WHERE workspace_id = ? ORDER BY created_at ASC')
    .all(workspaceId) as any[];
  return rows.map(rowToCheckpoint);
}

export async function getCheckpointDiff(checkpointId: string, worktreePath: string): Promise<string> {
  const db = getDb();
  const row = db.prepare('SELECT * FROM checkpoints WHERE id = ?').get(checkpointId) as any;
  if (!row) throw new Error(`Checkpoint ${checkpointId} not found`);

  const checkpoint = rowToCheckpoint(row);

  if (checkpoint.gitCommitSha === checkpoint.parentSha) {
    return ''; // No changes in this checkpoint
  }

  const { stdout } = await execFileAsync(
    'git',
    ['diff', checkpoint.parentSha, checkpoint.gitCommitSha],
    { cwd: worktreePath, timeout: 30000 },
  );
  return stdout;
}

export async function revertToCheckpoint(
  worktreePath: string,
  checkpointId: string,
): Promise<void> {
  const db = getDb();
  const row = db.prepare('SELECT * FROM checkpoints WHERE id = ?').get(checkpointId) as any;
  if (!row) throw new Error(`Checkpoint ${checkpointId} not found`);

  const checkpoint = rowToCheckpoint(row);

  await execFileAsync('git', ['reset', '--hard', checkpoint.gitCommitSha], {
    cwd: worktreePath,
    timeout: 10000,
  });

  // Delete checkpoints after this one
  db.prepare(
    'DELETE FROM checkpoints WHERE workspace_id = ? AND created_at > ?',
  ).run(checkpoint.workspaceId, checkpoint.createdAt);
}

function rowToCheckpoint(row: any): Checkpoint {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    sessionId: row.session_id,
    messageIndex: row.message_index,
    gitCommitSha: row.git_commit_sha,
    parentSha: row.parent_sha,
    description: row.description,
    filesChanged: row.files_changed,
    additions: row.additions,
    deletions: row.deletions,
    createdAt: row.created_at,
  };
}
