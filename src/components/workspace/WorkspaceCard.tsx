import { useState, useRef, useEffect } from 'react';
import { Bot, Square, Eye, GitMerge, Trash2, MessageSquare, ExternalLink, ArchiveRestore, ChevronDown, GitBranch } from 'lucide-react';
import type { Workspace, WorkspaceOutcome } from '../../lib/ipc-api';
import { getWorkspaceLifecycleState, workspaceLifecycleConfig, workspaceOutcomeConfig } from '../../lib/workspace-status';
import { useWorkspaceStore } from '../../stores/workspace';

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
  const lifecycleState = getWorkspaceLifecycleState(workspace);
  const lifecycle = workspaceLifecycleConfig[lifecycleState] ?? workspaceLifecycleConfig.idle;
  const isRunning = workspace.status === 'running' || workspace.status === 'waiting_approval' || workspace.status === 'waiting_input';

  return (
    <button
      onClick={isArchived ? undefined : onSelect}
      className={`lifecycle-card group w-full text-left transition-all ${lifecycle.cardTint} ${
        isArchived
          ? 'lifecycle-card-archived'
          : isActive
            ? 'lifecycle-card-active'
            : ''
      }`}
    >
      {/* Left accent stripe */}
      <div className={`lifecycle-accent ${isArchived ? 'bg-text-tertiary/30' : lifecycle.accentColor} ${!isArchived && lifecycle.pulse ? 'animate-pulse' : ''}`} />

      <div className="relative px-5 py-4 pl-6">
        {/* Row 1: Name + lifecycle badge */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-[14px] font-semibold tracking-[-0.01em] text-text-primary">
              {workspace.name}
            </h3>
            <p className="mt-0.5 text-[11px] text-text-tertiary">{lifecycle.detail}</p>
          </div>

          <div className="flex shrink-0 items-center gap-2" onClick={(e) => e.stopPropagation()}>
            <span className={`lifecycle-badge ${isArchived ? 'bg-bg-secondary text-text-tertiary' : lifecycle.badgeClass}`}>
              <span className={`inline-block h-[6px] w-[6px] rounded-full ${isArchived ? 'bg-text-tertiary/50' : lifecycle.color} ${!isArchived && lifecycle.pulse ? 'animate-pulse' : ''}`} />
              {isArchived ? 'Archived' : lifecycle.label}
            </span>
            {!isArchived && <OutcomeSelector workspaceId={workspace.id} outcome={workspace.outcome ?? 'in_progress'} />}
          </div>
        </div>

        {/* Row 2: Metadata */}
        <div className="mt-2.5 flex items-center gap-3 text-[11px] text-text-tertiary">
          <span className="inline-flex items-center gap-1">
            <Bot size={11} className="opacity-60" />
            <span className="font-medium">{workspace.agentId}</span>
          </span>
          <span className="opacity-40">·</span>
          <span>{workspace.model}</span>
          <span className="opacity-40">·</span>
          <span className="inline-flex items-center gap-1">
            <GitBranch size={10} className="opacity-60" />
            <span className="font-mono">{workspace.branch}</span>
          </span>
          {isArchived && workspace.archivedAt && (
            <>
              <span className="opacity-40">·</span>
              <span>archived {new Date(workspace.archivedAt).toLocaleDateString()}</span>
            </>
          )}
        </div>

        {/* Row 3: Actions — revealed on hover */}
        <div
          className={`mt-3 flex items-center gap-1 border-t border-border/40 pt-2.5 transition-opacity ${
            isArchived ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          }`}
          onClick={(e) => e.stopPropagation()}
        >
          {isArchived ? (
            <>
              {onUnarchive && <CardAction icon={<ArchiveRestore size={13} />} label="Unarchive" onClick={onUnarchive} />}
              <CardAction icon={<Trash2 size={13} />} label="Delete" onClick={onDelete} variant="danger" />
            </>
          ) : (
            <>
              {isRunning && (
                <CardAction icon={<Square size={13} />} label="Stop" onClick={onStop} variant="warning" />
              )}
              <CardAction icon={<MessageSquare size={13} />} label="Chat" onClick={onSelect} />
              <CardAction icon={<ExternalLink size={13} />} label="Open IDE" onClick={onOpenIde} />
              <CardAction icon={<Eye size={13} />} label="Review" onClick={onReview} />
              <CardAction icon={<GitMerge size={13} />} label="Merge" onClick={onMerge} />
              <div className="flex-1" />
              {onArchive && <CardAction icon={<Trash2 size={13} />} label="Archive" onClick={onArchive} variant="danger" />}
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
        className={`lifecycle-badge items-center gap-1 ${config.color} hover:opacity-80 transition-opacity`}
      >
        {config.label}
        <ChevronDown size={10} />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1.5 min-w-[150px] rounded-xl border border-border/80 bg-bg-secondary py-1 shadow-xl">
          {outcomeOptions.map((opt) => {
            const optConfig = workspaceOutcomeConfig[opt];
            return (
              <button
                key={opt}
                onClick={() => handleSelect(opt)}
                className={`w-full px-3 py-1.5 text-left text-[11px] transition-colors hover:bg-bg-hover ${
                  opt === outcome ? 'font-semibold' : ''
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

function CardAction({ icon, label, onClick, variant }: {
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
      className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-text-tertiary transition-colors ${colors}`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
