import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Plus, Search, Map, Code, Eye, GitMerge, CheckCircle2 } from 'lucide-react';
import type { Workspace, WorkspaceOperation } from '../../lib/ipc-api';
import type { TaskMode } from '../../lib/types';
import { KanbanCard } from './KanbanCard';
import type { KanbanPhaseGroup } from './kanban-phases';

/** Map column drop actions to the TaskMode used when creating a task in that column. */
const COLUMN_CREATE_MODE: Record<string, TaskMode> = {
  discovery: 'discovery',
  planning: 'plan',
  'in-progress': 'act',
};

const COLUMN_EMPTY_HINTS: Record<string, { icon: typeof Search; hint: string }> = {
  discovery: { icon: Search, hint: 'Drag here or click + to explore' },
  planning: { icon: Map, hint: 'Drag here or click + to plan' },
  'in-progress': { icon: Code, hint: 'Drag here or click + to code' },
  review: { icon: Eye, hint: 'Drag tasks here for review' },
  'ready-to-merge': { icon: GitMerge, hint: 'Approved tasks land here' },
  done: { icon: CheckCircle2, hint: 'Merged & completed tasks' },
};

interface KanbanColumnProps {
  phase: KanbanPhaseGroup;
  workspaces: Workspace[];
  workspaceOperations: Map<string, WorkspaceOperation>;
  onCreateTask?: (mode?: TaskMode) => void;
  onSelectWorkspace: (ws: Workspace) => void;
  onStopWorkspace: (ws: Workspace) => void;
  onReviewWorkspace: (ws: Workspace) => void;
  onMergeWorkspace: (ws: Workspace) => void;
  onDeleteWorkspace: (ws: Workspace) => void;
  onOpenIde: (ws: Workspace) => void;
  onArchiveWorkspace: (ws: Workspace) => void;
}

export function KanbanColumn({
  phase,
  workspaces,
  workspaceOperations,
  onCreateTask,
  onSelectWorkspace,
  onStopWorkspace,
  onReviewWorkspace,
  onMergeWorkspace,
  onDeleteWorkspace,
  onOpenIde,
  onArchiveWorkspace,
}: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: phase.id });

  const workspaceIds = workspaces.map((ws) => ws.id);
  const createMode = COLUMN_CREATE_MODE[phase.id];

  return (
    <div
      ref={setNodeRef}
      className={`kanban-column ${isOver ? 'kanban-column-over' : ''}`}
    >
      {/* Column header */}
      <div className="kanban-column-header">
        <div className={`h-1 w-full rounded-t-lg ${phase.accentColor}`} />
        <div className="flex items-center justify-between px-3 py-2">
          <div className="flex items-center gap-1.5">
            <span className="text-[12px] font-semibold text-text-primary">{phase.label}</span>
            <span className={`inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[10px] font-medium ${phase.badgeClass}`}>
              {workspaces.length}
            </span>
          </div>
          {createMode && onCreateTask && (
            <button
              onClick={() => onCreateTask(createMode)}
              className="flex h-5 w-5 items-center justify-center rounded-md text-text-tertiary hover:text-text-secondary hover:bg-bg-hover transition-colors"
              title={`Create task in ${phase.label}`}
            >
              <Plus size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Column body */}
      <SortableContext items={workspaceIds} strategy={verticalListSortingStrategy}>
        <div className="flex min-h-[60px] flex-1 flex-col gap-1.5 overflow-y-auto p-2">
          {workspaces.length === 0 && (
            <div className="flex flex-1 flex-col items-center justify-center rounded-lg border border-dashed border-border/30 py-8 px-3 gap-2">
              {(() => {
                const emptyConfig = COLUMN_EMPTY_HINTS[phase.id];
                if (!emptyConfig) return <span className="text-[11px] text-text-tertiary/40">No workspaces</span>;
                const EmptyIcon = emptyConfig.icon;
                return (
                  <>
                    <EmptyIcon size={16} className="text-text-tertiary/25" />
                    <span className="text-[10px] text-text-tertiary/40 text-center leading-relaxed">{emptyConfig.hint}</span>
                  </>
                );
              })()}
            </div>
          )}
          {workspaces.map((ws) => (
            <KanbanCard
              key={ws.id}
              workspace={ws}
              onSelect={() => onSelectWorkspace(ws)}
              onStop={() => onStopWorkspace(ws)}
              onReview={() => onReviewWorkspace(ws)}
              onMerge={() => onMergeWorkspace(ws)}
              onDelete={() => onDeleteWorkspace(ws)}
              onOpenIde={() => onOpenIde(ws)}
              onArchive={() => onArchiveWorkspace(ws)}
              archiveOperation={workspaceOperations.get(ws.id)}
            />
          ))}
        </div>
      </SortableContext>
    </div>
  );
}
