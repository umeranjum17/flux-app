import { useEffect, useState, useCallback } from 'react';
import { Plus, LayoutGrid } from 'lucide-react';
import { useWorkspaceStore } from '../../stores/workspace';
import { useUiStore } from '../../stores/ui';
import { useChatStore } from '../../stores/chat';
import { WorkspaceCard } from './WorkspaceCard';
import { CreateWorkspaceDialog } from './CreateWorkspaceDialog';
import { CodeReviewPanel } from '../review/CodeReviewPanel';
import { MergeDialog } from '../review/MergeDialog';
import type { Workspace } from '../../lib/ipc-api';

export function WorkspaceDashboard() {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const reviewingWorkspaceId = useWorkspaceStore((s) => s.reviewingWorkspaceId);
  const cwd = useUiStore((s) => s.cwd);

  const [showCreate, setShowCreate] = useState(false);
  const [mergingWorkspaceId, setMergingWorkspaceId] = useState<string | null>(null);

  const workspaceList = Array.from(workspaces.values());

  // Load workspaces on mount
  useEffect(() => {
    if (!cwd) return;
    window.api.invoke('workspace:list', { parentRepo: cwd })
      .then((result: unknown) => {
        useWorkspaceStore.getState().setWorkspaces(result as Workspace[]);
      })
      .catch(() => {});
  }, [cwd]);

  // Listen for workspace status updates
  useEffect(() => {
    const unsub = window.api.on('workspace:status', (data: unknown) => {
      const { workspaceId, status } = data as { workspaceId: string; status: string };
      useWorkspaceStore.getState().updateWorkspace(workspaceId, { status: status as any });
    });
    const unsubCheckpoint = window.api.on('workspace:checkpoint', (data: unknown) => {
      const { workspaceId, checkpoint } = data as any;
      useWorkspaceStore.getState().addCheckpoint(workspaceId, checkpoint);
    });
    return () => { unsub(); unsubCheckpoint(); };
  }, []);

  const handleStop = useCallback(async (ws: Workspace) => {
    await window.api.invoke('workspace:stop', { workspaceId: ws.id });
    useWorkspaceStore.getState().updateWorkspace(ws.id, { status: 'done' });
    useChatStore.getState().setTaskStatus(ws.id, 'done');
  }, []);

  const handleDelete = useCallback(async (ws: Workspace) => {
    await window.api.invoke('workspace:delete', { workspaceId: ws.id });
    useWorkspaceStore.getState().removeWorkspace(ws.id);
    useChatStore.getState().removeTask(ws.id);
  }, []);

  const handleSelect = useCallback((ws: Workspace) => {
    useWorkspaceStore.getState().setActiveWorkspace(ws.id);
    useChatStore.getState().setActiveTask(ws.id);
  }, []);

  // If reviewing, show code review panel
  if (reviewingWorkspaceId) {
    return <CodeReviewPanel />;
  }

  // If merging, show merge dialog
  const mergingWorkspace = mergingWorkspaceId ? workspaces.get(mergingWorkspaceId) : null;

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <LayoutGrid size={16} className="text-accent" />
          <h2 className="text-sm font-semibold text-text-primary">Workspaces</h2>
          <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-bg-elevated text-text-tertiary font-medium">
            {workspaceList.length}
          </span>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-accent text-white hover:bg-accent/90 transition-colors"
        >
          <Plus size={13} />
          New Workspace
        </button>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto p-4">
        {workspaceList.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <LayoutGrid size={40} className="text-text-tertiary/30 mb-3" />
            <p className="text-sm text-text-secondary mb-1">No workspaces yet</p>
            <p className="text-xs text-text-tertiary mb-4">
              Create a workspace to run agents in parallel on isolated branches
            </p>
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg bg-accent text-white hover:bg-accent/90 transition-colors"
            >
              <Plus size={13} />
              Create First Workspace
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {workspaceList.map((ws) => (
              <WorkspaceCard
                key={ws.id}
                workspace={ws}
                isActive={ws.id === activeWorkspaceId}
                onSelect={() => handleSelect(ws)}
                onStop={() => handleStop(ws)}
                onReview={() => useWorkspaceStore.getState().openReview(ws.id)}
                onMerge={() => setMergingWorkspaceId(ws.id)}
                onDelete={() => handleDelete(ws)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Dialogs */}
      {showCreate && <CreateWorkspaceDialog onClose={() => setShowCreate(false)} />}
      {mergingWorkspace && (
        <MergeDialog
          workspace={mergingWorkspace}
          onClose={() => setMergingWorkspaceId(null)}
        />
      )}
    </div>
  );
}
