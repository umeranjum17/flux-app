import { useState, useMemo, useCallback } from 'react';
import { Plus, GitBranch, Eye, GitMerge, Square, Trash2, MessageSquare, ChevronDown, ChevronRight, FolderOpen } from 'lucide-react';
import { useWorkspaceStore } from '../../stores/workspace';
import { useChatStore } from '../../stores/chat';
import { useUiStore } from '../../stores/ui';
import { useAgentStore } from '../../stores/agent';
import { getWorkspaceLifecycleState, workspaceLifecycleConfig } from '../../lib/workspace-status';
import { createEmptyWorkspace } from '../../lib/workspace-state';
import type { Workspace } from '../../lib/ipc-api';
import { toast } from 'sonner';

function basename(p: string): string {
  return p.split('/').pop() || p.split('\\').pop() || p;
}

export function WorkspaceTab() {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const tasks = useChatStore((s) => s.tasks);
  const isGitRepo = useUiStore((s) => s.isGitRepo);
  const cwd = useUiStore((s) => s.cwd);
  const openProjects = useUiStore((s) => s.openProjects);
  const collapsedProjects = useUiStore((s) => s.collapsedProjects);
  const [creating, setCreating] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; ws: Workspace } | null>(null);

  // Group workspaces by parentRepo
  const groupedWorkspaces = useMemo(() => {
    const groups = new Map<string, Workspace[]>();

    // Initialize groups for all open projects (so empty projects still show)
    for (const project of openProjects) {
      if (!groups.has(project)) {
        groups.set(project, []);
      }
    }

    // Sort all workspaces into their project groups
    for (const ws of workspaces.values()) {
      const existing = groups.get(ws.parentRepo) ?? [];
      existing.push(ws);
      groups.set(ws.parentRepo, existing);
    }

    // Sort workspaces within each group by updatedAt
    for (const [key, list] of groups) {
      groups.set(key, list.sort((a, b) => b.updatedAt - a.updatedAt));
    }

    return groups;
  }, [workspaces, openProjects]);

  const standaloneTasks = useMemo(
    () => Array.from(tasks.values()).filter((t) => !t.workspaceId),
    [tasks],
  );

  const hasMultipleProjects = groupedWorkspaces.size > 1;

  const handleSelectWorkspace = useCallback((wsId: string) => {
    const wsStore = useWorkspaceStore.getState();
    const chatStore = useChatStore.getState();
    wsStore.setActiveWorkspace(wsId);

    // Update active project to match workspace's parent repo
    const workspace = wsStore.workspaces.get(wsId);
    if (workspace) {
      useUiStore.getState().setActiveProject(workspace.parentRepo);
    }

    const wsTask = Array.from(chatStore.tasks.values())
      .filter((t) => t.workspaceId === wsId)
      .sort((a, b) => (b.activeRun?.startedAt ?? 0) - (a.activeRun?.startedAt ?? 0))[0];
    if (wsTask) {
      chatStore.setActiveTask(wsTask.id);
    }
    useUiStore.getState().setBottomPanelMode('agent');
  }, []);

  const handleSelectStandaloneChat = useCallback((taskId: string) => {
    useWorkspaceStore.getState().setActiveWorkspace(null);
    useChatStore.getState().setActiveTask(taskId);
    useUiStore.getState().setBottomPanelMode('agent');
  }, []);

  const handleContextAction = useCallback((action: string, ws: Workspace) => {
    setContextMenu(null);
    switch (action) {
      case 'review':
        useWorkspaceStore.getState().toggleChangesPanel(ws.id);
        break;
      case 'merge':
        useWorkspaceStore.getState().openMerge(ws.id);
        break;
      case 'new-chat': {
        const taskId = crypto.randomUUID();
        const { selectedThinking } = useAgentStore.getState();
        useChatStore.getState().createTask({
          id: taskId,
          title: 'New chat',
          agentId: ws.agentId as any,
          model: ws.model,
          mode: 'act',
          thinking: selectedThinking,
          cwd: ws.worktreePath,
          workspaceId: ws.id,
        });
        useWorkspaceStore.getState().setActiveWorkspace(ws.id);
        useChatStore.getState().setActiveTask(taskId);
        useUiStore.getState().setBottomPanelMode('agent');
        break;
      }
      case 'stop':
        window.api.invoke('workspace:stop', { workspaceId: ws.id }).then(() => {
          useWorkspaceStore.getState().updateWorkspace(ws.id, { status: 'done' });
        });
        break;
      case 'archive':
        useWorkspaceStore.getState().archiveWorkspace(ws.id);
        window.api.invoke('workspace:archive', { workspaceId: ws.id });
        break;
      case 'delete':
        window.api.invoke('workspace:delete', { workspaceId: ws.id }).then(() => {
          useWorkspaceStore.getState().removeWorkspace(ws.id);
          const chatStore = useChatStore.getState();
          for (const task of chatStore.tasks.values()) {
            if (task.workspaceId === ws.id) {
              chatStore.removeTask(task.id);
            }
          }
        });
        break;
    }
  }, []);

  const handleCreateWorkspace = useCallback(async (projectPath: string) => {
    if (creating) return;
    setCreating(true);
    try {
      const { selectedAgentId: agentId, selectedModel: model, selectedThinking } = useAgentStore.getState();
      const mode = useUiStore.getState().mode;
      const ws = await createEmptyWorkspace({ agentId, model, mode, cwd: projectPath });
      const taskId = crypto.randomUUID();
      useChatStore.getState().createTask({
        id: taskId,
        title: 'New chat',
        agentId: ws.agentId as any,
        model: ws.model,
        mode: ws.mode ?? mode,
        thinking: selectedThinking,
        cwd: ws.worktreePath,
        workspaceId: ws.id,
      });
      useChatStore.getState().setActiveTask(taskId);
      useUiStore.getState().setBottomPanelMode('agent');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(message);
    } finally {
      setCreating(false);
    }
  }, [creating]);

  const handleAddProject = useCallback(async () => {
    const picked = await window.api.invoke('cwd:pick') as string | null;
    if (picked) {
      useUiStore.getState().addOpenProject(picked);
      // Load workspaces for the new project
      try {
        const result = await window.api.invoke('workspace:list', { parentRepo: picked }) as Workspace[];
        useWorkspaceStore.getState().mergeWorkspaces(result);
      } catch {
        // best-effort
      }
    }
  }, []);

  const isRunning = (ws: Workspace) =>
    ws.status === 'running' || ws.status === 'waiting_approval' || ws.status === 'waiting_input';

  // Global workspace index for keyboard shortcuts
  let globalIdx = 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-3 pt-3 pb-1">
        <span className="classic-section-label">Workspaces</span>
        <div className="flex items-center gap-0.5">
          {hasMultipleProjects && (
            <button
              onClick={handleAddProject}
              className="premium-toolbar-button rounded-md p-1.5 text-text-secondary"
              title="Add project to group"
            >
              <FolderOpen size={14} />
            </button>
          )}
          <button
            onClick={() => handleCreateWorkspace(cwd)}
            disabled={creating || !isGitRepo}
            className="premium-toolbar-button rounded-md p-1.5 text-text-secondary disabled:opacity-50"
            title={isGitRepo ? 'New workspace' : 'Not a git repository — run "git init" first'}
          >
            <Plus size={14} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2">
        {groupedWorkspaces.size === 0 && standaloneTasks.length === 0 && (
          <div className="px-3 py-6 text-center">
            <p className="text-[13px] text-text-secondary">No workspaces</p>
            <p className="mt-1 text-[11px] text-text-tertiary">Click + to create one.</p>
          </div>
        )}

        {Array.from(groupedWorkspaces.entries()).map(([projectPath, projectWorkspaces]) => {
          const isCollapsed = collapsedProjects.has(projectPath);
          const isActiveProject = projectPath === cwd;

          return (
            <div key={projectPath}>
              {/* Project header — only show when multiple projects */}
              {hasMultipleProjects && (
                <button
                  onClick={() => {
                    useUiStore.getState().toggleProjectCollapsed(projectPath);
                  }}
                  onDoubleClick={() => {
                    useUiStore.getState().setActiveProject(projectPath);
                  }}
                  className={`group mt-1.5 flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-bg-hover ${
                    isActiveProject ? 'text-accent' : 'text-text-secondary'
                  }`}
                  title={`${projectPath}\nDouble-click to set as active project`}
                >
                  {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                  <FolderOpen size={12} className="shrink-0 opacity-60" />
                  <span className="truncate text-[11px] font-semibold uppercase tracking-[0.05em]">
                    {basename(projectPath)}
                  </span>
                  <span className="ml-auto text-[10px] text-text-tertiary">
                    {projectWorkspaces.length}
                  </span>
                  <span
                    role="button"
                    tabIndex={-1}
                    title="New workspace in this project"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCreateWorkspace(projectPath);
                    }}
                    className="shrink-0 rounded p-0.5 text-text-tertiary opacity-0 transition-opacity group-hover:opacity-100 hover:text-text-primary"
                  >
                    <Plus size={11} />
                  </span>
                </button>
              )}

              {/* Workspace list for this project */}
              {!isCollapsed && projectWorkspaces.map((ws) => {
                const lifecycleState = getWorkspaceLifecycleState(ws);
                const lifecycle = workspaceLifecycleConfig[lifecycleState] ?? workspaceLifecycleConfig.idle;
                const isActive = ws.id === activeWorkspaceId;
                const isLive = lifecycle.pulse;
                const wsGlobalIdx = globalIdx++;

                return (
                  <button
                    key={ws.id}
                    onClick={() => handleSelectWorkspace(ws.id)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setContextMenu({ x: e.clientX, y: e.clientY, ws });
                    }}
                    title={lifecycle.detail}
                    className={`group classic-list-button ${isActive ? 'classic-list-button-active' : ''}`}
                  >
                    <div className="relative mt-0.5 shrink-0">
                      <span className={`lifecycle-dot ${lifecycle.color} ${isLive ? 'animate-pulse lifecycle-dot-glow' : ''}`} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[13px] font-medium text-text-primary">{ws.name}</span>
                        <span className={`ml-auto shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${lifecycle.badgeClass}`}>
                          {lifecycle.label}
                        </span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-text-tertiary">
                        <GitBranch size={10} className="opacity-50" />
                        <span className="truncate font-mono">{ws.branch}</span>
                      </div>
                    </div>
                    {!isRunning(ws) && (
                      <span
                        role="button"
                        tabIndex={-1}
                        title="Archive"
                        onClick={(e) => {
                          e.stopPropagation();
                          useWorkspaceStore.getState().archiveWorkspace(ws.id);
                          window.api.invoke('workspace:archive', { workspaceId: ws.id });
                        }}
                        className="shrink-0 rounded-lg p-1 text-text-tertiary opacity-0 transition-opacity group-hover:opacity-100 hover:text-text-primary"
                      >
                        <Trash2 size={12} />
                      </span>
                    )}
                    {wsGlobalIdx < 9 && (
                      <span className="shrink-0 text-[10px] text-text-tertiary/50 font-mono">{'\u2318'}{wsGlobalIdx + 1}</span>
                    )}
                  </button>
                );
              })}
            </div>
          );
        })}

        {/* Quick Chats — standalone tasks not tied to a workspace */}
        {standaloneTasks.length > 0 && (
          <>
            <div className="mt-3 mb-1 px-1.5 text-[11px] font-medium uppercase tracking-[0.1em] text-text-tertiary">
              Quick Chats
            </div>
            {standaloneTasks.map((task) => {
              const isChatActive = task.id === useChatStore.getState().activeTaskId && !activeWorkspaceId;
              return (
                <button
                  key={task.id}
                  onClick={() => handleSelectStandaloneChat(task.id)}
                  className={`classic-list-button ${isChatActive ? 'classic-list-button-active' : ''}`}
                >
                  <span className={`lifecycle-dot ${statusColor(task.status)}`} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium text-text-primary">{task.title || 'Untitled'}</div>
                  </div>
                </button>
              );
            })}
          </>
        )}

        {/* Add project button when no multi-project yet */}
        {!hasMultipleProjects && openProjects.length > 0 && (
          <button
            onClick={handleAddProject}
            className="mt-3 flex w-full items-center gap-2 rounded-md px-2 py-2 text-[11px] text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary"
          >
            <FolderOpen size={12} />
            <span>Add another project</span>
          </button>
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <>
          <div className="fixed inset-0 z-50" onClick={() => setContextMenu(null)} />
          <div
            className="fixed z-50 min-w-[160px] rounded-xl border border-border/80 bg-bg-primary py-1 shadow-xl"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <ContextItem icon={<Eye size={12} />} label="Review Changes" onClick={() => handleContextAction('review', contextMenu.ws)} />
            <ContextItem icon={<GitMerge size={12} />} label="Merge" onClick={() => handleContextAction('merge', contextMenu.ws)} />
            <ContextItem icon={<MessageSquare size={12} />} label="New Chat" onClick={() => handleContextAction('new-chat', contextMenu.ws)} />
            {isRunning(contextMenu.ws) && (
              <ContextItem icon={<Square size={12} />} label="Stop" onClick={() => handleContextAction('stop', contextMenu.ws)} />
            )}
            {!isRunning(contextMenu.ws) && (
              <ContextItem icon={<Trash2 size={12} />} label="Archive" onClick={() => handleContextAction('archive', contextMenu.ws)} />
            )}
            <div className="my-1 border-t border-border/60" />
            <ContextItem icon={<Trash2 size={12} />} label="Delete" onClick={() => handleContextAction('delete', contextMenu.ws)} danger />
          </div>
        </>
      )}
    </div>
  );
}

function ContextItem({ icon, label, onClick, danger }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-[12px] ${
        danger ? 'text-error hover:bg-error/10' : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function statusColor(status: string): string {
  switch (status) {
    case 'running': return 'bg-success';
    case 'waiting_approval': return 'bg-warning';
    case 'waiting_input': return 'bg-text-tertiary';
    case 'done': return 'bg-success';
    case 'error': return 'bg-error';
    default: return 'bg-text-tertiary';
  }
}
