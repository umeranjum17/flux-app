import { useEffect, useState, useCallback } from 'react';
import { Plus, LayoutGrid, Archive, ChevronDown, ChevronRight } from 'lucide-react';
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
  const archivedWorkspaces = useWorkspaceStore((s) => s.archivedWorkspaces);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const reviewingWorkspaceId = useWorkspaceStore((s) => s.reviewingWorkspaceId);
  const showArchived = useWorkspaceStore((s) => s.showArchived);
  const cwd = useUiStore((s) => s.cwd);
  const isGitRepo = useUiStore((s) => s.isGitRepo);

  const [showCreate, setShowCreate] = useState(false);
  const [mergingWorkspaceId, setMergingWorkspaceId] = useState<string | null>(null);

  const workspaceList = Array.from(workspaces.values());
  const archivedList = Array.from(archivedWorkspaces.values());
  const repositoryName = cwd?.split('/').filter(Boolean).pop() || 'Repository';

  // Load workspaces on mount
  useEffect(() => {
    if (!cwd) return;
    window.api.invoke('workspace:list', { parentRepo: cwd })
      .then((result: unknown) => {
        useWorkspaceStore.getState().setWorkspaces(result as Workspace[]);
      })
      .catch(() => {});
    // Also load archived workspaces
    window.api.invoke('workspace:list', { parentRepo: cwd, includeArchived: true })
      .then((result: unknown) => {
        const all = result as Workspace[];
        useWorkspaceStore.getState().setArchivedWorkspaces(all.filter((ws) => ws.archivedAt));
      })
      .catch(() => {});
  }, [cwd]);

  // Listen for workspace status updates
  useEffect(() => {
    const unsub = window.api.on('workspace:status', (data: unknown) => {
      const { workspaceId, status } = data as { workspaceId: string; status: string };
      useWorkspaceStore.getState().updateWorkspace(workspaceId, { status: status as any });
    });
    const unsubOutcome = window.api.on('workspace:outcome', (data: unknown) => {
      const { workspaceId, outcome } = data as { workspaceId: string; outcome: string };
      useWorkspaceStore.getState().updateWorkspace(workspaceId, { outcome: outcome as any });
    });
    const unsubCheckpoint = window.api.on('workspace:checkpoint', (data: unknown) => {
      const { workspaceId, checkpoint } = data as any;
      useWorkspaceStore.getState().addCheckpoint(workspaceId, checkpoint);
    });
    return () => { unsub(); unsubOutcome(); unsubCheckpoint(); };
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

  const handleArchive = useCallback(async (ws: Workspace) => {
    await window.api.invoke('workspace:archive', { workspaceId: ws.id });
    useWorkspaceStore.getState().archiveWorkspace(ws.id);
    const chatStore = useChatStore.getState();
    for (const task of chatStore.tasks.values()) {
      if (task.workspaceId === ws.id) {
        chatStore.setTaskStatus(task.id, 'done');
      }
    }
  }, []);

  const handleUnarchive = useCallback(async (ws: Workspace) => {
    const restored = await window.api.invoke('workspace:unarchive', { workspaceId: ws.id }) as Workspace;
    useWorkspaceStore.getState().unarchiveWorkspace(ws.id, restored);
  }, []);

  const handleDeleteArchived = useCallback(async (ws: Workspace) => {
    await window.api.invoke('workspace:delete', { workspaceId: ws.id });
    useWorkspaceStore.getState().setArchivedWorkspaces(
      archivedList.filter((a) => a.id !== ws.id),
    );
  }, [archivedList]);

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
  const mergingWorkspace = mergingWorkspaceId
    ? (() => {
        const workspace = workspaces.get(mergingWorkspaceId);
        return workspace ? { ...workspace } : null;
      })()
    : null;

  return (
    <div className="chrome-stage flex flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center justify-between border-b border-border/70 px-6 py-5">
        <div className="min-w-0">
          <div className="classic-section-label">Workspaces</div>
          <div className="mt-2 flex items-center gap-2">
            <LayoutGrid size={16} className="text-text-secondary" />
            <h2 className="truncate text-lg font-semibold tracking-[-0.02em] text-text-primary">{repositoryName}</h2>
            <span className="premium-pill px-2 py-1 text-[12px] font-medium text-text-tertiary">
              {workspaceList.length}
            </span>
          </div>
          <p className="mt-1.5 text-[13px] text-text-tertiary">
            Isolated branches for parallel agent work.
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          disabled={!isGitRepo}
          title={isGitRepo ? undefined : 'Not a git repository — run "git init" first'}
          className="premium-toolbar-button inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-bg-elevated/50 px-4 py-2 text-xs font-medium text-text-secondary disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Plus size={13} />
          New Workspace
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        {workspaceList.length === 0 && archivedList.length === 0 ? (
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
                className="premium-toolbar-button mt-4 inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-bg-elevated/50 px-4 py-2 text-xs font-medium text-text-secondary"
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
                onReview={() => useWorkspaceStore.getState().toggleChangesPanel(ws.id)}
                onMerge={() => setMergingWorkspaceId(ws.id)}
                onDelete={() => handleDelete(ws)}
                onOpenIde={() => handleOpenIde(ws)}
                onArchive={() => handleArchive(ws)}
              />
            ))}

            {archivedList.length > 0 && (
              <div className="pt-3">
                <button
                  onClick={() => useWorkspaceStore.getState().setShowArchived(!showArchived)}
                  className="flex w-full items-center gap-2 py-2 text-xs text-text-tertiary hover:text-text-secondary transition-colors"
                >
                  {showArchived ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  <Archive size={13} />
                  <span>Archived ({archivedList.length})</span>
                </button>
                {showArchived && (
                  <div className="mt-2 space-y-3">
                    {archivedList.map((ws) => (
                      <WorkspaceCard
                        key={ws.id}
                        workspace={ws}
                        isActive={false}
                        isArchived
                        onSelect={() => {}}
                        onStop={() => {}}
                        onReview={() => {}}
                        onMerge={() => {}}
                        onDelete={() => handleDeleteArchived(ws)}
                        onOpenIde={() => {}}
                        onUnarchive={() => handleUnarchive(ws)}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
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
