import type { Workspace, WorkspaceStatus, WorkspaceOutcome, WorkspaceOperation } from './ipc-api';

export const workspaceStatusConfig: Record<WorkspaceStatus, { color: string; label: string; pulse?: boolean }> = {
  idle: { color: 'bg-text-tertiary', label: 'Idle' },
  running: { color: 'bg-success', label: 'Working' },
  waiting_approval: { color: 'bg-warning', label: 'Needs approval', pulse: true },
  waiting_input: { color: 'bg-info', label: 'Needs input', pulse: true },
  done: { color: 'bg-success', label: 'Completed' },
  error: { color: 'bg-error', label: 'Error' },
  merging: { color: 'bg-plan', label: 'Merging' },
};

export const workspaceOutcomeConfig: Record<WorkspaceOutcome, { color: string; label: string }> = {
  in_progress: { color: 'text-text-tertiary', label: 'In Progress' },
  planned: { color: 'text-info', label: 'Planned' },
  ready_for_pr: { color: 'text-accent', label: 'Ready for Review' },
  reviewing: { color: 'text-warning', label: 'Reviewing' },
  changes_requested: { color: 'text-error', label: 'Changes Requested' },
  ready_to_merge: { color: 'text-success', label: 'Ready to Merge' },
  merged: { color: 'text-success', label: 'Merged' },
  ready_to_archive: { color: 'text-warning', label: 'Ready to Archive' },
};

export type WorkspaceLifecycleState =
  | 'idle'
  | 'coding'
  | 'planning'
  | 'planned'
  | 'awaiting_approval'
  | 'awaiting_input'
  | 'ready_for_review'
  | 'reviewing'
  | 'changes_requested'
  | 'ready_to_merge'
  | 'merging'
  | 'merged'
  | 'ready_to_archive'
  | 'blocked';

export type WorkspaceListSignalState = WorkspaceLifecycleState | 'has_changes' | 'archiving' | 'archive_failed';

interface WorkspaceLifecycleConfigEntry {
  color: string;
  label: string;
  pulse?: boolean;
  glow?: string;
  detail: string;
  badgeClass: string;
  accentColor: string;
  cardTint: string;
}

export const workspaceLifecycleConfig: Record<
  WorkspaceLifecycleState,
  WorkspaceLifecycleConfigEntry
> = {
  idle: {
    color: 'bg-text-tertiary/50',
    label: 'Idle',
    detail: 'Waiting for the next task.',
    badgeClass: 'bg-bg-secondary text-text-tertiary',
    accentColor: 'bg-text-tertiary/40',
    cardTint: '',
  },
  coding: {
    color: 'bg-success',
    label: 'Working',
    detail: 'Agent is working.',
    badgeClass: 'bg-success/12 text-success',
    accentColor: 'bg-success',
    cardTint: 'lifecycle-tint-success',
  },
  planning: {
    color: 'bg-plan',
    label: 'Planning',
    detail: 'Agent is creating a plan.',
    badgeClass: 'bg-plan/12 text-plan',
    accentColor: 'bg-plan',
    cardTint: 'lifecycle-tint-info',
  },
  planned: {
    color: 'bg-info',
    label: 'Planned',
    glow: 'dot-glow-info',
    detail: 'Plan ready for your review.',
    badgeClass: 'bg-info/12 text-info',
    accentColor: 'bg-info',
    cardTint: 'lifecycle-tint-info',
  },
  awaiting_approval: {
    color: 'bg-warning',
    label: 'Needs Approval',
    pulse: true,
    glow: 'dot-glow-warning',
    detail: 'Paused — waiting for your approval.',
    badgeClass: 'bg-warning/12 text-warning',
    accentColor: 'bg-warning',
    cardTint: 'lifecycle-tint-warning',
  },
  awaiting_input: {
    color: 'bg-info',
    label: 'Needs Input',
    pulse: true,
    glow: 'dot-glow-info',
    detail: 'Agent asked a question.',
    badgeClass: 'bg-info/12 text-info',
    accentColor: 'bg-info',
    cardTint: 'lifecycle-tint-info',
  },
  ready_for_review: {
    color: 'bg-plan',
    label: 'Ready for Review',
    glow: 'dot-glow-plan',
    detail: 'Changes are ready to review.',
    badgeClass: 'bg-plan/12 text-plan',
    accentColor: 'bg-plan',
    cardTint: 'lifecycle-tint-info',
  },
  reviewing: {
    color: 'bg-plan',
    label: 'Reviewing',
    detail: 'Changes are being reviewed.',
    badgeClass: 'bg-plan/12 text-plan',
    accentColor: 'bg-plan',
    cardTint: 'lifecycle-tint-plan',
  },
  changes_requested: {
    color: 'bg-error',
    label: 'Changes Requested',
    glow: 'dot-glow-error',
    detail: 'Reviewer requested changes.',
    badgeClass: 'bg-error/12 text-error',
    accentColor: 'bg-error',
    cardTint: 'lifecycle-tint-error',
  },
  ready_to_merge: {
    color: 'bg-success',
    label: 'Ready to Merge',
    glow: 'dot-glow-success',
    detail: 'Reviewed and ready to merge.',
    badgeClass: 'bg-success/12 text-success',
    accentColor: 'bg-success',
    cardTint: 'lifecycle-tint-success',
  },
  merging: {
    color: 'bg-plan',
    label: 'Merging',
    detail: 'Merge in progress.',
    badgeClass: 'bg-plan/12 text-plan',
    accentColor: 'bg-plan',
    cardTint: 'lifecycle-tint-info',
  },
  merged: {
    color: 'bg-success/60',
    label: 'Merged',
    detail: 'Successfully merged.',
    badgeClass: 'bg-success/12 text-success',
    accentColor: 'bg-success',
    cardTint: 'lifecycle-tint-success',
  },
  ready_to_archive: {
    color: 'bg-warning',
    label: 'Ready to Archive',
    glow: 'dot-glow-warning',
    detail: 'Merged — ready to clean up.',
    badgeClass: 'bg-warning/12 text-warning',
    accentColor: 'bg-warning',
    cardTint: 'lifecycle-tint-warning',
  },
  blocked: {
    color: 'bg-error',
    label: 'Blocked',
    glow: 'dot-glow-error',
    detail: 'Last run failed — needs attention.',
    badgeClass: 'bg-error/12 text-error',
    accentColor: 'bg-error',
    cardTint: 'lifecycle-tint-error',
  },
};

interface WorkspaceListSignalConfigEntry {
  color: string;
  label: string;
  detail: string;
  dotClassName: string;
}

const workspaceListSignalConfig: Record<WorkspaceListSignalState, WorkspaceListSignalConfigEntry> = {
  idle: {
    color: 'bg-text-tertiary/50',
    label: 'Idle',
    detail: 'Waiting for the next task.',
    dotClassName: 'workspace-list-signal workspace-list-signal-idle',
  },
  has_changes: {
    color: 'bg-accent',
    label: 'Has changes',
    detail: 'Workspace has unreviewed changes.',
    dotClassName: 'workspace-list-signal workspace-list-signal-has-changes',
  },
  coding: {
    color: 'bg-success',
    label: 'Working',
    detail: 'Agent is working.',
    dotClassName: 'workspace-list-signal workspace-list-signal-working',
  },
  planning: {
    color: 'bg-plan',
    label: 'Planning',
    detail: 'Agent is creating a plan.',
    dotClassName: 'workspace-list-signal workspace-list-signal-planning',
  },
  planned: {
    color: 'bg-info',
    label: 'Planned',
    detail: 'Plan ready for your review.',
    dotClassName: 'workspace-list-signal workspace-list-signal-planned',
  },
  awaiting_approval: {
    color: 'bg-warning',
    label: 'Needs approval',
    detail: 'Paused — waiting for your approval.',
    dotClassName: 'workspace-list-signal workspace-list-signal-needs-approval',
  },
  awaiting_input: {
    color: 'bg-info',
    label: 'Needs input',
    detail: 'Agent asked a question.',
    dotClassName: 'workspace-list-signal workspace-list-signal-needs-input',
  },
  ready_for_review: {
    color: 'bg-plan',
    label: 'Ready for review',
    detail: 'Changes are ready to review.',
    dotClassName: 'workspace-list-signal workspace-list-signal-review-ready',
  },
  reviewing: {
    color: 'bg-plan',
    label: 'Reviewing',
    detail: 'Changes are being reviewed.',
    dotClassName: 'workspace-list-signal workspace-list-signal-reviewing',
  },
  changes_requested: {
    color: 'bg-error',
    label: 'Changes requested',
    detail: 'Reviewer requested changes.',
    dotClassName: 'workspace-list-signal workspace-list-signal-changes-requested',
  },
  ready_to_merge: {
    color: 'bg-success',
    label: 'Ready to merge',
    detail: 'Reviewed and ready to merge.',
    dotClassName: 'workspace-list-signal workspace-list-signal-ready-to-merge',
  },
  merging: {
    color: 'bg-plan',
    label: 'Merging',
    detail: 'Merge in progress.',
    dotClassName: 'workspace-list-signal workspace-list-signal-working',
  },
  merged: {
    color: 'bg-success/60',
    label: 'Merged',
    detail: 'Successfully merged.',
    dotClassName: 'workspace-list-signal workspace-list-signal-complete',
  },
  ready_to_archive: {
    color: 'bg-warning',
    label: 'Ready to archive',
    detail: 'Merged — ready to clean up.',
    dotClassName: 'workspace-list-signal workspace-list-signal-ready-to-archive',
  },
  blocked: {
    color: 'bg-error',
    label: 'Blocked',
    detail: 'Last run failed — needs attention.',
    dotClassName: 'workspace-list-signal workspace-list-signal-blocked',
  },
  archiving: {
    color: 'bg-info',
    label: 'Archiving',
    detail: 'Workspace archive is in progress.',
    dotClassName: 'workspace-list-signal workspace-list-signal-working',
  },
  archive_failed: {
    color: 'bg-error',
    label: 'Archive failed',
    detail: 'Workspace archive failed — needs attention.',
    dotClassName: 'workspace-list-signal workspace-list-signal-blocked',
  },
};

export interface WorkspaceListSignal {
  state: WorkspaceListSignalState;
  color: string;
  label: string;
  detail: string;
  tooltip: string;
  dotClassName: string;
  ariaLabel: string;
}

interface WorkspaceListSignalOptions {
  hasChanges?: boolean;
}

/** Whether the workspace has reached a terminal outcome (merged, ready to merge, or ready to archive). */
export function isTerminalOutcome(outcome: WorkspaceOutcome | undefined): boolean {
  return outcome === 'merged' || outcome === 'ready_to_merge' || outcome === 'ready_to_archive';
}

export function getWorkspaceLifecycleState(
  workspace: Pick<Workspace, 'status' | 'outcome'> & Partial<Pick<Workspace, 'mode'>>,
): WorkspaceLifecycleState {
  if (workspace.status === 'error') return 'blocked';
  if (workspace.status === 'merging') return 'merging';
  if (workspace.status === 'running') return workspace.mode === 'plan' ? 'planning' : 'coding';
  if (workspace.status === 'waiting_approval') return 'awaiting_approval';
  if (workspace.status === 'waiting_input') return 'awaiting_input';

  if (workspace.outcome === 'ready_to_archive') return 'ready_to_archive';
  if (workspace.outcome === 'merged') return 'merged';
  if (workspace.outcome === 'ready_to_merge') return 'ready_to_merge';
  if (workspace.outcome === 'reviewing') return 'reviewing';
  if (workspace.outcome === 'changes_requested') return 'changes_requested';
  if (workspace.outcome === 'ready_for_pr') return 'ready_for_review';
  if (workspace.outcome === 'planned') return 'planned';

  return 'idle';
}

export function getWorkspaceListSignal(
  workspace: Pick<Workspace, 'name' | 'status' | 'outcome'> & Partial<Pick<Workspace, 'mode'>>,
  operation?: Pick<WorkspaceOperation, 'kind' | 'status' | 'message' | 'error'>,
  options?: WorkspaceListSignalOptions,
): WorkspaceListSignal {
  let signalState: WorkspaceListSignalState = getWorkspaceLifecycleState(workspace);

  if (signalState === 'idle' && options?.hasChanges && !isTerminalOutcome(workspace.outcome)) {
    signalState = 'has_changes';
  }

  if (operation?.kind === 'archive') {
    if (operation.status === 'running') {
      signalState = 'archiving';
    } else if (operation.status === 'failed') {
      signalState = 'archive_failed';
    }
  }

  const config = workspaceListSignalConfig[signalState];
  const detail = operation?.kind === 'archive' && operation.message
    ? `${config.detail} ${operation.message}.`
      : operation?.kind === 'archive' && operation.status === 'failed' && operation.error
        ? `${config.detail} ${operation.error}.`
        : config.detail;
  const tooltip = `${config.label}. ${detail}`;

  return {
    state: signalState,
    color: config.color,
    label: config.label,
    detail,
    tooltip,
    dotClassName: `lifecycle-dot ${config.color} ${config.dotClassName}`,
    ariaLabel: `${workspace.name} — ${config.label}. ${detail}`,
  };
}
