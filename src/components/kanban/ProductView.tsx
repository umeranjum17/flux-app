import { useEffect, useState, useCallback, useMemo } from 'react';
import { Plus, Kanban, Loader2 } from 'lucide-react';
import { useWorkspaceStore } from '../../stores/workspace';
import { useUiStore } from '../../stores/ui';
import { useChatStore } from '../../stores/chat';
import { KanbanBoard } from './KanbanBoard';
import { CreateTaskDialog } from './CreateTaskDialog';
import type { Workspace } from '../../lib/ipc-api';
import type { TaskMode } from '../../lib/types';

export function ProductView() {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const cwd = useUiStore((s) => s.cwd);
  const openProjects = useUiStore((s) => s.openProjects);
  const collapsedProjects = useUiStore((s) => s.collapsedProjects);
  const isGitRepo = useUiStore((s) => s.isGitRepo);

  const [showCreate, setShowCreate] = useState(false);
  const [createInitialMode, setCreateInitialMode] = useState<TaskMode | undefined>(undefined);
  const [loading, setLoading] = useState(true);

  // Load workspaces for all open projects
  useEffect(() => {
    const projects = openProjects.length > 0 ? openProjects : cwd ? [cwd] : [];
    if (projects.length === 0) {
      setLoading(false);
      return;
    }

    setLoading(true);
    (async () => {
      try {
        const allActive: Workspace[] = [];
        for (const repo of projects) {
          const active = (await window.api.invoke('workspace:list', {
            parentRepo: repo,
          })) as Workspace[];
          allActive.push(...active);
        }
        useWorkspaceStore.getState().setWorkspaces(allActive);

        for (const repo of projects) {
          window.api.invoke('workspace:sync-outcomes', { parentRepo: repo }).catch(() => {});
        }
      } catch {
        // best-effort
      } finally {
        setLoading(false);
      }
    })();
  }, [cwd, openProjects]);

  const projects = useMemo(() => {
    const list = openProjects.length > 0 ? openProjects : cwd ? [cwd] : [];
    return list.map((repo) => ({
      repo,
      name: repo.split('/').filter(Boolean).pop() || 'Repository',
    }));
  }, [openProjects, cwd]);

  const handleSelectWorkspace = useCallback((ws: Workspace) => {
    // Switch to eng mode and open the workspace
    useWorkspaceStore.getState().setActiveWorkspace(ws.id);
    useUiStore.getState().setActiveProject(ws.parentRepo);
    const latestTask = Array.from(useChatStore.getState().tasks.values())
      .filter((task) => task.workspaceId === ws.id)
      .sort((a, b) => (b.activeRun?.startedAt ?? 0) - (a.activeRun?.startedAt ?? 0))[0];
    useChatStore.getState().setActiveTask(latestTask?.id ?? null);
    useUiStore.getState().setViewMode('eng');
  }, []);

  const handleCreateWithMode = useCallback((initialMode?: TaskMode) => {
    setCreateInitialMode(initialMode);
    setShowCreate(true);
  }, []);

  const totalWorkspaces = workspaces.size;

  if (projects.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center text-center px-6">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-bg-elevated/60">
          <Kanban size={28} className="text-text-tertiary/50" />
        </div>
        <p className="mt-4 text-sm font-medium text-text-secondary">No projects open</p>
        <p className="mt-1.5 max-w-[280px] text-[13px] leading-relaxed text-text-tertiary">
          Open a git repository to see your workspaces on the Kanban board.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Product view header */}
      <div className="flex shrink-0 items-center justify-between border-b border-border/70 px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-bg-elevated/80 text-text-secondary">
            <Kanban size={16} />
          </div>
          <div>
            <h2 className="text-[15px] font-semibold tracking-tight text-text-primary">Product Board</h2>
            <p className="text-[11px] text-text-tertiary">
              {totalWorkspaces} workspace{totalWorkspaces !== 1 ? 's' : ''} across {projects.length} project{projects.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
        <button
          onClick={() => handleCreateWithMode()}
          disabled={!isGitRepo}
          className="premium-toolbar-button inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-bg-elevated/50 px-3 py-1.5 text-[11px] font-medium text-text-secondary disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Plus size={12} />
          New Task
        </button>
      </div>

      {/* Per-project boards */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={20} className="animate-spin text-text-tertiary" />
          </div>
        )}
        {!loading && projects.map(({ repo, name }) => {
          const isCollapsed = collapsedProjects.has(repo);
          return (
            <div key={repo} className="border-b border-border/40 last:border-b-0">
              {projects.length > 1 && (
                <button
                  onClick={() => useUiStore.getState().toggleProjectCollapsed(repo)}
                  className="flex w-full items-center gap-2 px-6 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-text-tertiary hover:text-text-secondary transition-colors"
                >
                  <span className={`transform transition-transform ${isCollapsed ? '-rotate-90' : 'rotate-0'}`}>▾</span>
                  {name}
                </button>
              )}
              {!isCollapsed && (
                <KanbanBoard
                  parentRepo={repo}
                  projectName={projects.length <= 1 ? name : ''}
                  onCreateWorkspace={() => handleCreateWithMode()}
                  onCreateWithMode={handleCreateWithMode}
                  onSelectWorkspace={handleSelectWorkspace}
                />
              )}
            </div>
          );
        })}
      </div>

      {showCreate && (
        <CreateTaskDialog
          initialMode={createInitialMode}
          onClose={() => { setShowCreate(false); setCreateInitialMode(undefined); }}
        />
      )}
    </div>
  );
}
