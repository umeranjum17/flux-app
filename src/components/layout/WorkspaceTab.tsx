import { useState, useMemo, useCallback } from 'react';
import { Plus, GitBranch, Eye, GitMerge, GitCommit, Square, Trash2, MessageSquare, ChevronDown, ChevronRight, FolderOpen, X, LoaderCircle, Link2, Monitor, Zap } from 'lucide-react';
import { WorkspaceLifecycleIcon } from '../workspace/WorkspaceLifecycleIcon';
import { useWorkspaceStore } from '../../stores/workspace';
import { useChatStore } from '../../stores/chat';
import { useUiStore } from '../../stores/ui';
import { useAgentStore } from '../../stores/agent';
import { getWorkspaceListSignal, isActionNeededState } from '../../lib/workspace-status';
import { createRecentProject, rememberRecentProject, isWorkspaceSshAvailable } from '../../lib/workspace-state';
import type { Workspace, WorkspaceOperation } from '../../lib/ipc-api';
import { toast } from 'sonner';
import { archiveWorkspace, formatWorkspaceOperationLabel, isWorkspaceArchiving } from '../../lib/workspace-operations';
import { useWorkspaceHasChanges } from '../../hooks/useWorkspaceHasChanges';
import { AnimatedWorkspaceName } from '../workspace/AnimatedWorkspaceName';
import { useWorkspaceGroupStore } from '../../stores/workspace-group';

function basename(p: string): string {
  return p.split('/').pop() || p.split('\\').pop() || p;
}

export function WorkspaceTab() {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const tasks = useChatStore((s) => s.tasks);
  const cwd = useUiStore((s) => s.cwd);
  const openProjects = useUiStore((s) => s.openProjects);
  const collapsedProjects = useUiStore((s) => s.collapsedProjects);
  const workspaceOperations = useWorkspaceStore((s) => s.workspaceOperations);
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
    } else {
      chatStore.setActiveTask(null);
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
        useChatStore.getState().createTask({
          id: taskId,
          title: 'New chat',
          agentId: ws.agentId as any,
          model: ws.model,
          mode: 'act',
          thinking: ws.thinking ?? useAgentStore.getState().selectedThinking,
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
      case 'link':
        useUiStore.getState().setLinkingWorkspaceId(ws.id);
        break;
      case 'unlink':
        void useWorkspaceGroupStore.getState().unlinkWorkspace(ws.id);
        break;
      case 'archive':
        void handleArchive(ws.id);
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

  const handleArchive = useCallback(async (workspaceId: string) => {
    try {
      await archiveWorkspace(workspaceId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to archive workspace');
    }
  }, []);

  const handleCreateQuickWorkspace = useCallback(async (projectPath: string) => {
    if (creating) return;
    setCreating(true);
    try {
      const { selectedAgentId: agentId, selectedModel: model, selectedThinking } = useAgentStore.getState();
      const mode = useUiStore.getState().mode;
      const ws = await window.api.invoke('workspace:create-direct', {
        name: 'Quick Task',
        parentRepo: projectPath,
        agentId,
        model,
        mode,
        thinking: selectedThinking,
      }) as Workspace;
      useWorkspaceStore.getState().addWorkspace(ws);
      useWorkspaceStore.getState().setActiveWorkspace(ws.id);
      const taskId = crypto.randomUUID();
      useChatStore.getState().createTask({
        id: taskId,
        title: 'Quick task',
        agentId: ws.agentId as any,
        model: ws.model,
        mode: ws.mode ?? mode,
        thinking: ws.thinking ?? selectedThinking,
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

  const handleAddProject = useCallback(() => {
    useUiStore.getState().setOverlay('create-folder');
  }, []);

  const handleOpenProject = useCallback(async () => {
    const picked = await window.api.invoke('cwd:pick') as string | null;
    if (!picked) return;
    useUiStore.getState().addOpenProject(picked);
    useUiStore.getState().setCwd(picked);
    const project = createRecentProject(picked);
    await rememberRecentProject(project);
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
          <button
            onClick={handleOpenProject}
            className="premium-toolbar-button rounded-md p-1.5 text-text-secondary"
            title="Open project"
          >
            <FolderOpen size={14} />
          </button>
          <button
            onClick={() => {
              const projectPath = cwd || Array.from(groupedWorkspaces.keys())[0];
              if (projectPath) handleCreateQuickWorkspace(projectPath);
            }}
            disabled={creating}
            className="premium-toolbar-button rounded-md p-1.5 text-accent"
            title="New workspace"
          >
            {creating ? <LoaderCircle size={14} className="animate-spin" /> : <Zap size={14} />}
          </button>
          <button
            onClick={handleAddProject}
            className="premium-toolbar-button rounded-md p-1.5 text-text-secondary"
            title="New project"
          >
            <Plus size={14} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2">
        {groupedWorkspaces.size === 0 && standaloneTasks.length === 0 && (
          <div className="px-3 py-6 text-center">
            <p className="text-[13px] text-text-secondary">No workspaces</p>
            <p className="mt-1 text-[11px] text-text-tertiary">Click + to add a project.</p>
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
                    title="New workspace"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCreateQuickWorkspace(projectPath);
                    }}
                    className="shrink-0 rounded p-0.5 text-text-tertiary opacity-0 transition-opacity group-hover:opacity-100 hover:text-text-primary"
                  >
                    <Plus size={11} />
                  </span>
                  <span
                    role="button"
                    tabIndex={-1}
                    title="Remove project from sidebar"
                    onClick={(e) => {
                      e.stopPropagation();
                      useUiStore.getState().removeOpenProject(projectPath);
                    }}
                    className="shrink-0 rounded p-0.5 text-text-tertiary opacity-0 transition-opacity group-hover:opacity-100 hover:text-error"
                  >
                    <X size={11} />
                  </span>
                </button>
              )}

              {/* Workspace list for this project */}
              {!isCollapsed && projectWorkspaces.map((ws) => {
                const operation = workspaceOperations.get(ws.id);
                const isActive = ws.id === activeWorkspaceId;
                const wsGlobalIdx = globalIdx++;

                return (
                  <WorkspaceListItem
                    key={ws.id}
                    workspace={ws}
                    operation={operation}
                    isActive={isActive}
                    shortcutIndex={wsGlobalIdx}
                    onSelect={() => handleSelectWorkspace(ws.id)}
                    onOpenContextMenu={(event) => {
                      event.preventDefault();
                      setContextMenu({ x: event.clientX, y: event.clientY, ws });
                    }}
                    onArchive={() => handleArchive(ws.id)}
                  />
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
            <ContextItem icon={<Link2 size={12} />} label="Link Workspace..." onClick={() => handleContextAction('link', contextMenu.ws)} />
            {useWorkspaceGroupStore.getState().getSiblingsOf(contextMenu.ws.id).length > 0 && (
              <ContextItem icon={<Link2 size={12} />} label="Unlink from Group" onClick={() => handleContextAction('unlink', contextMenu.ws)} />
            )}
            {isRunning(contextMenu.ws) && (
              <ContextItem icon={<Square size={12} />} label="Stop" onClick={() => handleContextAction('stop', contextMenu.ws)} />
            )}
            {!isRunning(contextMenu.ws) && (
              <ContextItem
                icon={isWorkspaceArchiving(workspaceOperations.get(contextMenu.ws.id))
                  ? <LoaderCircle size={12} className="animate-spin" />
                  : <Trash2 size={12} />}
                label={isWorkspaceArchiving(workspaceOperations.get(contextMenu.ws.id))
                  ? (formatWorkspaceOperationLabel(workspaceOperations.get(contextMenu.ws.id)) ?? 'Archiving')
                  : 'Archive'}
                onClick={() => handleContextAction('archive', contextMenu.ws)}
                disabled={isWorkspaceArchiving(workspaceOperations.get(contextMenu.ws.id))}
              />
            )}
            <div className="my-1 border-t border-border/60" />
            <ContextItem icon={<Trash2 size={12} />} label="Delete" onClick={() => handleContextAction('delete', contextMenu.ws)} danger />
          </div>
        </>
      )}
    </div>
  );
}

function ContextItem({
  icon,
  label,
  onClick,
  danger,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-[12px] ${
        danger ? 'text-error hover:bg-error/10' : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
      } ${disabled ? 'cursor-not-allowed opacity-60 hover:bg-transparent hover:text-text-secondary' : ''}`}
    >
      {icon}
      {label}
    </button>
  );
}

function WorkspaceListItem({
  workspace,
  operation,
  isActive,
  shortcutIndex,
  onSelect,
  onOpenContextMenu,
  onArchive,
}: {
  workspace: Workspace;
  operation?: WorkspaceOperation;
  isActive: boolean;
  shortcutIndex: number;
  onSelect: () => void;
  onOpenContextMenu: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onArchive: () => void | Promise<void>;
}) {
  const connectedSshHosts = useUiStore((s) => s.connectedSshHosts);
  const isSshWorkspace = !!workspace.sshHost;
  const sshAvailable = isSshWorkspace ? connectedSshHosts.has(workspace.sshHost!) : true;
  const isArchiving = isWorkspaceArchiving(operation);
  const outcomeImpliesChanges = workspace.outcome === 'ready_for_pr'
    || workspace.outcome === 'reviewing'
    || workspace.outcome === 'changes_requested'
    || workspace.outcome === 'ready_to_merge'
    || workspace.outcome === 'merged'
    || workspace.outcome === 'ready_to_archive';
  const shouldCheckForChanges = !isArchiving
    && workspace.mode !== 'plan'
    && workspace.status !== 'running'
    && workspace.status !== 'waiting_approval'
    && workspace.status !== 'waiting_input'
    && workspace.status !== 'error'
    && workspace.status !== 'merging'
    && !outcomeImpliesChanges;
  const hasChanges = useWorkspaceHasChanges(shouldCheckForChanges ? workspace.id : undefined, {
    fallback: outcomeImpliesChanges,
    pollMs: shouldCheckForChanges && isActive ? 5000 : null,
  });
  const signal = getWorkspaceListSignal(workspace, operation, { hasChanges });
  const archiveLabel = formatWorkspaceOperationLabel(operation) ?? 'Archive';
  const actionNeeded = isActionNeededState(signal.state);
  const siblings = useWorkspaceGroupStore((s) => s.getSiblingsOf(workspace.id));
  const linkedTooltip = siblings.length > 0
    ? `Linked with ${siblings.map((member) => `${member.workspaceName} (${member.branch})`).join(', ')}`
    : undefined;

  const [committing, setCommitting] = useState(false);
  const isTerminal = workspace.status === 'done' || workspace.status === 'error';
  const showReviewAlways = workspace.outcome === 'ready_for_pr' || workspace.outcome === 'ready_to_merge';
  const showInlineActions = hasChanges && !isTerminal;

  const handleReview = (e: React.MouseEvent) => {
    e.stopPropagation();
    useWorkspaceStore.getState().toggleChangesPanel(workspace.id);
  };

  const handleCommit = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (committing) return;
    setCommitting(true);
    try {
      const result = await window.api.invoke('workspace:commit', { workspaceId: workspace.id });
      toast.success(`Committed ${result.sha}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Commit failed');
    } finally {
      setCommitting(false);
    }
  };

  const sshDisabled = isSshWorkspace && !sshAvailable;
  const sshTooltip = isSshWorkspace
    ? (sshAvailable ? `SSH: ${workspace.sshHost}` : `SSH disconnected: ${workspace.sshHost}`)
    : undefined;

  return (
    <button
      onClick={sshDisabled ? undefined : onSelect}
      onContextMenu={sshDisabled ? undefined : onOpenContextMenu}
      title={sshDisabled ? sshTooltip : signal.tooltip}
      aria-label={signal.ariaLabel}
      className={`group classic-list-button ${isActive ? 'classic-list-button-active' : ''} ${actionNeeded ? 'workspace-row-action-needed' : ''} ${sshDisabled ? 'opacity-40 pointer-events-none' : ''}`}
      style={actionNeeded ? { '--workspace-signal-color': `var(--color-${signal.state === 'awaiting_approval' ? 'warning' : signal.state === 'awaiting_input' ? 'info' : 'error'})` } as React.CSSProperties : undefined}
    >
      <div className="relative shrink-0" aria-hidden="true">
        <WorkspaceLifecycleIcon state={signal.state} size={8} className={signal.iconColor} />
      </div>
      {workspace.direct && (
        <span className="shrink-0 text-warning" title="Direct mode — changes apply to the parent repo">
          <Zap size={12} />
        </span>
      )}
      {isSshWorkspace && (
        <span className={`shrink-0 ${sshAvailable ? 'text-accent' : 'text-text-tertiary'}`} title={sshTooltip}>
          <Monitor size={12} />
        </span>
      )}
      {siblings.length > 0 && (
        <span className="shrink-0 text-accent" title={linkedTooltip}>
          <Link2 size={12} />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium text-text-primary">
          <AnimatedWorkspaceName name={workspace.name} />
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-text-tertiary">
          {sshDisabled ? (
            <span className="font-medium text-text-tertiary">SSH disconnected</span>
          ) : actionNeeded ? (
            <span className={`font-medium ${signal.iconColor}`}>{signal.label}</span>
          ) : (
            <>
              <GitBranch size={10} className="opacity-50" />
              <span className="truncate font-mono">{workspace.branch}</span>
            </>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-0.5 self-start">
        {(showInlineActions || showReviewAlways) && (
          <span
            role="button"
            tabIndex={-1}
            title="Review changes"
            onClick={handleReview}
            className={`rounded-lg p-1 text-text-tertiary transition-opacity hover:text-accent ${
              showReviewAlways ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
            }`}
          >
            <Eye size={12} />
          </span>
        )}
        {showInlineActions && (
          <span
            role="button"
            tabIndex={-1}
            title="Commit changes"
            onClick={handleCommit}
            className="rounded-lg p-1 text-text-tertiary opacity-0 transition-opacity group-hover:opacity-100 hover:text-success"
          >
            {committing ? <LoaderCircle size={12} className="animate-spin" /> : <GitCommit size={12} />}
          </span>
        )}
        <span
          role="button"
          tabIndex={-1}
          title={archiveLabel}
          onClick={(event) => {
            event.stopPropagation();
            if (isArchiving) return;
            void onArchive();
          }}
          className={`rounded-lg p-1 text-text-tertiary opacity-0 transition-opacity group-hover:opacity-100 ${
            isArchiving ? 'cursor-not-allowed opacity-100' : 'hover:text-text-primary'
          }`}
        >
          {isArchiving ? <LoaderCircle size={12} className="animate-spin" /> : <Trash2 size={12} />}
        </span>
        {shortcutIndex < 9 && (
          <span className="px-1 text-[10px] text-text-tertiary/50 font-mono">{'\u2318'}{shortcutIndex + 1}</span>
        )}
      </div>
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
