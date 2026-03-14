import type { AgentId } from '../agents/types';

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
}

export type WorkspaceStatus = 'idle' | 'running' | 'waiting_approval' | 'waiting_input' | 'done' | 'error' | 'merging';

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
  agentId: AgentId;
  model: string;
  status: WorkspaceStatus;
  createdAt: number;
  updatedAt: number;
  sessionId?: string;
  archivedAt?: number;
}
