import {
  Circle,
  Pencil,
  LoaderCircle,
  Lightbulb,
  ClipboardCheck,
  ShieldAlert,
  MessageCircle,
  Eye,
  ScanSearch,
  AlertCircle,
  GitMerge,
  CircleCheck,
  Archive,
  AlertTriangle,
} from 'lucide-react';
import type { WorkspaceLifecycleState, WorkspaceListSignalState } from '../../lib/workspace-status';

type IconState = WorkspaceLifecycleState | WorkspaceListSignalState;

const iconMap: Record<IconState, React.ComponentType<{ size?: number; className?: string }>> = {
  idle: Circle,
  coding: LoaderCircle,
  planning: Lightbulb,
  planned: ClipboardCheck,
  awaiting_approval: ShieldAlert,
  awaiting_input: MessageCircle,
  ready_for_review: Eye,
  reviewing: ScanSearch,
  changes_requested: AlertCircle,
  ready_to_merge: GitMerge,
  merging: LoaderCircle,
  merged: CircleCheck,
  ready_to_archive: Archive,
  blocked: AlertTriangle,
  has_changes: Pencil,
  archiving: LoaderCircle,
  archive_failed: AlertTriangle,
};

const spinStates = new Set<IconState>(['coding', 'planning', 'merging', 'archiving']);

interface WorkspaceLifecycleIconProps {
  state: IconState;
  size?: number;
  className?: string;
}

export function WorkspaceLifecycleIcon({ state, size = 12, className = '' }: WorkspaceLifecycleIconProps) {
  const Icon = iconMap[state] ?? Circle;
  const spin = spinStates.has(state);

  return (
    <Icon
      size={size}
      className={`${spin ? 'animate-spin' : ''} ${className}`.trim()}
    />
  );
}
