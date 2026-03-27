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

interface KanbanColumn {
  outcome: WorkspaceOutcome;
  label: string;
}

interface KanbanGroup {
  id: string;
  label: string;
  columns: KanbanColumn[];
}

const KANBAN_GROUPS: KanbanGroup[] = [
  {
    id: 'backlog',
    label: 'Backlog',
    columns: [
      { outcome: 'discovery', label: 'Discovery' },
      { outcome: 'planned', label: 'Planned' },
    ],
  },
  {
    id: 'active',
    label: 'Active',
    columns: [
      { outcome: 'in_progress', label: 'In Progress' },
      { outcome: 'ready_for_pr', label: 'Ready for Review' },
    ],
  },
  {
    id: 'review',
    label: 'Review',
    columns: [
      { outcome: 'reviewing', label: 'Reviewing' },
      { outcome: 'changes_requested', label: 'Changes Requested' },
      { outcome: 'ready_to_merge', label: 'Ready to Merge' },
    ],
  },
  {
    id: 'done',
    label: 'Done',
    columns: [
      { outcome: 'merged', label: 'Merged' },
      { outcome: 'ready_to_archive', label: 'Archive' },
    ],
  },
];

const ALL_COLUMNS = KANBAN_GROUPS.flatMap((g) => g.columns);

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
    const byOutcome = new Map<WorkspaceOutcome, Workspace[]>();
    for (const col of ALL_COLUMNS) {
      byOutcome.set(col.outcome, []);
    }
    for (const ws of workspaces) {
      const outcome = ws.outcome ?? 'in_progress';
      const list = byOutcome.get(outcome);
      if (list) {
        list.push(ws);
      } else {
        byOutcome.get('in_progress')!.push(ws);
      }
    }
    return byOutcome;
  }, [workspaces]);

  return (
    <div className="flex h-full gap-4 overflow-x-auto px-6 py-5">
      {KANBAN_GROUPS.map((group) => {
        const groupCount = group.columns.reduce(
          (sum, col) => sum + (grouped.get(col.outcome)?.length ?? 0),
          0,
        );
        return (
          <div key={group.id} className="flex flex-col gap-0">
            {/* Group header */}
            <div className="mb-2 flex items-center gap-2 px-1">
              <span className="text-[10px] font-bold uppercase tracking-widest text-text-tertiary/50">
                {group.label}
              </span>
              {groupCount > 0 && (
                <span className="inline-flex h-[16px] min-w-[16px] items-center justify-center rounded-full bg-bg-secondary px-1 text-[9px] font-medium text-text-tertiary">
                  {groupCount}
                </span>
              )}
            </div>
            {/* Columns inside the group */}
            <div className="flex flex-1 gap-2">
              {group.columns.map((col) => {
                const colWorkspaces = grouped.get(col.outcome) ?? [];
                const cfg = workspaceOutcomeConfig[col.outcome];
                const accentBg = cfg.color.replace('text-', 'bg-');
                return (
                  <div
                    key={col.outcome}
                    className="flex w-[248px] min-w-[248px] flex-col rounded-xl bg-bg-secondary/40"
                  >
                    {/* Column header */}
                    <div className="flex items-center gap-2.5 px-3.5 pb-2.5 pt-3.5">
                      <span className={`h-2 w-2 rounded-full ${accentBg}`} />
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
                        {col.label}
                      </span>
                      {colWorkspaces.length > 0 && (
                        <span className={`ml-auto inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-medium ${accentBg}/12 ${cfg.color}`}>
                          {colWorkspaces.length}
                        </span>
                      )}
                    </div>

                    {/* Cards */}
                    <div className="flex-1 space-y-2 overflow-y-auto px-2 pb-3">
                      {colWorkspaces.length === 0 ? (
                        <div className="flex h-20 items-center justify-center rounded-lg border border-dashed border-border/30">
                          <span className="text-[11px] text-text-tertiary/40">Empty</span>
                        </div>
                      ) : (
                        colWorkspaces.map((ws) => (
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

        {/* Project + mode */}
        <div className="mt-2 flex items-center gap-2">
          <span className="inline-flex items-center gap-1 text-[10px] text-text-tertiary">
            {workspace.sshHost ? (
              <Wifi size={9} className={`shrink-0 ${sshAvailable ? 'text-accent' : 'text-warning'}`} />
            ) : (
              <FolderOpen size={9} className="shrink-0 opacity-50" />
            )}
            <span className="truncate max-w-[120px]">{projectName}</span>
          </span>
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
