import { workspaceLifecycleConfig } from '../../lib/workspace-status';
import type { WorkspaceLifecycleState, WorkspaceListSignalState } from '../../lib/workspace-status';

type IconState = WorkspaceLifecycleState | WorkspaceListSignalState;
type IndicatorVariant = 'ring' | 'half' | 'split' | 'solid' | 'core' | 'filled';

const indicatorVariantMap = {
  idle: 'ring',
  has_changes: 'split',
  coding: 'solid',
  planning: 'solid',
  planned: 'half',
  awaiting_approval: 'core',
  awaiting_input: 'core',
  ready_for_review: 'half',
  reviewing: 'half',
  changes_requested: 'core',
  ready_to_merge: 'filled',
  merging: 'filled',
  merged: 'filled',
  ready_to_archive: 'filled',
  blocked: 'core',
  archiving: 'filled',
  archive_failed: 'core',
} satisfies Record<IconState, IndicatorVariant>;

/** Dot motion for list-only states not in workspaceLifecycleConfig. */
const dotMotionFallback: Partial<Record<WorkspaceListSignalState, string>> = {
  has_changes: 'workspace-dot-settled',
  archiving: 'workspace-dot-active',
};

/** States that need user action — show a radar-ping ring to draw attention. */
const ringStates = new Set<IconState>([
  'awaiting_approval',
  'awaiting_input',
  'changes_requested',
  'blocked',
  'archive_failed',
]);

/** Fast ring for more urgent states. */
const fastRingStates = new Set<IconState>([
  'awaiting_approval',
  'changes_requested',
  'blocked',
]);

interface WorkspaceLifecycleIconProps {
  state: IconState;
  size?: number;
  className?: string;
}

export function WorkspaceLifecycleIcon({ state, size = 12, className = '' }: WorkspaceLifecycleIconProps) {
  const showRing = ringStates.has(state);
  const ringClass = `workspace-dot-ring ${fastRingStates.has(state) ? 'workspace-dot-ring-fast' : ''}`;
  const config = workspaceLifecycleConfig[state as WorkspaceLifecycleState];
  const dotMotion = config?.dotMotionClass
    ?? dotMotionFallback[state as WorkspaceListSignalState]
    ?? 'workspace-dot-idle';
  const variant = indicatorVariantMap[state];

  return (
    <span
      className={`workspace-indicator ${dotMotion} ${className}`.trim()}
      data-state={state}
      data-indicator-variant={variant}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <span className="workspace-indicator-shell" />
      {variant !== 'ring' && <span className="workspace-indicator-fill" />}
      {variant === 'core' && <span className="workspace-indicator-core" />}
      {variant === 'filled' && <span className="workspace-indicator-glint" />}
      {showRing && <span className={`${ringClass} ${className}`} />}
    </span>
  );
}
