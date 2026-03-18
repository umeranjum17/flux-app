import {
  Circle,
  CircleDot,
  CircleDashed,
  CircleCheck,
  CircleDotDashed,
  CircleAlert,
  CirclePause,
  CirclePlay,
  CircleX,
  CircleArrowDown,
} from 'lucide-react';
import type { WorkspaceLifecycleState, WorkspaceListSignalState } from '../../lib/workspace-status';

type IconState = WorkspaceLifecycleState | WorkspaceListSignalState;

const iconMap: Record<IconState, React.ComponentType<{ size?: number; className?: string }>> = {
  idle: Circle,
  coding: CircleDot,
  planning: CircleDashed,
  planned: CircleDotDashed,
  awaiting_approval: CirclePause,
  awaiting_input: CirclePause,
  ready_for_review: CircleDot,
  reviewing: CircleDashed,
  changes_requested: CircleAlert,
  ready_to_merge: CircleCheck,
  merging: CircleDashed,
  merged: CircleCheck,
  ready_to_archive: CircleArrowDown,
  blocked: CircleX,
  has_changes: CircleDot,
  archiving: CircleDashed,
  archive_failed: CircleX,
};

/** Maps each state to a subtle animation CSS class. */
const animationMap: Partial<Record<IconState, string>> = {
  idle: 'workspace-icon-idle',
  coding: 'workspace-icon-breathe',
  planning: 'workspace-icon-breathe',
  merging: 'workspace-icon-breathe',
  archiving: 'workspace-icon-breathe',
  awaiting_approval: 'workspace-icon-nudge',
  awaiting_input: 'workspace-icon-nudge',
  changes_requested: 'workspace-icon-nudge',
  blocked: 'workspace-icon-pulse',
  reviewing: 'workspace-icon-breathe',
};

interface WorkspaceLifecycleIconProps {
  state: IconState;
  size?: number;
  className?: string;
}

export function WorkspaceLifecycleIcon({ state, size = 12, className = '' }: WorkspaceLifecycleIconProps) {
  const Icon = iconMap[state] ?? Circle;
  const animation = animationMap[state] ?? '';

  return (
    <Icon
      size={size}
      className={`${animation} ${className}`.trim()}
    />
  );
}
