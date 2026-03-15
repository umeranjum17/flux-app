import type { Workspace, WorkspaceStatus, WorkspaceOutcome } from './ipc-api';

export const workspaceStatusConfig: Record<WorkspaceStatus, { color: string; label: string; pulse?: boolean }> = {
  idle: { color: 'bg-text-tertiary', label: 'Idle' },
  running: { color: 'bg-accent', label: 'Coding', pulse: true },
  waiting_approval: { color: 'bg-warning', label: 'Needs approval', pulse: true },
  waiting_input: { color: 'bg-info', label: 'Needs input', pulse: true },
  done: { color: 'bg-info', label: 'Completed' },
  error: { color: 'bg-error', label: 'Error' },
  merging: { color: 'bg-accent', label: 'Merging', pulse: true },
};

export const workspaceOutcomeConfig: Record<WorkspaceOutcome, { color: string; label: string }> = {
  in_progress: { color: 'text-text-tertiary', label: 'In Progress' },
  ready_for_pr: { color: 'text-accent', label: 'Ready for PR' },
  ready_to_merge: { color: 'text-success', label: 'Ready to Merge' },
  merged: { color: 'text-success', label: 'Merged' },
  ready_to_archive: { color: 'text-warning', label: 'Ready to Archive' },
};

export type WorkspaceLifecycleState =
  | 'idle'
  | 'coding'
  | 'awaiting_approval'
  | 'awaiting_input'
  | 'ready_for_review'
  | 'ready_to_merge'
  | 'merging'
  | 'merged'
  | 'blocked';

export const workspaceLifecycleConfig: Record<
  WorkspaceLifecycleState,
  { color: string; label: string; pulse?: boolean; detail: string; badgeClass: string }
> = {
  idle: {
    color: 'bg-text-tertiary',
    label: 'Idle',
    detail: 'Workspace is waiting for the next task.',
    badgeClass: 'bg-bg-secondary text-text-tertiary',
  },
  coding: {
    color: 'bg-accent',
    label: 'Coding',
    pulse: true,
    detail: 'Agent is actively writing or editing code.',
    badgeClass: 'bg-accent/12 text-accent',
  },
  awaiting_approval: {
    color: 'bg-warning',
    label: 'Needs Approval',
    pulse: true,
    detail: 'Agent is paused and waiting for permission approval.',
    badgeClass: 'bg-warning/12 text-warning',
  },
  awaiting_input: {
    color: 'bg-info',
    label: 'Needs Input',
    pulse: true,
    detail: 'Agent asked a question and is waiting for your input.',
    badgeClass: 'bg-info/12 text-info',
  },
  ready_for_review: {
    color: 'bg-info',
    label: 'Ready for Review',
    detail: 'Coding pass finished and changes are ready to review.',
    badgeClass: 'bg-info/12 text-info',
  },
  ready_to_merge: {
    color: 'bg-success',
    label: 'Ready to Merge',
    detail: 'Review is complete and this workspace can be merged.',
    badgeClass: 'bg-success/12 text-success',
  },
  merging: {
    color: 'bg-accent',
    label: 'Merging',
    pulse: true,
    detail: 'Merge workflow is running.',
    badgeClass: 'bg-accent/12 text-accent',
  },
  merged: {
    color: 'bg-success',
    label: 'Merged',
    detail: 'Workspace changes have been merged successfully.',
    badgeClass: 'bg-success/12 text-success',
  },
  blocked: {
    color: 'bg-error',
    label: 'Blocked',
    detail: 'Last run failed and needs attention.',
    badgeClass: 'bg-error/12 text-error',
  },
};

export function getWorkspaceLifecycleState(
  workspace: Pick<Workspace, 'status' | 'outcome'>,
): WorkspaceLifecycleState {
  if (workspace.status === 'error') return 'blocked';
  if (workspace.status === 'merging') return 'merging';
  if (workspace.status === 'running') return 'coding';
  if (workspace.status === 'waiting_approval') return 'awaiting_approval';
  if (workspace.status === 'waiting_input') return 'awaiting_input';

  if (workspace.outcome === 'merged' || workspace.outcome === 'ready_to_archive') return 'merged';
  if (workspace.outcome === 'ready_to_merge') return 'ready_to_merge';
  if (workspace.outcome === 'ready_for_pr') return 'ready_for_review';

  return 'idle';
}
