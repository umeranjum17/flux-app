import { useEffect, useState, useCallback, useMemo } from 'react';
import { Plus, LayoutGrid, FolderOpen, FolderPlus, Wifi } from 'lucide-react';
import { useWorkspaceStore } from '../../stores/workspace';
import { getProjectSourceKey, useUiStore } from '../../stores/ui';
import { useChatStore } from '../../stores/chat';
import { WorkspaceCard } from './WorkspaceCard';
import { KanbanBoard } from './KanbanBoard';
import { CreateWorkspaceDialog } from './CreateWorkspaceDialog';
import { MergeDialog } from '../review/MergeDialog';
import { CommitDialog } from '../review/CommitDialog';
import type { Workspace } from '../../lib/ipc-api';
import { WorkspaceDetailPanel } from './WorkspaceDetailPanel';
import { archiveWorkspace } from '../../lib/workspace-operations';
import { openLocalProject, startWorkspaceMerge } from '../../lib/workspace-state';
import { toast } from 'sonner';

export function WorkspaceDashboard() {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const workspaceOperations = useWorkspaceStore((s) => s.workspaceOperations);
  const cwd = useUiStore((s) => s.cwd);
  const isGitRepo = useUiStore((s) => s.isGitRepo);
  const openProjects = useUiStore((s) => s.openProjects);
  const canCreateWorkspace = isGitRepo || openProjects.length > 0;
  const viewMode = useUiStore((s) => s.workspaceViewMode);
  const kanbanProjectFilter = useUiStore((s) => s.kanbanProjectFilter);

  const [showCreate, setShowCreate] = useState(false);
  const [mergingWorkspaceId, setMergingWorkspaceId] = useState<string | null>(null);
  const [committingWorkspaceId, setCommittingWorkspaceId] = useState<string | null>(null);

  const workspaceList = Array.from(workspaces.values());
  const repositoryName = cwd?.split('/').filter(Boolean).pop() || 'Repository';

  // Build unique project list from workspaces + open projects for filter pills
  const projectOptions = useMemo(() => {
    const seen = new Map<string, { key: string; label: string; count: number }>();
    for (const p of openProjects) {
      const key = getProjectSourceKey(p);
      if (!seen.has(key)) {
        seen.set(key, { key, label: p.path.split('/').filter(Boolean).pop() || p.path, count: 0 });
      }
    }
    for (const ws of workspaceList) {
      const src = ws.sshHost
        ? { path: ws.parentRepo, source: 'ssh' as const, sshHost: ws.sshHost }
        : { path: ws.parentRepo, source: 'local' as const };
      const key = getProjectSourceKey(src);
      const existing = seen.get(key);
      if (existing) {
        existing.count++;
      } else {
        seen.set(key, { key, label: ws.parentRepo.split('/').filter(Boolean).pop() || ws.parentRepo, count: 1 });
      }
    }
    return Array.from(seen.values());
  }, [openProjects, workspaceList]);

  const hasMultipleProjects = projectOptions.length > 1;

  // Filter workspaces by selected project
  const filteredWorkspaceList = useMemo(() => {
    if (!kanbanProjectFilter) return workspaceList;
    return workspaceList.filter((ws) => {
      const src = ws.sshHost
        ? { path: ws.parentRepo, source: 'ssh' as const, sshHost: ws.sshHost }
        : { path: ws.parentRepo, source: 'local' as const };
      return getProjectSourceKey(src) === kanbanProjectFilter;
    });
  }, [workspaceList, kanbanProjectFilter]);

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
    // Open detail panel instead of switching away from kanban
    useUiStore.getState().openDetailPanel(ws.id);
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
      <div className="flex shrink-0 flex-col border-b border-border/70 px-6 py-5">
        <div className="flex items-center justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-bg-elevated/80 text-text-secondary">
              <LayoutGrid size={18} />
            </div>
            <div>
              <h2 className="truncate text-lg font-semibold tracking-[-0.02em] text-text-primary">
                {hasMultipleProjects ? 'All Projects' : repositoryName}
              </h2>
              <p className="text-[12px] text-text-tertiary">
                {hasMultipleProjects
                  ? `${projectOptions.length} projects · ${workspaceList.length} workspace${workspaceList.length !== 1 ? 's' : ''}`
                  : `${workspaceList.length} workspace${workspaceList.length !== 1 ? 's' : ''} · Isolated branches for parallel agent work`}
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => openLocalProject()}
            className="premium-toolbar-button inline-flex items-center justify-center rounded-full border border-border/60 bg-bg-elevated/50 p-2 text-text-tertiary hover:text-text-primary"
            title="Open a local project"
          >
            <FolderOpen size={14} />
          </button>
          <button
            onClick={() => useUiStore.getState().setOverlay('create-folder')}
            className="premium-toolbar-button inline-flex items-center justify-center rounded-full border border-border/60 bg-bg-elevated/50 p-2 text-text-tertiary hover:text-text-primary"
            title="Create a new local project"
          >
            <FolderPlus size={14} />
          </button>
          <button
            onClick={() => useUiStore.getState().setOverlay('connect-remote')}
            className="premium-toolbar-button inline-flex items-center justify-center rounded-full border border-border/60 bg-bg-elevated/50 p-2 text-text-tertiary hover:text-text-primary"
            title="Connect SSH project"
          >
            <Wifi size={14} />
          </button>
          <button
            onClick={() => setShowCreate(true)}
            disabled={!canCreateWorkspace}
            title={canCreateWorkspace ? undefined : 'Not a git repository — run "git init" first'}
            className="premium-toolbar-button inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-bg-elevated/50 px-4 py-2 text-xs font-medium text-text-secondary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Plus size={13} />
            New Workspace
          </button>
        </div>
        </div>

        {/* Project filter pills — only show when multiple projects exist */}
        {hasMultipleProjects && (
          <div className="mt-3 flex items-center gap-1.5 overflow-x-auto">
            <button
              onClick={() => useUiStore.getState().setKanbanProjectFilter(null)}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium transition-colors ${
                !kanbanProjectFilter
                  ? 'border-accent/30 bg-accent/10 text-accent'
                  : 'border-border/50 bg-bg-elevated/40 text-text-tertiary hover:text-text-secondary hover:border-border/70'
              }`}
            >
              All
              <span className="text-[10px] opacity-70">{workspaceList.length}</span>
            </button>
            {projectOptions.map((p) => (
              <button
                key={p.key}
                onClick={() => useUiStore.getState().setKanbanProjectFilter(
                  kanbanProjectFilter === p.key ? null : p.key,
                )}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium transition-colors ${
                  kanbanProjectFilter === p.key
                    ? 'border-accent/30 bg-accent/10 text-accent'
                    : 'border-border/50 bg-bg-elevated/40 text-text-tertiary hover:text-text-secondary hover:border-border/70'
                }`}
              >
                {p.label}
                <span className="text-[10px] opacity-70">{p.count}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Workspace list / kanban */}
      {filteredWorkspaceList.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-bg-elevated/60">
            <LayoutGrid size={28} className="text-text-tertiary/50" />
          </div>
          <p className="mt-4 text-sm font-medium text-text-secondary">
            {canCreateWorkspace ? 'No workspaces yet' : 'Not a git repository'}
          </p>
          <p className="mt-1.5 max-w-[280px] text-[13px] leading-relaxed text-text-tertiary">
            {canCreateWorkspace
              ? 'Create a workspace to run agents on isolated branches.'
              : 'Workspaces require a git repository. Run "git init" to get started.'}
          </p>
          {canCreateWorkspace && (
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
          workspaces={filteredWorkspaceList}
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
          onSetOutcome={(ws, outcome, mode) => {
            if (outcome === 'ready_to_merge') {
              if (ws.direct) {
                // Direct workspaces: auto-commit and transition to terminal state
                window.api.invoke('workspace:commit', { workspaceId: ws.id })
                  .then(() => {
                    useWorkspaceStore.getState().setOutcome(ws.id, 'merged');
                    toast.success(`Committed changes for ${ws.name}`);
                  })
                  .catch((err) => {
                    if (err instanceof Error && err.message.includes('Nothing to commit')) {
                      useWorkspaceStore.getState().setOutcome(ws.id, 'merged');
                    } else {
                      toast.error(`Commit failed: ${err instanceof Error ? err.message : String(err)}`);
                    }
                  });
              } else {
                const targetBranch = ws.baseBranch || useUiStore.getState().gitBranch || 'main';
                startWorkspaceMerge({ workspace: ws, targetBranch, squash: true })
                  .then(() => toast.success(`Merging ${ws.name} → ${targetBranch}`))
                  .catch((err) => toast.error(`Merge failed: ${err instanceof Error ? err.message : String(err)}`));
              }
            } else {
              useWorkspaceStore.getState().setOutcome(ws.id, outcome);
              if (mode) {
                window.api.invoke('workspace:update', { workspaceId: ws.id, mode });
                useWorkspaceStore.getState().updateWorkspace(ws.id, { mode });
                useUiStore.getState().setMode(mode);
                // Activate the workspace so the user lands in the new mode
                handleSelect(ws);

                // Spawn agent in the target mode — start a fresh session
                // so dropping to an earlier phase proceeds exactly like the first time.
                const modePrompts: Record<string, string> = {
                  discovery: 'Run discovery on this workspace.',
                  plan: 'Create a plan for this workspace.',
                  act: 'Implement the changes for this workspace.',
                };
                const prompt = modePrompts[mode] ?? `Work on this workspace in ${mode} mode.`;

                // Stop any running task first, then spawn fresh in the new mode
                window.api.invoke('workspace:active-task', { workspaceId: ws.id })
                  .then((taskIds: string[]) => {
                    if (taskIds.length > 0) {
                      return window.api.invoke('task:stop', { taskId: taskIds[0] });
                    }
                  })
                  .then(() => window.api.invoke('workspace:spawn-chat', { workspaceId: ws.id, prompt, mode }))
                  .catch((err) => toast.error(`Failed to start ${mode} agent: ${err instanceof Error ? err.message : String(err)}`));
              }
            }
          }}
        />
      ) : (
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div className="space-y-px">
            {filteredWorkspaceList.map((ws) => (
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
