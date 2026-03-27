import { useState, useMemo, useCallback } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import { Plus } from 'lucide-react';
import { useWorkspaceStore } from '../../stores/workspace';
import { useAgentStore } from '../../stores/agent';
import { useChatStore } from '../../stores/chat';
import { getWorkspaceLifecycleState } from '../../lib/workspace-status';
import { startWorkspaceChat } from '../../lib/workspace-state';
import type { Workspace } from '../../lib/ipc-api';
import type { AgentId, TaskMode } from '../../lib/types';
import { archiveWorkspace } from '../../lib/workspace-operations';
import { toast } from 'sonner';
import { KanbanColumn } from './KanbanColumn';
import { KanbanCardOverlay } from './KanbanCard';
import { KanbanActionDialog } from './KanbanActionDialog';
import { MergeDialog } from '../review/MergeDialog';
import {
  KANBAN_PHASES,
  getPhaseForLifecycleState,
  isDropAllowed,
  type KanbanDropAction,
  type KanbanPhaseGroup,
} from './kanban-phases';

interface KanbanBoardProps {
  parentRepo: string;
  projectName: string;
  onCreateWorkspace: () => void;
  onCreateWithMode?: (mode?: TaskMode) => void;
  onSelectWorkspace: (ws: Workspace) => void;
}

interface PendingAction {
  workspace: Workspace;
  action: Exclude<KanbanDropAction, 'review' | 'merge'>;
}

export function KanbanBoard({ parentRepo, projectName, onCreateWorkspace, onCreateWithMode, onSelectWorkspace }: KanbanBoardProps) {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const workspaceOperations = useWorkspaceStore((s) => s.workspaceOperations);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [mergingWorkspace, setMergingWorkspace] = useState<Workspace | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  // Group workspaces by column
  const columnWorkspaces = useMemo(() => {
    const repoWorkspaces = Array.from(workspaces.values()).filter(
      (ws) => ws.parentRepo === parentRepo,
    );

    const groups = new Map<string, Workspace[]>();
    for (const phase of KANBAN_PHASES) {
      groups.set(phase.id, []);
    }

    for (const ws of repoWorkspaces) {
      const state = getWorkspaceLifecycleState(ws);
      const phase = getPhaseForLifecycleState(state);
      if (phase) {
        groups.get(phase.id)!.push(ws);
      } else {
        // Fallback to "in-progress"
        groups.get('in-progress')!.push(ws);
      }
    }

    // Sort by updatedAt within each column
    for (const [key, list] of groups) {
      groups.set(key, list.sort((a, b) => b.updatedAt - a.updatedAt));
    }

    return groups;
  }, [workspaces, parentRepo]);

  const activeWorkspace = activeId ? workspaces.get(activeId) ?? null : null;

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setActiveId(null);

    const { active, over } = event;
    if (!over) return;

    const workspaceId = active.id as string;
    const ws = workspaces.get(workspaceId);
    if (!ws) return;

    // Determine target column
    const targetPhase = KANBAN_PHASES.find((p) => p.id === over.id);
    if (!targetPhase) return;

    // Check current column — same column is a no-op
    const currentState = getWorkspaceLifecycleState(ws);
    const currentPhase = getPhaseForLifecycleState(currentState);
    if (currentPhase?.id === targetPhase.id) return;

    const currentOutcome = ws.outcome ?? 'in_progress';

    // Validate the drop
    if (!isDropAllowed(currentOutcome, targetPhase)) {
      toast.error(`Cannot move from "${currentOutcome.replace(/_/g, ' ')}" to "${targetPhase.label}"`);
      return;
    }

    // Handle the drop based on the target column's action
    handleDropAction(ws, targetPhase);
  }, [workspaces]);

  const handleDropAction = useCallback((ws: Workspace, targetPhase: KanbanPhaseGroup) => {
    const action = targetPhase.dropAction;
    const isRunning = ws.status === 'running' || ws.status === 'merging' || ws.status === 'waiting_approval' || ws.status === 'waiting_input';

    switch (action) {
      case 'discover':
      case 'plan':
      case 'code': {
        if (isRunning) {
          toast.error('Stop the workspace first before starting a new task');
          return;
        }
        setPendingAction({ workspace: ws, action });
        break;
      }
      case 'merge': {
        if (isRunning) {
          toast.error('Stop the workspace first before merging');
          return;
        }
        if (ws.direct) {
          toast.error('Direct workspaces cannot be merged');
          return;
        }
        setMergingWorkspace(ws);
        break;
      }
      case 'review': {
        // Set outcome to ready_for_pr and open the changes panel
        useWorkspaceStore.getState().setOutcome(ws.id, targetPhase.dropOutcome);
        useWorkspaceStore.getState().toggleChangesPanel(ws.id);
        break;
      }
      default: {
        // Pure outcome transition (e.g. Ready to Merge)
        const targetOutcome = targetPhase.dropOutcome;
        if ((ws.outcome ?? 'in_progress') !== targetOutcome) {
          useWorkspaceStore.getState().setOutcome(ws.id, targetOutcome);
        }
        break;
      }
    }
  }, []);

  const handleActionSubmit = useCallback(async (prompt: string) => {
    if (!pendingAction) return;
    const { workspace, action } = pendingAction;
    setPendingAction(null);

    const modeMap: Record<typeof action, TaskMode> = {
      discover: 'discovery',
      plan: 'plan',
      code: 'act',
    };

    const agentStore = useAgentStore.getState();
    const agentId = (workspace.agentId ?? agentStore.selectedAgentId) as AgentId;
    const model = workspace.model ?? agentStore.selectedModel;
    const thinking = workspace.thinking ?? agentStore.selectedThinking;

    try {
      await startWorkspaceChat({
        workspace,
        prompt,
        agentId,
        model,
        mode: modeMap[action],
        thinking,
      });
      toast.success(`Started ${action} on "${workspace.name}"`);
    } catch (err: any) {
      toast.error(err.message ?? `Failed to start ${action}`);
    }
  }, [pendingAction]);

  const handleDragCancel = useCallback(() => {
    setActiveId(null);
  }, []);

  const handleStop = useCallback(async (ws: Workspace) => {
    await window.api.invoke('workspace:stop', { workspaceId: ws.id });
    const chatStore = useChatStore.getState();
    for (const task of chatStore.tasks.values()) {
      if (task.workspaceId === ws.id) {
        chatStore.setTaskStatus(task.id, 'done');
      }
    }
  }, []);

  const handleDelete = useCallback(async (ws: Workspace) => {
    // Confirm before deleting — this is destructive and irreversible
    const confirmed = await new Promise<boolean>((resolve) => {
      toast(`Delete workspace "${ws.name}"?`, {
        description: 'This will remove the workspace and its git worktree. This cannot be undone.',
        action: { label: 'Delete', onClick: () => resolve(true) },
        cancel: { label: 'Cancel', onClick: () => resolve(false) },
        onDismiss: () => resolve(false),
        duration: 10000,
      });
    });
    if (!confirmed) return;

    await window.api.invoke('workspace:delete', { workspaceId: ws.id });
    useWorkspaceStore.getState().removeWorkspace(ws.id);
    const chatStore = useChatStore.getState();
    for (const task of [...chatStore.tasks.values()]) {
      if (task.workspaceId === ws.id) {
        chatStore.removeTask(task.id);
      }
    }
  }, []);

  const handleArchive = useCallback(async (ws: Workspace) => {
    try {
      await archiveWorkspace(ws.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to archive workspace');
    }
  }, []);

  const handleOpenIde = useCallback(async (ws: Workspace) => {
    await window.api.invoke('workspace:open-ide', { workspaceId: ws.id });
  }, []);

  const handleReview = useCallback((ws: Workspace) => {
    useWorkspaceStore.getState().toggleChangesPanel(ws.id);
  }, []);

  const handleMerge = useCallback((ws: Workspace) => {
    if (ws.direct) {
      toast.error('Direct workspaces cannot be merged');
      return;
    }
    setMergingWorkspace(ws);
  }, []);

  return (
    <div className="flex flex-col">
      {/* Board header */}
      <div className="flex items-center justify-between px-4 py-3">
        <h3 className="text-sm font-semibold text-text-primary tracking-tight">{projectName}</h3>
        <button
          onClick={onCreateWorkspace}
          className="premium-toolbar-button inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-bg-elevated/50 px-3 py-1.5 text-[11px] font-medium text-text-secondary"
        >
          <Plus size={12} />
          New Task
        </button>
      </div>

      {/* Columns */}
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div className="kanban-board">
          {KANBAN_PHASES.map((phase) => (
            <KanbanColumn
              key={phase.id}
              phase={phase}
              workspaces={columnWorkspaces.get(phase.id) ?? []}
              workspaceOperations={workspaceOperations}
              onCreateTask={onCreateWithMode}
              onSelectWorkspace={onSelectWorkspace}
              onStopWorkspace={handleStop}
              onReviewWorkspace={handleReview}
              onMergeWorkspace={handleMerge}
              onDeleteWorkspace={handleDelete}
              onOpenIde={handleOpenIde}
              onArchiveWorkspace={handleArchive}
            />
          ))}
        </div>

        <DragOverlay dropAnimation={null}>
          {activeWorkspace ? <KanbanCardOverlay workspace={activeWorkspace} /> : null}
        </DragOverlay>
      </DndContext>

      {/* Action prompt dialog (discover / plan / code) */}
      {pendingAction && (
        <KanbanActionDialog
          workspace={pendingAction.workspace}
          action={pendingAction.action}
          onSubmit={handleActionSubmit}
          onClose={() => setPendingAction(null)}
        />
      )}

      {/* Merge dialog */}
      {mergingWorkspace && (
        <MergeDialog
          workspace={mergingWorkspace}
          onClose={() => setMergingWorkspace(null)}
        />
      )}
    </div>
  );
}
