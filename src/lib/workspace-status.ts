import type { Workspace, WorkspaceStatus, WorkspaceOutcome, WorkspaceOperation } from './ipc-api';

export const workspaceStatusConfig: Record<WorkspaceStatus, { color: string; label: string; pulse?: boolean }> = {
  idle: { color: 'bg-text-tertiary', label: 'Idle' },
  running: { color: 'bg-info', label: 'Working' },
  waiting_approval: { color: 'bg-warning', label: 'Needs approval', pulse: true },
  waiting_input: { color: 'bg-info', label: 'Needs input', pulse: true },
  done: { color: 'bg-success', label: 'Completed' },
  error: { color: 'bg-error', label: 'Error' },
  merging: { color: 'bg-plan', label: 'Merging' },
};

export const workspaceOutcomeConfig: Record<WorkspaceOutcome, { color: string; label: string }> = {
  backlog: { color: 'text-text-tertiary', label: 'Backlog' },
  discovery: { color: 'text-accent', label: 'Exploring' },
  in_progress: { color: 'text-info', label: 'Building' },
  planned: { color: 'text-info', label: 'Plan Ready' },
  ready_for_pr: { color: 'text-plan', label: 'Ready for You' },
  reviewing: { color: 'text-plan', label: 'In Review' },
  changes_requested: { color: 'text-error', label: 'Needs Changes' },
  ready_to_merge: { color: 'text-success', label: 'Approved' },
  merged: { color: 'text-success', label: 'Shipped' },
  ready_to_archive: { color: 'text-warning', label: 'Clean Up' },
};

export type WorkspaceLifecycleState =
  | 'idle'
  | 'backlog'
  | 'discovery'
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
  iconColor: string;
  label: string;
  pulse?: boolean;
  glow?: string;
  dotMotionClass: string;
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
    color: 'bg-text-tertiary/60',
    iconColor: 'text-text-tertiary/70',
    label: 'Idle',
    dotMotionClass: 'workspace-dot-idle',
    detail: 'Waiting for the next task.',
    badgeClass: 'bg-bg-secondary text-text-tertiary',
    accentColor: 'bg-text-tertiary/40',
    cardTint: '',
  },
  backlog: {
    color: 'bg-text-tertiary/60',
    iconColor: 'text-text-tertiary/70',
    label: 'Backlog',
    dotMotionClass: 'workspace-dot-idle',
    detail: 'Queued — not yet started.',
    badgeClass: 'bg-bg-secondary text-text-tertiary',
    accentColor: 'bg-text-tertiary/40',
    cardTint: '',
  },
  discovery: {
    color: 'bg-accent',
    iconColor: 'text-accent',
    label: 'Exploring',
    dotMotionClass: 'workspace-dot-active',
    detail: 'Agent is exploring and gathering context.',
    badgeClass: 'bg-accent/12 text-accent',
    accentColor: 'bg-accent',
    cardTint: 'lifecycle-tint-info',
  },
  coding: {
    color: 'bg-info',
    iconColor: 'text-info',
    label: 'Building',
    dotMotionClass: 'workspace-dot-active',
    detail: 'Agent is building.',
    badgeClass: 'bg-info/12 text-info',
    accentColor: 'bg-info',
    cardTint: 'lifecycle-tint-info',
  },
  planning: {
    color: 'bg-plan',
    iconColor: 'text-plan',
    label: 'Planning',
    dotMotionClass: 'workspace-dot-active',
    detail: 'Agent is creating a plan.',
    badgeClass: 'bg-plan/12 text-plan',
    accentColor: 'bg-plan',
    cardTint: 'lifecycle-tint-info',
  },
  planned: {
    color: 'bg-info',
    iconColor: 'text-info',
    label: 'Plan Ready',
    glow: 'dot-glow-info',
    dotMotionClass: 'workspace-dot-settled',
    detail: 'Plan ready for your review.',
    badgeClass: 'bg-info/12 text-info',
    accentColor: 'bg-info',
    cardTint: 'lifecycle-tint-info',
  },
  awaiting_approval: {
    color: 'bg-warning',
    iconColor: 'text-warning',
    label: 'Needs Approval',
    pulse: true,
    glow: 'dot-glow-warning',
    dotMotionClass: 'workspace-dot-attention',
    detail: 'Paused — waiting for your approval.',
    badgeClass: 'bg-warning/12 text-warning',
    accentColor: 'bg-warning',
    cardTint: 'lifecycle-tint-warning',
  },
  awaiting_input: {
    color: 'bg-info',
    iconColor: 'text-info',
    label: 'Needs Input',
    pulse: true,
    glow: 'dot-glow-info',
    dotMotionClass: 'workspace-dot-attention',
    detail: 'Agent asked a question.',
    badgeClass: 'bg-info/12 text-info',
    accentColor: 'bg-info',
    cardTint: 'lifecycle-tint-info',
  },
  ready_for_review: {
    color: 'bg-plan',
    iconColor: 'text-plan',
    label: 'Ready for You',
    glow: 'dot-glow-plan',
    dotMotionClass: 'workspace-dot-settled',
    detail: 'Changes are ready for your review.',
    badgeClass: 'bg-plan/12 text-plan',
    accentColor: 'bg-plan',
    cardTint: 'lifecycle-tint-info',
  },
  reviewing: {
    color: 'bg-plan',
    iconColor: 'text-plan',
    label: 'In Review',
    dotMotionClass: 'workspace-dot-active',
    detail: 'Changes are being reviewed.',
    badgeClass: 'bg-plan/12 text-plan',
    accentColor: 'bg-plan',
    cardTint: 'lifecycle-tint-plan',
  },
  changes_requested: {
    color: 'bg-error',
    iconColor: 'text-error',
    label: 'Needs Changes',
    glow: 'dot-glow-error',
    dotMotionClass: 'workspace-dot-alert',
    detail: 'Reviewer requested changes.',
    badgeClass: 'bg-error/12 text-error',
    accentColor: 'bg-error',
    cardTint: 'lifecycle-tint-error',
  },
  ready_to_merge: {
    color: 'bg-success',
    iconColor: 'text-success',
    label: 'Approved',
    glow: 'dot-glow-success',
    dotMotionClass: 'workspace-dot-settled',
    detail: 'Reviewed and approved — ready to ship.',
    badgeClass: 'bg-success/12 text-success',
    accentColor: 'bg-success',
    cardTint: 'lifecycle-tint-success',
  },
  merging: {
    color: 'bg-plan',
    iconColor: 'text-plan',
    label: 'Merging',
    dotMotionClass: 'workspace-dot-active',
    detail: 'Merge in progress.',
    badgeClass: 'bg-plan/12 text-plan',
    accentColor: 'bg-plan',
    cardTint: 'lifecycle-tint-info',
  },
  merged: {
    color: 'bg-success/70',
    iconColor: 'text-success/80',
    label: 'Shipped',
    dotMotionClass: 'workspace-dot-settled',
    detail: 'Successfully shipped.',
    badgeClass: 'bg-success/12 text-success',
    accentColor: 'bg-success',
    cardTint: 'lifecycle-tint-success',
  },
  ready_to_archive: {
    color: 'bg-warning',
    iconColor: 'text-warning',
    label: 'Clean Up',
    glow: 'dot-glow-warning',
    dotMotionClass: 'workspace-dot-settled',
    detail: 'Shipped — ready to clean up.',
    badgeClass: 'bg-warning/12 text-warning',
    accentColor: 'bg-warning',
    cardTint: 'lifecycle-tint-warning',
  },
  blocked: {
    color: 'bg-error',
    iconColor: 'text-error',
    label: 'Blocked',
    glow: 'dot-glow-error',
    dotMotionClass: 'workspace-dot-alert',
    detail: 'Last run failed — needs attention.',
    badgeClass: 'bg-error/12 text-error',
    accentColor: 'bg-error',
    cardTint: 'lifecycle-tint-error',
  },
};

interface WorkspaceListSignalConfigEntry {
  color: string;
  iconColor: string;
  label: string;
  detail: string;
  dotClassName: string;
  dotMotionClass: string;
}

/** Pick color + iconColor from the lifecycle config so list indicators stay in sync. */
function lifecycleColors(state: WorkspaceLifecycleState) {
  const { color, iconColor } = workspaceLifecycleConfig[state];
  return { color, iconColor };
}

const workspaceListSignalConfig: Record<WorkspaceListSignalState, WorkspaceListSignalConfigEntry> = {
  idle: {
    ...lifecycleColors('idle'),
    label: 'Idle',
    detail: 'Waiting for the next task.',
    dotClassName: 'workspace-list-signal workspace-list-signal-idle',
    dotMotionClass: 'workspace-dot-idle',
  },
  backlog: {
    ...lifecycleColors('backlog'),
    label: 'Backlog',
    detail: 'Queued — not yet started.',
    dotClassName: 'workspace-list-signal workspace-list-signal-backlog',
    dotMotionClass: 'workspace-dot-idle',
  },
  has_changes: {
    color: 'bg-accent',
    iconColor: 'text-accent',
    label: 'Has changes',
    detail: 'Workspace has unreviewed changes.',
    dotClassName: 'workspace-list-signal workspace-list-signal-has-changes',
    dotMotionClass: 'workspace-dot-settled',
  },
  discovery: {
    ...lifecycleColors('discovery'),
    label: 'Exploring',
    detail: 'Agent is exploring and gathering context.',
    dotClassName: 'workspace-list-signal workspace-list-signal-discovery',
    dotMotionClass: 'workspace-dot-active',
  },
  coding: {
    ...lifecycleColors('coding'),
    label: 'Building',
    detail: 'Agent is working.',
    dotClassName: 'workspace-list-signal workspace-list-signal-working',
    dotMotionClass: 'workspace-dot-active',
  },
  planning: {
    ...lifecycleColors('planning'),
    label: 'Planning',
    detail: 'Agent is creating a plan.',
    dotClassName: 'workspace-list-signal workspace-list-signal-planning',
    dotMotionClass: 'workspace-dot-active',
  },
  planned: {
    ...lifecycleColors('planned'),
    label: 'Plan Ready',
    detail: 'Plan ready for your review.',
    dotClassName: 'workspace-list-signal workspace-list-signal-planned',
    dotMotionClass: 'workspace-dot-settled',
  },
  awaiting_approval: {
    ...lifecycleColors('awaiting_approval'),
    label: 'Needs approval',
    detail: 'Paused — waiting for your approval.',
    dotClassName: 'workspace-list-signal workspace-list-signal-needs-approval',
    dotMotionClass: 'workspace-dot-attention',
  },
  awaiting_input: {
    ...lifecycleColors('awaiting_input'),
    label: 'Needs input',
    detail: 'Agent asked a question.',
    dotClassName: 'workspace-list-signal workspace-list-signal-needs-input',
    dotMotionClass: 'workspace-dot-attention',
  },
  ready_for_review: {
    ...lifecycleColors('ready_for_review'),
    label: 'Ready for you',
    detail: 'Changes are ready to review.',
    dotClassName: 'workspace-list-signal workspace-list-signal-review-ready',
    dotMotionClass: 'workspace-dot-settled',
  },
  reviewing: {
    ...lifecycleColors('reviewing'),
    label: 'In Review',
    detail: 'Changes are being reviewed.',
    dotClassName: 'workspace-list-signal workspace-list-signal-reviewing',
    dotMotionClass: 'workspace-dot-active',
  },
  changes_requested: {
    ...lifecycleColors('changes_requested'),
    label: 'Needs changes',
    detail: 'Reviewer requested changes.',
    dotClassName: 'workspace-list-signal workspace-list-signal-changes-requested',
    dotMotionClass: 'workspace-dot-alert',
  },
  ready_to_merge: {
    ...lifecycleColors('ready_to_merge'),
    label: 'Approved',
    detail: 'Reviewed and ready to merge.',
    dotClassName: 'workspace-list-signal workspace-list-signal-ready-to-merge',
    dotMotionClass: 'workspace-dot-settled',
  },
  merging: {
    ...lifecycleColors('merging'),
    label: 'Merging',
    detail: 'Merge in progress.',
    dotClassName: 'workspace-list-signal workspace-list-signal-working',
    dotMotionClass: 'workspace-dot-active',
  },
  merged: {
    ...lifecycleColors('merged'),
    label: 'Shipped',
    detail: 'Successfully merged.',
    dotClassName: 'workspace-list-signal workspace-list-signal-complete',
    dotMotionClass: 'workspace-dot-settled',
  },
  ready_to_archive: {
    ...lifecycleColors('ready_to_archive'),
    label: 'Clean up',
    detail: 'Merged — ready to clean up.',
    dotClassName: 'workspace-list-signal workspace-list-signal-ready-to-archive',
    dotMotionClass: 'workspace-dot-settled',
  },
  blocked: {
    ...lifecycleColors('blocked'),
    label: 'Blocked',
    detail: 'Last run failed — needs attention.',
    dotClassName: 'workspace-list-signal workspace-list-signal-blocked',
    dotMotionClass: 'workspace-dot-alert',
  },
  archiving: {
    color: 'bg-info',
    iconColor: 'text-info',
    label: 'Archiving',
    detail: 'Workspace archive is in progress.',
    dotClassName: 'workspace-list-signal workspace-list-signal-working',
    dotMotionClass: 'workspace-dot-active',
  },
  archive_failed: {
    color: 'bg-error',
    iconColor: 'text-error',
    label: 'Archive failed',
    detail: 'Workspace archive failed — needs attention.',
    dotClassName: 'workspace-list-signal workspace-list-signal-blocked',
    dotMotionClass: 'workspace-dot-alert',
  },
};

export interface WorkspaceListSignal {
  state: WorkspaceListSignalState;
  color: string;
  iconColor: string;
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
  if (workspace.status === 'running') {
    if (workspace.mode === 'plan') return 'planning';
    if (workspace.mode === 'discovery') return 'discovery';
    return 'coding';
  }
  if (workspace.status === 'waiting_approval') return 'awaiting_approval';
  if (workspace.status === 'waiting_input') return 'awaiting_input';

  if (workspace.outcome === 'ready_to_archive') return 'ready_to_archive';
  if (workspace.outcome === 'merged') return 'merged';
  if (workspace.outcome === 'ready_to_merge') return 'ready_to_merge';
  if (workspace.outcome === 'reviewing') return 'reviewing';
  if (workspace.outcome === 'changes_requested') return 'changes_requested';
  if (workspace.outcome === 'ready_for_pr') return 'ready_for_review';
  if (workspace.outcome === 'planned') return 'planned';
  if (workspace.outcome === 'discovery') return 'discovery';
  if (workspace.outcome === 'backlog') return 'backlog';

  return 'idle';
}

/** Whether a lifecycle state requires user action (approval, input, review of changes, or error). */
export function isActionNeededState(state: WorkspaceLifecycleState | WorkspaceListSignalState): boolean {
  return state === 'awaiting_approval'
    || state === 'awaiting_input'
    || state === 'changes_requested'
    || state === 'blocked'
    || state === 'archive_failed';
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
    iconColor: config.iconColor,
    label: config.label,
    detail,
    tooltip,
    dotClassName: `lifecycle-dot ${config.color} ${config.dotClassName} ${config.dotMotionClass}`,
    ariaLabel: `${workspace.name} — ${config.label}. ${detail}`,
  };
}
