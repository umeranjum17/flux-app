import { CircleCheck, CircleAlert, CircleX, CirclePause, CircleDot, CircleArrowUp } from 'lucide-react';
import { workspaceLifecycleConfig } from '../../lib/workspace-status';
import type { WorkspaceLifecycleState, WorkspaceListSignalState } from '../../lib/workspace-status';

type IconState = WorkspaceLifecycleState | WorkspaceListSignalState;

/**
 * States where a Lucide icon adds real semantic value beyond what
 * color + motion can express. Everything else renders as a dot.
 */
const iconMap: Partial<Record<IconState, React.ComponentType<{ size?: number; className?: string }>>> = {
  ready_to_merge: CircleCheck,
  merged: CircleCheck,
  changes_requested: CircleAlert,
  blocked: CircleX,
  archive_failed: CircleX,
  // Rare but high-impact states — circular icons for unmissable visibility
  awaiting_approval: CirclePause,
  ready_for_review: CircleDot,
  merging: CircleArrowUp,
};

/** Icon animation classes — only applied to icon states. */
const iconAnimationMap: Partial<Record<IconState, string>> = {
  changes_requested: 'workspace-icon-nudge',
  blocked: 'workspace-icon-pulse',
  awaiting_approval: 'workspace-icon-pulse',
  merging: 'workspace-icon-spin',
};

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
  const Icon = iconMap[state];
  const showRing = ringStates.has(state);
  const ringClass = `workspace-dot-ring ${fastRingStates.has(state) ? 'workspace-dot-ring-fast' : ''}`;

  if (Icon) {
    const animation = iconAnimationMap[state] ?? '';
    return (
      <span className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
        <Icon size={size} className={`${animation} ${className}`.trim()} />
        {showRing && <span className={`${ringClass} ${className}`} />}
      </span>
    );
  }

  // Render as a dot — size is used as the diameter in px
  const config = workspaceLifecycleConfig[state as WorkspaceLifecycleState];
  const dotMotion = config?.dotMotionClass
    ?? dotMotionFallback[state as WorkspaceListSignalState]
    ?? 'workspace-dot-idle';

  const dotSize = size * 0.58;

  return (
    <span
      className="relative inline-flex items-center justify-center"
      style={{ width: dotSize, height: dotSize }}
    >
      <span
        className={`lifecycle-dot ${className} ${dotMotion}`}
        style={{ width: dotSize, height: dotSize, backgroundColor: 'currentColor' }}
        aria-hidden="true"
      />
      {showRing && <span className={`${ringClass} ${className}`} />}
    </span>
  );
}
