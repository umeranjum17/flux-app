import { useMemo } from 'react';
import type { Workspace, WorkspaceOutcome, WorkspaceOperation } from '../../lib/ipc-api';
import { workspaceOutcomeConfig } from '../../lib/workspace-status';
import { WorkspaceCard } from './WorkspaceCard';

const KANBAN_COLUMNS: { outcome: WorkspaceOutcome; label: string }[] = [
  { outcome: 'in_progress', label: 'In Progress' },
  { outcome: 'planned', label: 'Planned' },
  { outcome: 'ready_for_pr', label: 'Ready for Review' },
  { outcome: 'ready_to_merge', label: 'Ready to Merge' },
  { outcome: 'merged', label: 'Merged' },
];

interface KanbanBoardProps {
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  workspaceOperations: Map<string, WorkspaceOperation>;
  onSelect: (ws: Workspace) => void;
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
  onStop,
  onReview,
  onMerge,
  onDelete,
  onOpenIde,
  onArchive,
}: KanbanBoardProps) {
  const columns = useMemo(() => {
    const grouped = new Map<WorkspaceOutcome, Workspace[]>();
    for (const col of KANBAN_COLUMNS) {
      grouped.set(col.outcome, []);
    }
    for (const ws of workspaces) {
      const outcome = ws.outcome ?? 'in_progress';
      const list = grouped.get(outcome);
      if (list) {
        list.push(ws);
      } else {
        // Fall back to in_progress for outcomes not in columns (reviewing, changes_requested, ready_to_archive)
        grouped.get('in_progress')!.push(ws);
      }
    }
    return KANBAN_COLUMNS.map((col) => ({
      ...col,
      workspaces: grouped.get(col.outcome) ?? [],
    }));
  }, [workspaces]);

  return (
    <div className="flex h-full gap-4 overflow-x-auto px-6 py-5">
      {columns.map((col) => {
        const cfg = workspaceOutcomeConfig[col.outcome];
        return (
          <div
            key={col.outcome}
            className="flex w-[280px] min-w-[280px] flex-col rounded-xl border border-border/50 bg-bg-elevated/30"
          >
            <div className="flex items-center gap-2 border-b border-border/40 px-4 py-3">
              <span className={`h-2 w-2 rounded-full ${cfg.color.replace('text-', 'bg-')}`} />
              <span className="text-xs font-medium text-text-secondary">{col.label}</span>
              <span className="ml-auto text-[11px] text-text-tertiary">{col.workspaces.length}</span>
            </div>
            <div className="flex-1 space-y-px overflow-y-auto p-2">
              {col.workspaces.length === 0 ? (
                <div className="flex h-20 items-center justify-center text-[11px] text-text-tertiary/50">
                  No workspaces
                </div>
              ) : (
                col.workspaces.map((ws) => (
                  <WorkspaceCard
                    key={ws.id}
                    workspace={ws}
                    isActive={ws.id === activeWorkspaceId}
                    onSelect={() => onSelect(ws)}
                    onStop={() => onStop(ws)}
                    onReview={() => onReview(ws)}
                    onMerge={() => onMerge(ws)}
                    onDelete={() => onDelete(ws)}
                    onOpenIde={() => onOpenIde(ws)}
                    onArchive={() => onArchive(ws)}
                    archiveOperation={workspaceOperations.get(ws.id)}
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
