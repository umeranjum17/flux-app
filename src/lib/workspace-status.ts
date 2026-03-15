import type { Workspace, WorkspaceStatus, WorkspaceOutcome } from './ipc-api';

export const workspaceStatusConfig: Record<WorkspaceStatus, { color: string; label: string; pulse?: boolean }> = {
  idle: { color: 'bg-text-tertiary', label: 'Idle' },
  running: { color: 'bg-accent', label: 'Working', pulse: true },
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
  {
    color: string;
    label: string;
    pulse?: boolean;
    detail: string;
    badgeClass: string;
    accentColor: string;
    cardTint: string;
  }
> = {
  idle: {
    color: 'bg-text-tertiary',
    label: 'Idle',
    detail: 'Waiting for the next task.',
    badgeClass: 'bg-bg-secondary text-text-tertiary',
    accentColor: 'bg-text-tertiary/40',
    cardTint: '',
  },
  coding: {
    color: 'bg-accent',
    label: 'Working',
    pulse: true,
    detail: 'Agent is working.',
    badgeClass: 'bg-accent/12 text-accent',
    accentColor: 'bg-accent',
    cardTint: 'lifecycle-tint-coding',
  },
  awaiting_approval: {
    color: 'bg-warning',
    label: 'Needs Approval',
    pulse: true,
    detail: 'Paused — waiting for your approval.',
    badgeClass: 'bg-warning/12 text-warning',
    accentColor: 'bg-warning',
    cardTint: 'lifecycle-tint-warning',
  },
  awaiting_input: {
    color: 'bg-info',
    label: 'Needs Input',
    pulse: true,
    detail: 'Agent asked a question.',
    badgeClass: 'bg-info/12 text-info',
    accentColor: 'bg-info',
    cardTint: 'lifecycle-tint-info',
  },
  ready_for_review: {
    color: 'bg-info',
    label: 'Ready for Review',
    detail: 'Changes are ready to review.',
    badgeClass: 'bg-info/12 text-info',
    accentColor: 'bg-info',
    cardTint: 'lifecycle-tint-info',
  },
  ready_to_merge: {
    color: 'bg-success',
    label: 'Ready to Merge',
    detail: 'Reviewed and ready to merge.',
    badgeClass: 'bg-success/12 text-success',
    accentColor: 'bg-success',
    cardTint: 'lifecycle-tint-success',
  },
  merging: {
    color: 'bg-accent',
    label: 'Merging',
    pulse: true,
    detail: 'Merge in progress.',
    badgeClass: 'bg-accent/12 text-accent',
    accentColor: 'bg-accent',
    cardTint: 'lifecycle-tint-coding',
  },
  merged: {
    color: 'bg-success',
    label: 'Merged',
    detail: 'Successfully merged.',
    badgeClass: 'bg-success/12 text-success',
    accentColor: 'bg-success',
    cardTint: 'lifecycle-tint-success',
  },
  blocked: {
    color: 'bg-error',
    label: 'Blocked',
    detail: 'Last run failed — needs attention.',
    badgeClass: 'bg-error/12 text-error',
    accentColor: 'bg-error',
    cardTint: 'lifecycle-tint-error',
  },
};

/** Whether the workspace has reached a terminal outcome (merged or ready to archive). */
export function isTerminalOutcome(outcome: WorkspaceOutcome | undefined): boolean {
  return outcome === 'merged' || outcome === 'ready_to_archive';
}

export function getWorkspaceLifecycleState(
  workspace: Pick<Workspace, 'status' | 'outcome'>,
): WorkspaceLifecycleState {
  if (workspace.status === 'error') return 'blocked';
  if (workspace.status === 'merging') return 'merging';
  if (workspace.status === 'running') return 'coding';
  if (workspace.status === 'waiting_approval') return 'awaiting_approval';
  if (workspace.status === 'waiting_input') return 'awaiting_input';

  if (isTerminalOutcome(workspace.outcome)) return 'merged';
  if (workspace.outcome === 'ready_to_merge') return 'ready_to_merge';
  if (workspace.outcome === 'ready_for_pr') return 'ready_for_review';

  return 'idle';
}
