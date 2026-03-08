import { Bot, Square, Eye, GitMerge, Trash2, MessageSquare } from 'lucide-react';
import type { Workspace, WorkspaceStatus } from '../../lib/ipc-api';

const statusConfig: Record<WorkspaceStatus, { color: string; label: string; pulse?: boolean }> = {
  idle: { color: 'bg-text-tertiary', label: 'Idle' },
  running: { color: 'bg-success', label: 'Running', pulse: true },
  waiting_approval: { color: 'bg-warning', label: 'Waiting', pulse: true },
  done: { color: 'bg-info', label: 'Done' },
  error: { color: 'bg-error', label: 'Error' },
  merging: { color: 'bg-accent', label: 'Merging', pulse: true },
};

interface WorkspaceCardProps {
  workspace: Workspace;
  isActive: boolean;
  onSelect: () => void;
  onStop: () => void;
  onReview: () => void;
  onMerge: () => void;
  onDelete: () => void;
}

export function WorkspaceCard({
  workspace,
  isActive,
  onSelect,
  onStop,
  onReview,
  onMerge,
  onDelete,
}: WorkspaceCardProps) {
  const status = statusConfig[workspace.status] ?? statusConfig.idle;
  const isRunning = workspace.status === 'running' || workspace.status === 'waiting_approval';

  return (
    <button
      onClick={onSelect}
      className={`w-full text-left rounded-lg border p-3 transition-all ${
        isActive
          ? 'border-accent bg-accent/5 shadow-sm'
          : 'border-border bg-bg-secondary hover:border-text-tertiary hover:bg-bg-hover'
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${status.color} ${status.pulse ? 'animate-pulse' : ''}`} />
          <span className="text-sm font-medium text-text-primary truncate">{workspace.name}</span>
        </div>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-bg-elevated text-text-tertiary font-medium shrink-0">
          {status.label}
        </span>
      </div>

      {/* Meta */}
      <div className="flex items-center gap-3 text-[11px] text-text-tertiary mb-3">
        <span className="flex items-center gap-1">
          <Bot size={11} />
          {workspace.agentId}
        </span>
        <span className="truncate">{workspace.model}</span>
        <span className="truncate">{workspace.branch}</span>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
        {isRunning && (
          <ActionButton icon={<Square size={12} />} label="Stop" onClick={onStop} variant="warning" />
        )}
        <ActionButton icon={<MessageSquare size={12} />} label="Chat" onClick={onSelect} />
        <ActionButton icon={<Eye size={12} />} label="Review" onClick={onReview} />
        <ActionButton icon={<GitMerge size={12} />} label="Merge" onClick={onMerge} />
        <div className="flex-1" />
        <ActionButton icon={<Trash2 size={12} />} label="Delete" onClick={onDelete} variant="danger" />
      </div>
    </button>
  );
}

function ActionButton({ icon, label, onClick, variant }: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  variant?: 'danger' | 'warning';
}) {
  const colors = variant === 'danger'
    ? 'hover:bg-error/10 hover:text-error'
    : variant === 'warning'
      ? 'hover:bg-warning/10 hover:text-warning'
      : 'hover:bg-bg-hover hover:text-text-primary';

  return (
    <button
      onClick={onClick}
      title={label}
      className={`p-1.5 rounded-md text-text-tertiary transition-colors ${colors}`}
    >
      {icon}
    </button>
  );
}
