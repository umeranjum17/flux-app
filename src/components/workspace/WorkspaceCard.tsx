import { useState, useRef, useEffect } from 'react';
import { Square, Eye, GitMerge, Trash2, MessageSquare, ExternalLink, ChevronDown, LoaderCircle, FolderOpen, Wifi } from 'lucide-react';
import type { Workspace, WorkspaceOperation, WorkspaceOutcome } from '../../lib/ipc-api';
import { getWorkspaceLifecycleState, workspaceLifecycleConfig, workspaceOutcomeConfig } from '../../lib/workspace-status';
import type { WorkspaceLifecycleState } from '../../lib/workspace-status';
import { useWorkspaceStore } from '../../stores/workspace';
import { AnimatedWorkspaceName } from './AnimatedWorkspaceName';
import { WorkspaceLifecycleIcon } from './WorkspaceLifecycleIcon';
import { useWorkspaceHasChanges } from '../../hooks/useWorkspaceHasChanges';
import {
  getWorkspaceIdeTitle,
  isWorkspaceSshAvailable,
  workspaceOutcomeImpliesChanges,
} from '../../lib/workspace-state';

const outcomeOptions: WorkspaceOutcome[] = ['backlog', 'discovery', 'in_progress', 'planned', 'ready_for_pr', 'reviewing', 'changes_requested', 'ready_to_merge', 'merged', 'ready_to_archive'];
const outcomeIndicatorState = {
  backlog: 'backlog',
  discovery: 'discovery',
  in_progress: 'idle',
  planned: 'planned',
  ready_for_pr: 'ready_for_review',
  reviewing: 'reviewing',
  changes_requested: 'changes_requested',
  ready_to_merge: 'ready_to_merge',
  merged: 'merged',
  ready_to_archive: 'ready_to_archive',
} satisfies Record<WorkspaceOutcome, WorkspaceLifecycleState>;

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
  const sshAvailable = isWorkspaceSshAvailable(workspace);
  const outcomeImpliesChanges = workspaceOutcomeImpliesChanges(workspace.outcome);
  const hasChanges = useWorkspaceHasChanges(workspace.id, {
    fallback: outcomeImpliesChanges,
    pollMs: isActive ? 4000 : null,
  });
  const canReview = hasChanges && !isArchiving;
  const ideDisabled = !!workspace.host;
  const sourceBadgeClass = workspace.host
    ? (sshAvailable
        ? 'border-accent/20 bg-accent/8 text-accent'
        : 'border-warning/20 bg-warning/10 text-warning')
    : 'border-border/60 bg-bg-primary/60 text-text-secondary';
  const sourceLabel = workspace.host
    ? (sshAvailable ? 'SSH project' : 'SSH disconnected')
    : 'Local project';
  const reviewTitle = canReview ? 'Review changes' : 'No workspace changes to review yet';
  const mergeTitle = canReview ? 'Merge workspace' : 'Review changes before merging this workspace';

  return (
    <button
      onClick={onSelect}
      className={`group relative w-full text-left transition-colors rounded-md ${
        isActive ? 'bg-bg-hover/80' : 'hover:bg-bg-hover/50'
      }`}
    >
      <div className="flex items-center gap-2.5 px-2.5 py-[7px]">
        {/* Status icon */}
        <span className="shrink-0">
          <WorkspaceLifecycleIcon state={lifecycleState} size={13} className={lifecycle.iconColor} />
        </span>

        {/* Name */}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12.5px] text-text-primary">
            <AnimatedWorkspaceName name={workspace.name} />
          </div>
          {workspace.direct && (
            <div className="mt-1 flex items-center gap-1.5 text-[10px]">
              <span className="rounded-full border border-warning/20 bg-warning/8 px-2 py-0.5 font-medium text-warning">
                Direct mode
              </span>
            </div>
          )}
        </div>

        {/* Hover actions — replace status text on hover */}
        <div
          className="hidden shrink-0 items-center gap-0.5 group-hover:flex"
          onClick={(e) => e.stopPropagation()}
        >
          {isRunning && (
            <IconAction icon={<Square size={11} />} label="Stop" onClick={onStop} variant="warning" />
          )}
          <IconAction icon={<MessageSquare size={11} />} label="Chat" onClick={onSelect} />
          <IconAction
            icon={<ExternalLink size={11} />}
            label="IDE"
            title={getWorkspaceIdeTitle(workspace)}
            onClick={onOpenIde}
            disabled={ideDisabled}
          />
          <IconAction
            icon={<Eye size={11} />}
            label="Review"
            title={reviewTitle}
            onClick={onReview}
            disabled={!canReview}
          />
          <IconAction
            icon={<GitMerge size={11} />}
            label="Merge"
            title={mergeTitle}
            onClick={onMerge}
            disabled={!canReview}
          />
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
      <div className="flex items-center gap-1.5 px-2.5 pb-[7px] text-[11px] text-text-tertiary">
        {workspace.host ? (
          <Wifi size={11} className={`shrink-0 ${sshAvailable ? 'text-accent' : 'text-warning'}`} />
        ) : (
          <FolderOpen size={11} className="shrink-0 opacity-60" />
        )}
        <span className="truncate">
          {workspace.host
            ? `${workspace.host} · ${workspace.parentRepo}`
            : workspace.parentRepo}
        </span>
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
        className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium ${config.color} opacity-60 transition-opacity hover:opacity-100`}
      >
        <WorkspaceLifecycleIcon state={outcomeIndicatorState[outcome]} size={10} className={config.color} />
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
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] transition-colors hover:bg-bg-hover ${
                  opt === outcome ? 'font-medium' : 'font-normal'
                } ${optConfig.color}`}
              >
                <WorkspaceLifecycleIcon state={outcomeIndicatorState[opt]} size={10} className={optConfig.color} />
                {optConfig.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function IconAction({ icon, label, onClick, variant, disabled, title }: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  variant?: 'danger' | 'warning';
  disabled?: boolean;
  title?: string;
}) {
  const colors = variant === 'danger'
    ? 'hover:bg-error/10 hover:text-error'
    : variant === 'warning'
      ? 'hover:bg-warning/10 hover:text-warning'
      : 'hover:bg-bg-hover hover:text-text-primary';

  return (
    <button
      onClick={onClick}
      title={title ?? label}
      disabled={disabled}
      className={`inline-flex items-center justify-center rounded-md p-1 text-text-tertiary transition-colors ${colors} ${
        disabled ? 'cursor-not-allowed opacity-60 hover:bg-transparent hover:text-text-tertiary' : ''
      }`}
    >
      {icon}
    </button>
  );
}
