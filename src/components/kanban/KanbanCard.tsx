import { useState, useRef, useEffect } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Square, Eye, GitMerge, Trash2, ExternalLink, ChevronDown, LoaderCircle, GitBranch, Bot, Cpu, Zap, Search, Map, Code, Building2, MessageSquare } from 'lucide-react';
import type { Workspace, WorkspaceOutcome, WorkspaceOperation } from '../../lib/ipc-api';
import { getWorkspaceLifecycleState, workspaceLifecycleConfig, workspaceOutcomeConfig } from '../../lib/workspace-status';
import type { WorkspaceLifecycleState } from '../../lib/workspace-status';
import { useWorkspaceStore } from '../../stores/workspace';
import { useAgentStore } from '../../stores/agent';
import { AnimatedWorkspaceName } from '../workspace/AnimatedWorkspaceName';
import { WorkspaceLifecycleIcon } from '../workspace/WorkspaceLifecycleIcon';
import { validOutcomeTransitions } from './kanban-phases';
import type { TaskMode } from '../../lib/types';

const outcomeIndicatorState = {
  in_progress: 'idle',
  discovered: 'discovered',
  planned: 'planned',
  ready_for_pr: 'ready_for_review',
  reviewing: 'reviewing',
  changes_requested: 'changes_requested',
  ready_to_merge: 'ready_to_merge',
  merged: 'merged',
  ready_to_archive: 'ready_to_archive',
} satisfies Record<WorkspaceOutcome, WorkspaceLifecycleState>;

const MODE_ICONS: Record<TaskMode, typeof Search> = {
  discovery: Search,
  plan: Map,
  act: Code,
  architect: Building2,
  ask: MessageSquare,
};

const MODE_COLORS: Record<TaskMode, string> = {
  discovery: 'text-warning bg-warning/12',
  plan: 'text-plan bg-plan/12',
  act: 'text-info bg-info/12',
  architect: 'text-accent bg-accent/12',
  ask: 'text-success bg-success/12',
};

const MODE_LABELS: Record<TaskMode, string> = {
  discovery: 'Discovery',
  plan: 'Plan',
  act: 'Act',
  architect: 'Architect',
  ask: 'Ask',
};

interface KanbanCardProps {
  workspace: Workspace;
  onSelect: () => void;
  onStop: () => void;
  onReview: () => void;
  onMerge: () => void;
  onDelete: () => void;
  onOpenIde: () => void;
  onArchive?: () => void;
  archiveOperation?: WorkspaceOperation;
}

export function KanbanCard({
  workspace,
  onSelect,
  onStop,
  onReview,
  onMerge,
  onDelete,
  onOpenIde,
  onArchive,
  archiveOperation,
}: KanbanCardProps) {
  const lifecycleState = getWorkspaceLifecycleState(workspace);
  const lifecycle = workspaceLifecycleConfig[lifecycleState] ?? workspaceLifecycleConfig.idle;
  const assigneeLabel = useAgentStore(
    (s) => s.agents.find((agent) => agent.id === workspace.agentId)?.name ?? workspace.agentId,
  );
  const isRunning = workspace.status === 'running' || workspace.status === 'waiting_approval' || workspace.status === 'waiting_input';
  const needsAttention = workspace.status === 'waiting_approval' || workspace.status === 'waiting_input';
  const isError = workspace.status === 'error';
  const isArchiving = archiveOperation?.kind === 'archive' && archiveOperation.status === 'running';
  const mode = workspace.mode ?? 'act';
  const ModeIcon = MODE_ICONS[mode];
  const modeColor = MODE_COLORS[mode];

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: workspace.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onSelect}
      className={`kanban-card group cursor-pointer ${lifecycle.cardTint} ${isDragging ? 'kanban-card-dragging' : ''} ${needsAttention ? 'kanban-card-attention' : ''} ${isError ? 'kanban-card-error' : ''} ${isRunning && !needsAttention ? 'kanban-card-running' : ''}`}
    >
      {/* Attention badge */}
      {needsAttention && (
        <div className="absolute -top-1.5 -right-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-warning px-1 text-[9px] font-bold text-white shadow-md ring-2 ring-bg-primary">
          {workspace.status === 'waiting_approval' ? '!' : '?'}
        </div>
      )}

      {/* Error badge */}
      {isError && !needsAttention && (
        <div className="absolute -top-1.5 -right-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-error px-1 text-[9px] font-bold text-white shadow-md ring-2 ring-bg-primary">
          !
        </div>
      )}

      {/* Header row: icon + name + mode badge */}
      <div className="flex items-center gap-2 mb-1">
        <WorkspaceLifecycleIcon state={lifecycleState} size={12} className={lifecycle.iconColor} />
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-text-primary leading-tight">
          <AnimatedWorkspaceName name={workspace.name} />
        </span>
        <span className={`inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${modeColor}`} title={`Mode: ${MODE_LABELS[mode]}`}>
          <ModeIcon size={9} />
          {MODE_LABELS[mode]}
        </span>
      </div>

      {/* Branch */}
      <div className="flex items-center gap-1.5 text-[10.5px] text-text-tertiary mb-2">
        <GitBranch size={10} className="shrink-0" />
        <span className="truncate">{workspace.branch.replace(/^flux\//, '')}</span>
      </div>

      {/* Assignee + Model row */}
      <div className="flex items-center gap-1.5 text-[10px] mb-2">
        <span className="inline-flex items-center gap-1 rounded-md bg-bg-elevated/80 px-1.5 py-[3px] text-text-secondary" title={`Agent: ${assigneeLabel}`}>
          <Bot size={10} className="shrink-0 text-text-tertiary" />
          <span className="truncate max-w-[80px]">{assigneeLabel}</span>
        </span>
        <span className="inline-flex items-center gap-1 rounded-md bg-bg-elevated/80 px-1.5 py-[3px] text-text-secondary" title={`Model: ${workspace.model}`}>
          <Cpu size={10} className="shrink-0 text-text-tertiary" />
          <span className="truncate max-w-[80px]">{shortenModelName(workspace.model)}</span>
        </span>
        {workspace.direct && (
          <span className="inline-flex items-center gap-1 rounded-md bg-warning/12 px-1.5 py-[3px] text-warning text-[9px] font-semibold">
            <Zap size={9} />
            Direct
          </span>
        )}
      </div>

      {/* Status + outcome row */}
      <div className="flex items-center justify-between pt-1.5 border-t border-border/30">
        <span className={`text-[10px] font-medium ${lifecycle.iconColor}`}>
          {lifecycle.label}
        </span>
        <div onClick={(e) => e.stopPropagation()}>
          <OutcomeSelector workspaceId={workspace.id} outcome={workspace.outcome ?? 'in_progress'} />
        </div>
      </div>

      {/* Hover actions */}
      <div
        className="absolute right-1.5 top-1.5 hidden items-center gap-0.5 rounded-lg bg-bg-secondary/95 px-1 py-0.5 shadow-md backdrop-blur-sm border border-border/30 group-hover:flex"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {isRunning && (
          <CardAction icon={<Square size={11} />} label="Stop" onClick={onStop} variant="warning" />
        )}
        <CardAction icon={<Eye size={11} />} label="Review" onClick={onReview} />
        <CardAction icon={<ExternalLink size={11} />} label="IDE" onClick={onOpenIde} />
        <CardAction icon={<GitMerge size={11} />} label="Merge" onClick={onMerge} />
        {onArchive && (
          <CardAction
            icon={isArchiving ? <LoaderCircle size={11} className="animate-spin" /> : <Trash2 size={11} />}
            label={isArchiving ? 'Archiving' : 'Archive'}
            onClick={onArchive}
            variant="danger"
            disabled={isArchiving}
          />
        )}
      </div>
    </div>
  );
}

/** Shorten long model names like "claude-sonnet-4-5-20250514" → "sonnet-4.5" */
function shortenModelName(model: string): string {
  // claude-opus-4-6 → opus-4.6, claude-sonnet-4-5-20250514 → sonnet-4.5
  const m = model.match(/^claude-(\w+)-(\d+)-(\d+)/);
  if (m) return `${m[1]}-${m[2]}.${m[3]}`;
  // o3-mini, gpt-4o, etc. — already short
  if (model.length <= 16) return model;
  // Trim datestamp suffixes: model-20250514 → model
  return model.replace(/-\d{8,}$/, '');
}

/** KanbanCard displayed in DragOverlay (no sortable hooks, just visuals) */
export function KanbanCardOverlay({ workspace }: { workspace: Workspace }) {
  const lifecycleState = getWorkspaceLifecycleState(workspace);
  const lifecycle = workspaceLifecycleConfig[lifecycleState] ?? workspaceLifecycleConfig.idle;
  const mode = workspace.mode ?? 'act';
  const ModeIcon = MODE_ICONS[mode];
  const modeColor = MODE_COLORS[mode];

  return (
    <div className={`kanban-card kanban-card-dragging ${lifecycle.cardTint}`}>
      <div className="flex items-center gap-2 mb-1">
        <WorkspaceLifecycleIcon state={lifecycleState} size={12} className={lifecycle.iconColor} />
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-text-primary leading-tight">
          {workspace.name}
        </span>
        <span className={`inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${modeColor}`}>
          <ModeIcon size={9} />
          {MODE_LABELS[mode]}
        </span>
      </div>
      <div className="flex items-center gap-1.5 text-[10.5px] text-text-tertiary mb-2">
        <GitBranch size={10} className="shrink-0" />
        <span className="truncate">{workspace.branch.replace(/^flux\//, '')}</span>
      </div>
      <div className="flex items-center gap-1.5 text-[10px]">
        <span className="inline-flex items-center gap-1 rounded-md bg-bg-elevated/80 px-1.5 py-[3px] text-text-secondary">
          <Bot size={10} className="shrink-0 text-text-tertiary" />
          <span className="truncate max-w-[80px]">{workspace.agentId}</span>
        </span>
        <span className="inline-flex items-center gap-1 rounded-md bg-bg-elevated/80 px-1.5 py-[3px] text-text-secondary">
          <Cpu size={10} className="shrink-0 text-text-tertiary" />
          <span className="truncate max-w-[80px]">{shortenModelName(workspace.model)}</span>
        </span>
      </div>
      <div className="mt-2 pt-1.5 border-t border-border/30">
        <span className={`text-[10px] font-medium ${lifecycle.iconColor}`}>{lifecycle.label}</span>
      </div>
    </div>
  );
}

function OutcomeSelector({ workspaceId, outcome }: { workspaceId: string; outcome: WorkspaceOutcome }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const config = workspaceOutcomeConfig[outcome];

  // Only show valid transitions from current state + the current state itself
  const validOptions = [outcome, ...(validOutcomeTransitions[outcome] ?? [])];

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

  // No valid transitions from this state (terminal) — show label without dropdown
  if (validOutcomeTransitions[outcome]?.length === 0) {
    return (
      <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium ${config.color} opacity-60`}>
        <WorkspaceLifecycleIcon state={outcomeIndicatorState[outcome]} size={9} className={config.color} />
        {config.label}
      </span>
    );
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        onPointerDown={(e) => e.stopPropagation()}
        className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium ${config.color} opacity-60 transition-opacity hover:opacity-100`}
      >
        <WorkspaceLifecycleIcon state={outcomeIndicatorState[outcome]} size={9} className={config.color} />
        {config.label}
        <ChevronDown size={8} className="opacity-50" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 min-w-[160px] rounded-lg border border-border/60 bg-bg-secondary py-1 shadow-xl backdrop-blur-sm">
          {validOptions.map((opt) => {
            const optConfig = workspaceOutcomeConfig[opt];
            const isCurrent = opt === outcome;
            return (
              <button
                key={opt}
                onClick={() => handleSelect(opt)}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] transition-colors hover:bg-bg-hover ${
                  isCurrent ? 'font-semibold bg-bg-hover/50' : 'font-normal'
                } ${optConfig.color}`}
              >
                <WorkspaceLifecycleIcon state={outcomeIndicatorState[opt]} size={9} className={optConfig.color} />
                {optConfig.label}
                {isCurrent && <span className="ml-auto text-[9px] text-text-tertiary">current</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CardAction({ icon, label, onClick, variant, disabled }: {
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
      onPointerDown={(e) => e.stopPropagation()}
      title={label}
      disabled={disabled}
      className={`inline-flex items-center justify-center rounded-md p-1 text-text-tertiary transition-colors ${colors} ${
        disabled ? 'cursor-not-allowed opacity-60' : ''
      }`}
    >
      {icon}
    </button>
  );
}

