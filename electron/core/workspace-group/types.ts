import type { WorkspaceOutcome } from '../worktree/types';

export type WorkspaceGroupRole = 'primary' | 'sibling';

export interface WorkspaceGroupMember {
  groupId: string;
  workspaceId: string;
  role: WorkspaceGroupRole;
  position: number;
  workspaceName: string;
  branch: string;
  parentRepo: string;
  worktreePath: string;
  outcome: WorkspaceOutcome;
}

export interface WorkspaceGroup {
  id: string;
  name: string;
  projectGroupId?: string;
  createdAt: number;
  members: WorkspaceGroupMember[];
}

export interface SiblingWorkspaceContext {
  workspaceId: string;
  role: WorkspaceGroupRole;
  worktreePath: string;
  parentRepo: string;
  branch: string;
  label: string;
  outcome: WorkspaceOutcome;
}
