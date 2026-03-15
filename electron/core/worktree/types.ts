import type { AgentId, TaskMode, ThinkingLevel } from '../agents/types';

export interface WorktreeInfo {
  id: string;
  path: string;
  branch: string;
  parentRepo: string;
  head: string;
}

export interface DiffFile {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  additions: number;
  deletions: number;
  diff: string;
  oldContent?: string;
  newContent?: string;
}

export interface MergeResult {
  success: boolean;
  conflicts?: string[];
  error?: string;
  /** True when git stash pop failed after merge — stashed changes still exist and need manual recovery. */
  stashConflict?: boolean;
}

export type WorkspaceStatus = 'idle' | 'running' | 'waiting_approval' | 'waiting_input' | 'done' | 'error' | 'merging';

export type WorkspaceOutcome = 'in_progress' | 'ready_for_pr' | 'ready_to_merge' | 'merged' | 'ready_to_archive';

export interface WorkspaceSession {
  id: number;
  workspaceId: string;
  sessionId: string;
  taskId?: string;
  label?: string;
  position: number;
  createdAt: number;
}

export interface Workspace {
  id: string;
  name: string;
  parentRepo: string;
  worktreePath: string;
  branch: string;
  /** The branch that was checked out in the parent repo when this workspace was created. */
  baseBranch?: string;
  agentId: AgentId;
  model: string;
  mode: TaskMode;
  thinking?: ThinkingLevel;
  status: WorkspaceStatus;
  outcome: WorkspaceOutcome;
  createdAt: number;
  updatedAt: number;
  sessionId?: string;
  archivedAt?: number;
}
