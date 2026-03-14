import { useState, useRef, useEffect } from 'react';
import { Bot, Square, Eye, GitMerge, Trash2, MessageSquare, ExternalLink, Archive, ArchiveRestore, ChevronDown } from 'lucide-react';
import type { Workspace, WorkspaceStatus, WorkspaceOutcome } from '../../lib/ipc-api';
import { workspaceOutcomeConfig } from '../../lib/workspace-status';
import { useWorkspaceStore } from '../../stores/workspace';

const statusConfig: Record<WorkspaceStatus, { color: string; label: string; pulse?: boolean }> = {
  idle: { color: 'bg-text-tertiary', label: 'Idle' },
  running: { color: 'bg-success', label: 'Running', pulse: true },
  waiting_approval: { color: 'bg-warning', label: 'Waiting', pulse: true },
  waiting_input: { color: 'bg-text-tertiary', label: 'Question', pulse: true },
  done: { color: 'bg-success', label: 'Done' },
  error: { color: 'bg-error', label: 'Error' },
  merging: { color: 'bg-success', label: 'Merging', pulse: true },
};

const outcomeOptions: WorkspaceOutcome[] = ['in_progress', 'ready_for_pr', 'ready_to_merge', 'merged', 'ready_to_archive'];

interface WorkspaceCardProps {
  workspace: Workspace;
  isActive: boolean;
  isArchived?: boolean;
  onSelect: () => void;
  onStop: () => void;
  onReview: () => void;
  onMerge: () => void;
  onDelete: () => void;
  onOpenIde: () => void;
  onArchive?: () => void;
  onUnarchive?: () => void;
}

export function WorkspaceCard({
  workspace,
  isActive,
  isArchived,
  onSelect,
  onStop,
  onReview,
  onMerge,
  onDelete,
  onOpenIde,
  onArchive,
  onUnarchive,
}: WorkspaceCardProps) {
  const status = statusConfig[workspace.status] ?? statusConfig.idle;
  const isRunning = workspace.status === 'running' || workspace.status === 'waiting_approval' || workspace.status === 'waiting_input';
  const outcome = workspaceOutcomeConfig[workspace.outcome ?? 'in_progress'];

  return (
    <button
      onClick={isArchived ? undefined : onSelect}
      className={`w-full rounded-[22px] border px-5 py-4 text-left transition-colors ${
        isArchived
          ? 'border-border/50 bg-bg-secondary/50 opacity-70'
          : isActive
            ? 'border-border bg-bg-elevated/60 shadow-[0_18px_34px_rgba(0,0,0,0.2)]'
            : 'border-border/80 bg-bg-secondary/88 hover:border-border-focus/40 hover:bg-bg-hover/60'
      }`}
    >
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${isArchived ? 'bg-text-tertiary/50' : status.color} ${!isArchived && status.pulse ? 'animate-pulse' : ''}`} />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium tracking-[0.01em] text-text-primary">{workspace.name}</div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-text-tertiary">
              <span className="inline-flex items-center gap-1">
                <Bot size={11} />
                {workspace.agentId}
              </span>
              <span>{workspace.model}</span>
              <span>{workspace.branch}</span>
              {isArchived && workspace.archivedAt && (
                <span>archived {new Date(workspace.archivedAt).toLocaleDateString()}</span>
              )}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2" onClick={(e) => e.stopPropagation()}>
          <span className="premium-pill px-2.5 py-1 text-[10px] font-medium text-text-tertiary">
            {isArchived ? 'Archived' : status.label}
          </span>
          {!isArchived && <OutcomeSelector workspaceId={workspace.id} outcome={workspace.outcome ?? 'in_progress'} />}
        </div>
        <div className="ml-auto flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
        {isArchived ? (
          <>
            {onUnarchive && <ActionButton icon={<ArchiveRestore size={12} />} label="Unarchive" onClick={onUnarchive} />}
            <ActionButton icon={<Trash2 size={12} />} label="Delete" onClick={onDelete} variant="danger" />
          </>
        ) : (
          <>
            {isRunning && (
              <ActionButton icon={<Square size={12} />} label="Stop" onClick={onStop} variant="warning" />
            )}
            <ActionButton icon={<MessageSquare size={12} />} label="Chat" onClick={onSelect} />
            <ActionButton icon={<ExternalLink size={12} />} label="Open IDE" onClick={onOpenIde} />
            <ActionButton icon={<Eye size={12} />} label="Review" onClick={onReview} />
            <ActionButton icon={<GitMerge size={12} />} label="Merge" onClick={onMerge} />
            {onArchive && <ActionButton icon={<Archive size={12} />} label="Archive" onClick={onArchive} />}
            <ActionButton icon={<Trash2 size={12} />} label="Delete" onClick={onDelete} variant="danger" />
          </>
        )}
        </div>
      </div>
    </button>
  );
}

function OutcomeSelector({ workspaceId, outcome }: { workspaceId: string; outcome: WorkspaceOutcome }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const config = workspaceOutcomeConfig[outcome];

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleSelect = (next: WorkspaceOutcome) => {
    setOpen(false);
    if (next !== outcome) {
      useWorkspaceStore.getState().setOutcome(workspaceId, next);
    }
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`premium-pill inline-flex items-center gap-1 px-2.5 py-1 text-[10px] font-medium ${config.color} hover:opacity-80 transition-opacity`}
      >
        {config.label}
        <ChevronDown size={10} />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 min-w-[140px] rounded-xl border border-border/80 bg-bg-secondary py-1 shadow-lg">
          {outcomeOptions.map((opt) => {
            const optConfig = workspaceOutcomeConfig[opt];
            return (
              <button
                key={opt}
                onClick={() => handleSelect(opt)}
                className={`w-full px-3 py-1.5 text-left text-[11px] transition-colors hover:bg-bg-hover ${
                  opt === outcome ? 'font-medium' : ''
                } ${optConfig.color}`}
              >
                {optConfig.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
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
      className={`premium-toolbar-button rounded-xl p-2 text-text-tertiary transition-colors ${colors}`}
    >
      {icon}
    </button>
  );
}
