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
  const isGitRepo = useUiStore((s) => s.isGitRepo);

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
    const chatStore = useChatStore.getState();
    for (const task of chatStore.tasks.values()) {
      if (task.workspaceId === ws.id) {
        chatStore.setTaskStatus(task.id, 'done');
      }
    }
  }, []);

  const handleDelete = useCallback(async (ws: Workspace) => {
    await window.api.invoke('workspace:delete', { workspaceId: ws.id });
    useWorkspaceStore.getState().removeWorkspace(ws.id);
    const chatStore = useChatStore.getState();
    for (const task of [...chatStore.tasks.values()]) {
      if (task.workspaceId === ws.id) {
        chatStore.removeTask(task.id);
      }
    }
  }, []);

  const handleOpenIde = useCallback(async (ws: Workspace) => {
    await window.api.invoke('workspace:open-ide', { workspaceId: ws.id });
  }, []);

  const handleSelect = useCallback((ws: Workspace) => {
    useWorkspaceStore.getState().setActiveWorkspace(ws.id);
    const latestTask = Array.from(useChatStore.getState().tasks.values())
      .filter((task) => task.workspaceId === ws.id)
      .sort((a, b) => (b.activeRun?.startedAt ?? 0) - (a.activeRun?.startedAt ?? 0))[0];
    useChatStore.getState().setActiveTask(latestTask?.id ?? null);
  }, []);

  // If reviewing, show code review panel
  if (reviewingWorkspaceId) {
    return <CodeReviewPanel />;
  }

  // If merging, show merge dialog
  const mergingWorkspace = mergingWorkspaceId ? workspaces.get(mergingWorkspaceId) : null;

  return (
    <div className="chrome-stage flex flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center justify-between border-b border-border/70 px-6 py-5">
        <div className="min-w-0">
          <div className="classic-section-label">Workspaces</div>
          <div className="mt-2 flex items-center gap-2">
            <LayoutGrid size={16} className="text-accent" />
            <h2 className="truncate text-lg font-semibold tracking-[-0.02em] text-text-primary">{repositoryName}</h2>
            <span className="premium-pill px-2 py-1 text-[10px] font-medium text-text-tertiary">
              {workspaceList.length}
            </span>
          </div>
          <p className="mt-1.5 text-[11px] text-text-tertiary">
            Isolated branches for parallel agent work.
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          disabled={!isGitRepo}
          title={isGitRepo ? undefined : 'Not a git repository — run "git init" first'}
          className="premium-toolbar-button inline-flex items-center gap-1.5 rounded-full border border-accent/20 bg-accent-muted/45 px-4 py-2 text-xs font-medium text-accent disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Plus size={13} />
          New Workspace
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        {workspaceList.length === 0 ? (
          <div className="premium-panel flex h-full flex-col items-center justify-center px-6 text-center">
            <LayoutGrid size={34} className="mb-3 text-text-tertiary/40" />
            <p className="text-sm text-text-secondary">
              {isGitRepo ? 'No workspaces yet' : 'Not a git repository'}
            </p>
            <p className="mt-1 text-xs text-text-tertiary">
              {isGitRepo
                ? 'Create a workspace to run agents on isolated branches.'
                : 'Workspaces require a git repository. Run "git init" in this folder to get started.'}
            </p>
            {isGitRepo && (
              <button
                onClick={() => setShowCreate(true)}
                className="premium-toolbar-button mt-4 inline-flex items-center gap-1.5 rounded-full border border-accent/20 bg-accent-muted/45 px-4 py-2 text-xs font-medium text-accent"
              >
                <Plus size={13} />
                Create First Workspace
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
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
                onOpenIde={() => handleOpenIde(ws)}
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
