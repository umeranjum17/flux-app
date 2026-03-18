import { useState, useRef, useEffect } from 'react';
import { Square, Eye, GitMerge, Trash2, MessageSquare, ExternalLink, ChevronDown, LoaderCircle } from 'lucide-react';
import type { Workspace, WorkspaceOperation, WorkspaceOutcome } from '../../lib/ipc-api';
import { getWorkspaceLifecycleState, workspaceLifecycleConfig, workspaceOutcomeConfig } from '../../lib/workspace-status';
import { useWorkspaceStore } from '../../stores/workspace';
import { AnimatedWorkspaceName } from './AnimatedWorkspaceName';

const outcomeOptions: WorkspaceOutcome[] = ['in_progress', 'ready_for_pr', 'ready_to_merge', 'merged', 'ready_to_archive'];

interface WorkspaceCardProps {
  workspace: Workspace;
  isActive: boolean;
  onSelect: () => void;
  onStop: () => void;
  onReview: () => void;
  onMerge: () => void;
  onDelete: () => void;
  onOpenIde: () => void;
  onArchive?: () => void;
  archiveOperation?: WorkspaceOperation;
}

export function WorkspaceCard({
  workspace,
  isActive,
  onSelect,
  onStop,
  onReview,
  onMerge,
  onDelete,
  onOpenIde,
  onArchive,
  archiveOperation,
}: WorkspaceCardProps) {
  const lifecycleState = getWorkspaceLifecycleState(workspace);
  const lifecycle = workspaceLifecycleConfig[lifecycleState] ?? workspaceLifecycleConfig.idle;
  const isRunning = workspace.status === 'running' || workspace.status === 'waiting_approval' || workspace.status === 'waiting_input';
  const isArchiving = archiveOperation?.kind === 'archive' && archiveOperation.status === 'running';

  return (
    <button
      onClick={onSelect}
      className={`group relative w-full text-left transition-colors rounded-md ${
        isActive ? 'bg-bg-hover/80' : 'hover:bg-bg-hover/50'
      }`}
    >
      <div className="flex items-center gap-2.5 px-2.5 py-[7px]">
        {/* Status dot */}
        <span className={`lifecycle-dot h-[6px] w-[6px] shrink-0 ${lifecycle.color} ${lifecycle.dotMotionClass} ${lifecycle.glow ?? ''}`} />

        {/* Name */}
        <span className="min-w-0 flex-1 truncate text-[12.5px] text-text-primary">
          <AnimatedWorkspaceName name={workspace.name} />
        </span>

        {/* Hover actions — replace status text on hover */}
        <div
          className="hidden shrink-0 items-center gap-0.5 group-hover:flex"
          onClick={(e) => e.stopPropagation()}
        >
          {isRunning && (
            <IconAction icon={<Square size={11} />} label="Stop" onClick={onStop} variant="warning" />
          )}
          <IconAction icon={<MessageSquare size={11} />} label="Chat" onClick={onSelect} />
          <IconAction icon={<ExternalLink size={11} />} label="IDE" onClick={onOpenIde} />
          <IconAction icon={<Eye size={11} />} label="Review" onClick={onReview} />
          <IconAction icon={<GitMerge size={11} />} label="Merge" onClick={onMerge} />
          {onArchive && (
            <IconAction
              icon={isArchiving ? <LoaderCircle size={11} className="animate-spin" /> : <Trash2 size={11} />}
              label={isArchiving ? archiveOperation?.message ?? 'Archiving' : 'Archive'}
              onClick={onArchive}
              variant="danger"
              disabled={isArchiving}
            />
          )}
        </div>

        {/* Status / outcome — hidden on hover when actions show */}
        <div className="flex shrink-0 items-center gap-2 group-hover:hidden" onClick={(e) => e.stopPropagation()}>
          <span className="text-[11px] text-text-tertiary/70">
            {lifecycle.label}
          </span>
          <OutcomeSelector workspaceId={workspace.id} outcome={workspace.outcome ?? 'in_progress'} />
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
        className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-medium ${config.color} opacity-60 hover:opacity-100 transition-opacity`}
      >
        {config.label}
        <ChevronDown size={8} className="opacity-50" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 min-w-[140px] rounded-lg border border-border/60 bg-bg-secondary py-0.5 shadow-lg">
          {outcomeOptions.map((opt) => {
            const optConfig = workspaceOutcomeConfig[opt];
            return (
              <button
                key={opt}
                onClick={() => handleSelect(opt)}
                className={`w-full px-3 py-1.5 text-left text-[11px] transition-colors hover:bg-bg-hover ${
                  opt === outcome ? 'font-medium' : 'font-normal'
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

function IconAction({ icon, label, onClick, variant, disabled }: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  variant?: 'danger' | 'warning';
  disabled?: boolean;
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
      disabled={disabled}
      className={`inline-flex items-center justify-center rounded-md p-1 text-text-tertiary transition-colors ${colors} ${
        disabled ? 'cursor-not-allowed opacity-60 hover:bg-transparent hover:text-text-tertiary' : ''
      }`}
    >
      {icon}
    </button>
  );
}
