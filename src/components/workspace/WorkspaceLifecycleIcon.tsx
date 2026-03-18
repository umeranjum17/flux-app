import { CircleCheck, CircleAlert, CircleX } from 'lucide-react';
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
};

/** Icon animation classes — only applied to icon states. */
const iconAnimationMap: Partial<Record<IconState, string>> = {
  changes_requested: 'workspace-icon-nudge',
  blocked: 'workspace-icon-pulse',
};

/** Dot motion for list-only states not in workspaceLifecycleConfig. */
const dotMotionFallback: Partial<Record<WorkspaceListSignalState, string>> = {
  has_changes: 'workspace-dot-settled',
  archiving: 'workspace-dot-active',
};

interface WorkspaceLifecycleIconProps {
  state: IconState;
  size?: number;
  className?: string;
}

export function WorkspaceLifecycleIcon({ state, size = 12, className = '' }: WorkspaceLifecycleIconProps) {
  const Icon = iconMap[state];

  if (Icon) {
    const animation = iconAnimationMap[state] ?? '';
    return <Icon size={size} className={`${animation} ${className}`.trim()} />;
  }

  // Render as a dot — size is used as the diameter in px
  const config = workspaceLifecycleConfig[state as WorkspaceLifecycleState];
  const dotMotion = config?.dotMotionClass
    ?? dotMotionFallback[state as WorkspaceListSignalState]
    ?? 'workspace-dot-idle';

  return (
    <span
      className={`lifecycle-dot ${className} ${dotMotion}`}
      style={{ width: size * 0.58, height: size * 0.58, backgroundColor: 'currentColor' }}
      aria-hidden="true"
    />
  );
}
