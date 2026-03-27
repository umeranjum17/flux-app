import { useEffect, useState, useCallback } from 'react';
import { Plus, LayoutGrid } from 'lucide-react';
import { useWorkspaceStore } from '../../stores/workspace';
import { useUiStore } from '../../stores/ui';
import { useChatStore } from '../../stores/chat';
import { WorkspaceCard } from './WorkspaceCard';
import { KanbanBoard } from './KanbanBoard';
import { CreateWorkspaceDialog } from './CreateWorkspaceDialog';
import { MergeDialog } from '../review/MergeDialog';
import { CommitDialog } from '../review/CommitDialog';
import type { Workspace } from '../../lib/ipc-api';
import { WorkspaceDetailPanel } from './WorkspaceDetailPanel';
import { archiveWorkspace } from '../../lib/workspace-operations';
import { toast } from 'sonner';

export function WorkspaceDashboard() {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const workspaceOperations = useWorkspaceStore((s) => s.workspaceOperations);
  const cwd = useUiStore((s) => s.cwd);
  const isGitRepo = useUiStore((s) => s.isGitRepo);
  const viewMode = useUiStore((s) => s.workspaceViewMode);

  const [showCreate, setShowCreate] = useState(false);
  const [mergingWorkspaceId, setMergingWorkspaceId] = useState<string | null>(null);
  const [committingWorkspaceId, setCommittingWorkspaceId] = useState<string | null>(null);

  const workspaceList = Array.from(workspaces.values());
  const repositoryName = cwd?.split('/').filter(Boolean).pop() || 'Repository';

  const openProjects = useUiStore((s) => s.openProjects);

  // Load workspaces on mount — across all open projects
  useEffect(() => {
    const projects = openProjects.length > 0
      ? Array.from(new Set(openProjects.map((project) => project.path)))
      : cwd ? [cwd] : [];
    if (projects.length === 0) return;

    (async () => {
      try {
        const allActive: Workspace[] = [];
        for (const repo of projects) {
          const active = await window.api.invoke('workspace:list', { parentRepo: repo }) as Workspace[];
          allActive.push(...active);
        }
        useWorkspaceStore.getState().setWorkspaces(allActive);

        // Sync outcomes with actual git state
        for (const repo of projects) {
          window.api.invoke('workspace:sync-outcomes', { parentRepo: repo }).catch(() => {});
        }
      } catch {
        // best-effort
      }
    })();
  }, [cwd, openProjects]);

  // Workspace status/outcome listeners are registered once in AppShell.
  // No duplicate listeners needed here.

  const handleStop = useCallback(async (ws: Workspace) => {
    await window.api.invoke('workspace:stop', { workspaceId: ws.id });
    // No optimistic override — the main process emits correct status via IPC.
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
    try {
      await archiveWorkspace(ws.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to archive workspace');
    }
  }, []);

  const handleOpenIde = useCallback(async (ws: Workspace) => {
    await window.api.invoke('workspace:open-ide', { workspaceId: ws.id });
  }, []);

  const detailPanelWorkspaceId = useUiStore((s) => s.detailPanelWorkspaceId);

  const handleOpenDetail = useCallback((ws: Workspace) => {
    useUiStore.getState().openDetailPanel(ws.id);
  }, []);

  const handleSelect = useCallback((ws: Workspace) => {
    useWorkspaceStore.getState().setActiveWorkspace(ws.id);
    useUiStore.getState().setActiveProject(
      ws.sshHost
        ? { path: ws.parentRepo, source: 'ssh', sshHost: ws.sshHost }
        : { path: ws.parentRepo, source: 'local' },
    );
    const latestTask = Array.from(useChatStore.getState().tasks.values())
      .filter((task) => task.workspaceId === ws.id)
      .sort((a, b) => (b.activeRun?.startedAt ?? 0) - (a.activeRun?.startedAt ?? 0))[0];
    useChatStore.getState().setActiveTask(latestTask?.id ?? null);
  }, []);

  // If merging, show merge dialog
  const mergingWorkspace = mergingWorkspaceId
    ? (() => {
        const workspace = workspaces.get(mergingWorkspaceId);
        return workspace ? { ...workspace } : null;
      })()
    : null;

  const committingWorkspace = committingWorkspaceId
    ? (() => {
        const workspace = workspaces.get(committingWorkspaceId);
        return workspace ? { ...workspace } : null;
      })()
    : null;

  return (
    <div className="chrome-stage flex flex-1 overflow-hidden">
    <div className={`flex min-w-0 flex-1 flex-col overflow-hidden`}>
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-border/70 px-6 py-5">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-bg-elevated/80 text-text-secondary">
              <LayoutGrid size={18} />
            </div>
            <div>
              <h2 className="truncate text-lg font-semibold tracking-[-0.02em] text-text-primary">{repositoryName}</h2>
              <p className="text-[12px] text-text-tertiary">
                {workspaceList.length} workspace{workspaceList.length !== 1 ? 's' : ''} · Isolated branches for parallel agent work
              </p>
            </div>
          </div>
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

      {/* Workspace list / kanban */}
      {workspaceList.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-bg-elevated/60">
            <LayoutGrid size={28} className="text-text-tertiary/50" />
          </div>
          <p className="mt-4 text-sm font-medium text-text-secondary">
            {isGitRepo ? 'No workspaces yet' : 'Not a git repository'}
          </p>
          <p className="mt-1.5 max-w-[280px] text-[13px] leading-relaxed text-text-tertiary">
            {isGitRepo
              ? 'Create a workspace to run agents on isolated branches.'
              : 'Workspaces require a git repository. Run "git init" to get started.'}
          </p>
          {isGitRepo && (
            <button
              onClick={() => setShowCreate(true)}
              className="premium-toolbar-button mt-5 inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-bg-elevated/50 px-4 py-2.5 text-xs font-medium text-text-secondary"
            >
              <Plus size={13} />
              Create First Workspace
            </button>
          )}
        </div>
      ) : viewMode === 'kanban' ? (
        <KanbanBoard
          workspaces={workspaceList}
          activeWorkspaceId={activeWorkspaceId}
          workspaceOperations={workspaceOperations}
          onSelect={handleSelect}
          onOpenDetail={handleOpenDetail}
          onStop={handleStop}
          onReview={(ws) => useWorkspaceStore.getState().toggleChangesPanel(ws.id)}
          onMerge={(ws) => setMergingWorkspaceId(ws.id)}
          onDelete={handleDelete}
          onOpenIde={handleOpenIde}
          onArchive={handleArchive}
        />
      ) : (
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div className="space-y-px">
            {workspaceList.map((ws) => (
              <WorkspaceCard
                key={ws.id}
                workspace={ws}
                isActive={ws.id === activeWorkspaceId}
                onSelect={() => handleOpenDetail(ws)}
                onStop={() => handleStop(ws)}
                onReview={() => useWorkspaceStore.getState().toggleChangesPanel(ws.id)}
                onMerge={() => setMergingWorkspaceId(ws.id)}
                onDelete={() => handleDelete(ws)}
                onOpenIde={() => handleOpenIde(ws)}
                onArchive={() => handleArchive(ws)}
                archiveOperation={workspaceOperations.get(ws.id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Dialogs */}
      {showCreate && <CreateWorkspaceDialog onClose={() => setShowCreate(false)} />}
      {mergingWorkspace && (
        <MergeDialog
          workspace={mergingWorkspace}
          onClose={() => setMergingWorkspaceId(null)}
        />
      )}
      {committingWorkspace && (
        <CommitDialog
          workspace={committingWorkspace}
          onClose={() => setCommittingWorkspaceId(null)}
        />
      )}
    </div>

    {/* Detail panel (ticket view) */}
    {detailPanelWorkspaceId && <WorkspaceDetailPanel />}
    </div>
  );
}
