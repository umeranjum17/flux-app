import { useMemo } from 'react';
import { Square, Eye, GitMerge, Trash2, MessageSquare, ExternalLink, LoaderCircle, FolderOpen, Wifi } from 'lucide-react';
import type { Workspace, WorkspaceOutcome, WorkspaceOperation } from '../../lib/ipc-api';
import { workspaceOutcomeConfig, getWorkspaceLifecycleState, workspaceLifecycleConfig } from '../../lib/workspace-status';
import { AnimatedWorkspaceName } from './AnimatedWorkspaceName';
import { WorkspaceLifecycleIcon } from './WorkspaceLifecycleIcon';
import { useWorkspaceHasChanges } from '../../hooks/useWorkspaceHasChanges';
import {
  getWorkspaceIdeTitle,
  isWorkspaceSshAvailable,
  workspaceOutcomeImpliesChanges,
} from '../../lib/workspace-state';

interface KanbanLane {
  id: string;
  label: string;
  outcomes: WorkspaceOutcome[];
  /** Color token used for the accent dot and badge (first outcome's config is used). */
  color: string;
}

const KANBAN_LANES: KanbanLane[] = [
  {
    id: 'think',
    label: 'Think',
    outcomes: ['discovery', 'planned'],
    color: 'text-accent',
  },
  {
    id: 'build',
    label: 'Build',
    outcomes: ['in_progress'],
    color: 'text-info',
  },
  {
    id: 'review',
    label: 'Review',
    outcomes: ['ready_for_pr', 'reviewing', 'changes_requested'],
    color: 'text-plan',
  },
  {
    id: 'ship',
    label: 'Ship',
    outcomes: ['ready_to_merge', 'merged', 'ready_to_archive'],
    color: 'text-success',
  },
];

const ALL_OUTCOMES = KANBAN_LANES.flatMap((l) => l.outcomes);

interface KanbanBoardProps {
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  workspaceOperations: Map<string, WorkspaceOperation>;
  onSelect: (ws: Workspace) => void;
  onOpenDetail: (ws: Workspace) => void;
  onStop: (ws: Workspace) => void;
  onReview: (ws: Workspace) => void;
  onMerge: (ws: Workspace) => void;
  onDelete: (ws: Workspace) => void;
  onOpenIde: (ws: Workspace) => void;
  onArchive: (ws: Workspace) => void;
}

export function KanbanBoard({
  workspaces,
  activeWorkspaceId,
  workspaceOperations,
  onSelect,
  onOpenDetail,
  onStop,
  onReview,
  onMerge,
  onDelete,
  onOpenIde,
  onArchive,
}: KanbanBoardProps) {
  const grouped = useMemo(() => {
    const byLane = new Map<string, Workspace[]>();
    for (const lane of KANBAN_LANES) {
      byLane.set(lane.id, []);
    }
    // Build a quick outcome → lane lookup
    const outcomeLane = new Map<WorkspaceOutcome, string>();
    for (const lane of KANBAN_LANES) {
      for (const o of lane.outcomes) {
        outcomeLane.set(o, lane.id);
      }
    }
    for (const ws of workspaces) {
      const outcome = ws.outcome ?? 'in_progress';
      const laneId = outcomeLane.get(outcome) ?? 'build';
      byLane.get(laneId)!.push(ws);
    }
    return byLane;
  }, [workspaces]);

  return (
    <div className="flex h-full gap-4 overflow-x-auto px-6 py-5">
      {KANBAN_LANES.map((lane) => {
        const laneWorkspaces = grouped.get(lane.id) ?? [];
        const accentBg = lane.color.replace('text-', 'bg-');
        return (
          <div
            key={lane.id}
            className="flex w-[280px] min-w-[280px] flex-col rounded-xl bg-bg-secondary/40"
          >
            {/* Lane header */}
            <div className="flex items-center gap-2.5 px-3.5 pb-2.5 pt-3.5">
              <span className={`h-2 w-2 rounded-full ${accentBg}`} />
              <span className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
                {lane.label}
              </span>
              {laneWorkspaces.length > 0 && (
                <span className={`ml-auto inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-medium ${accentBg}/12 ${lane.color}`}>
                  {laneWorkspaces.length}
                </span>
              )}
            </div>

            {/* Cards */}
            <div className="flex-1 space-y-2 overflow-y-auto px-2 pb-3">
              {laneWorkspaces.length === 0 ? (
                <div className="flex h-20 items-center justify-center rounded-lg border border-dashed border-border/30">
                  <span className="text-[11px] text-text-tertiary/40">Empty</span>
                </div>
              ) : (
                laneWorkspaces.map((ws) => (
                  <KanbanCard
                    key={ws.id}
                    workspace={ws}
                    isActive={ws.id === activeWorkspaceId}
                    archiveOperation={workspaceOperations.get(ws.id)}
                    onSelect={() => onOpenDetail(ws)}
                    onChat={() => onSelect(ws)}
                    onStop={() => onStop(ws)}
                    onReview={() => onReview(ws)}
                    onMerge={() => onMerge(ws)}
                    onDelete={() => onDelete(ws)}
                    onOpenIde={() => onOpenIde(ws)}
                    onArchive={() => onArchive(ws)}
                  />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function KanbanCard({
  workspace,
  isActive,
  archiveOperation,
  onSelect,
  onChat,
  onStop,
  onReview,
  onMerge,
  onDelete,
  onOpenIde,
  onArchive,
}: {
  workspace: Workspace;
  isActive: boolean;
  archiveOperation?: WorkspaceOperation;
  onSelect: () => void;
  onChat: () => void;
  onStop: () => void;
  onReview: () => void;
  onMerge: () => void;
  onDelete: () => void;
  onOpenIde: () => void;
  onArchive: () => void;
}) {
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
  const ideDisabled = !!workspace.sshHost;

  const projectName = workspace.parentRepo.split('/').pop() ?? workspace.parentRepo;

  return (
    <button
      onClick={onSelect}
      className={`group relative w-full rounded-lg border text-left transition-all ${
        isActive
          ? 'border-accent/40 bg-bg-primary shadow-sm shadow-accent/5'
          : 'border-border/40 bg-bg-primary/80 hover:border-border/60 hover:shadow-sm'
      }`}
    >
      {/* Card body */}
      <div className="px-3 pb-2.5 pt-3">
        {/* Status + name */}
        <div className="flex items-start gap-2">
          <span className="mt-0.5 shrink-0">
            <WorkspaceLifecycleIcon state={lifecycleState} size={12} className={lifecycle.iconColor} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12px] font-medium leading-snug text-text-primary">
              <AnimatedWorkspaceName name={workspace.name} />
            </div>
          </div>
        </div>

        {/* Project + outcome + mode */}
        <div className="mt-2 flex items-center gap-2">
          <span className="inline-flex items-center gap-1 text-[10px] text-text-tertiary">
            {workspace.sshHost ? (
              <Wifi size={9} className={`shrink-0 ${sshAvailable ? 'text-accent' : 'text-warning'}`} />
            ) : (
              <FolderOpen size={9} className="shrink-0 opacity-50" />
            )}
            <span className="truncate max-w-[120px]">{projectName}</span>
          </span>
          {workspace.outcome && (
            <span className={`rounded-full border border-current/15 px-1.5 py-0.5 text-[9px] font-medium ${workspaceOutcomeConfig[workspace.outcome].color}`}>
              {workspaceOutcomeConfig[workspace.outcome].label}
            </span>
          )}
          {workspace.direct && (
            <span className="rounded-full border border-warning/20 bg-warning/8 px-1.5 py-0.5 text-[9px] font-medium text-warning">
              Direct
            </span>
          )}
        </div>
      </div>

      {/* Action bar — visible on hover */}
      <div
        className="flex items-center justify-end gap-0.5 border-t border-border/30 px-2 py-1.5 opacity-0 transition-opacity group-hover:opacity-100"
        onClick={(e) => e.stopPropagation()}
      >
        {isRunning && (
          <KanbanAction icon={<Square size={11} />} label="Stop" onClick={onStop} variant="warning" />
        )}
        <KanbanAction icon={<MessageSquare size={11} />} label="Chat" onClick={onChat} />
        <KanbanAction
          icon={<ExternalLink size={11} />}
          label={getWorkspaceIdeTitle(workspace)}
          onClick={onOpenIde}
          disabled={ideDisabled}
        />
        <KanbanAction
          icon={<Eye size={11} />}
          label="Review"
          onClick={onReview}
          disabled={!canReview}
        />
        <KanbanAction
          icon={<GitMerge size={11} />}
          label="Merge"
          onClick={onMerge}
          disabled={!canReview}
        />
        {onArchive && (
          <KanbanAction
            icon={isArchiving ? <LoaderCircle size={11} className="animate-spin" /> : <Trash2 size={11} />}
            label={isArchiving ? 'Archiving' : 'Archive'}
            onClick={onArchive}
            variant="danger"
            disabled={isArchiving}
          />
        )}
      </div>
    </button>
  );
}

function KanbanAction({ icon, label, onClick, variant, disabled }: {
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
        disabled ? 'cursor-not-allowed opacity-40' : ''
      }`}
    >
      {icon}
    </button>
  );
}
