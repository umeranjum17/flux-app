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

export type WorkspaceOutcome = 'in_progress' | 'planned' | 'ready_for_pr' | 'reviewing' | 'changes_requested' | 'ready_to_merge' | 'merged' | 'ready_to_archive';

export type WorkspaceOperationKind = 'archive';

export type WorkspaceOperationStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export type WorkspaceOperationStage =
  | 'queued'
  | 'releasing_tasks'
  | 'checking_repo'
  | 'resolving_branch'
  | 'removing_git_worktree'
  | 'removing_git_branch'
  | 'removing_worktree_files'
  | 'cleaning_db'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface WorkspaceOperation {
  id: string;
  workspaceId: string;
  kind: WorkspaceOperationKind;
  status: WorkspaceOperationStatus;
  stage: WorkspaceOperationStage;
  progress: number;
  message: string;
  startedAt: number;
  updatedAt: number;
  finishedAt?: number;
  error?: string;
  cancellable: boolean;
}

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
  planAgentId?: AgentId;
  planModel?: string;
  planThinking?: ThinkingLevel;
  actAgentId?: AgentId;
  actModel?: string;
  actThinking?: ThinkingLevel;
  status: WorkspaceStatus;
  outcome: WorkspaceOutcome;
  createdAt: number;
  updatedAt: number;
  sessionId?: string;
}
