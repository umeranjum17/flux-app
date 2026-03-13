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
  const repositoryName = cwd?.split('/').filter(Boolean).pop() || 'Repository';

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
    <div className="flex flex-1 flex-col overflow-hidden bg-bg-primary">
      <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-4">
        <div className="min-w-0">
          <div className="classic-section-label">Workspaces</div>
          <div className="mt-1 flex items-center gap-2">
            <LayoutGrid size={16} className="text-accent" />
            <h2 className="truncate text-sm font-semibold text-text-primary">{repositoryName}</h2>
            <span className="rounded-md border border-border bg-bg-elevated px-1.5 py-0.5 text-[10px] font-medium text-text-tertiary">
              {workspaceList.length}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-text-tertiary">
            Isolated branches for parallel agent work.
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="premium-toolbar-button inline-flex items-center gap-1.5 rounded-md border border-accent/20 bg-accent-muted/45 px-3 py-1.5 text-xs font-medium text-accent"
        >
          <Plus size={13} />
          New Workspace
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        {workspaceList.length === 0 ? (
          <div className="premium-panel flex h-full flex-col items-center justify-center px-6 text-center">
            <LayoutGrid size={34} className="mb-3 text-text-tertiary/40" />
            <p className="text-sm text-text-secondary">No workspaces yet</p>
            <p className="mt-1 text-xs text-text-tertiary">
              Create a workspace to run agents on isolated branches.
            </p>
            <button
              onClick={() => setShowCreate(true)}
              className="premium-toolbar-button mt-4 inline-flex items-center gap-1.5 rounded-md border border-accent/20 bg-accent-muted/45 px-4 py-2 text-xs font-medium text-accent"
            >
              <Plus size={13} />
              Create First Workspace
            </button>
          </div>
        ) : (
          <div className="space-y-2">
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
