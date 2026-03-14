import { useState, useMemo, useCallback } from 'react';
import { Plus, GitBranch, Eye, GitMerge, Square, Trash2, MessageSquare, Archive } from 'lucide-react';
import { useWorkspaceStore } from '../../stores/workspace';
import { useChatStore } from '../../stores/chat';
import { useUiStore } from '../../stores/ui';
import { useAgentStore } from '../../stores/agent';
import { workspaceStatusConfig } from '../../lib/workspace-status';
import { createEmptyWorkspace } from '../../lib/workspace-state';
import type { Workspace } from '../../lib/ipc-api';
import { toast } from 'sonner';

export function WorkspaceTab() {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const tasks = useChatStore((s) => s.tasks);
  const isGitRepo = useUiStore((s) => s.isGitRepo);
  const [creating, setCreating] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; ws: Workspace } | null>(null);

  const workspaceList = useMemo(
    () => Array.from(workspaces.values()).sort((a, b) => b.updatedAt - a.updatedAt),
    [workspaces],
  );

  const standaloneTasks = useMemo(
    () => Array.from(tasks.values()).filter((t) => !t.workspaceId),
    [tasks],
  );

  const handleSelectWorkspace = useCallback((wsId: string) => {
    const wsStore = useWorkspaceStore.getState();
    const chatStore = useChatStore.getState();
    wsStore.setActiveWorkspace(wsId);
    // Auto-select the most recent task for this workspace
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
        useWorkspaceStore.getState().openReview(ws.id);
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

  const isRunning = (ws: Workspace) =>
    ws.status === 'running' || ws.status === 'waiting_approval' || ws.status === 'waiting_input';

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Workspaces section */}
      <div className="flex items-center justify-between px-3.5 pt-3.5 pb-1.5">
        <span className="classic-section-label">Workspaces</span>
        <button
          onClick={async () => {
            if (creating) return;
            const cwd = useUiStore.getState().cwd;
            if (!cwd) return;
            setCreating(true);
            try {
              const { selectedAgentId: agentId, selectedModel: model, selectedThinking } = useAgentStore.getState();
              const ws = await createEmptyWorkspace({ agentId, model, cwd });
              // Auto-create first chat so the user can start typing immediately
              const taskId = crypto.randomUUID();
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
              useChatStore.getState().setActiveTask(taskId);
              useUiStore.getState().setBottomPanelMode('agent');
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              toast.error(message);
            } finally {
              setCreating(false);
            }
          }}
          disabled={creating || !isGitRepo}
          className="premium-toolbar-button rounded-lg p-1.5 text-text-secondary disabled:opacity-50"
          title={isGitRepo ? 'New workspace' : 'Not a git repository — run "git init" first'}
        >
          <Plus size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2.5">
        {workspaceList.length === 0 && standaloneTasks.length === 0 && (
          <div className="px-3 py-6 text-center">
            <p className="text-[13px] text-text-secondary">No workspaces</p>
            <p className="mt-1 text-[11px] text-text-tertiary">Click + to create one.</p>
          </div>
        )}
        {workspaceList.map((ws, idx) => {
          const status = workspaceStatusConfig[ws.status] ?? workspaceStatusConfig.idle;
          const isActive = ws.id === activeWorkspaceId;

          return (
            <button
              key={ws.id}
              onClick={() => handleSelectWorkspace(ws.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                setContextMenu({ x: e.clientX, y: e.clientY, ws });
              }}
              className={`group classic-list-button ${isActive ? 'classic-list-button-active' : ''}`}
            >
              <span className={`mt-0.5 inline-block h-2 w-2 shrink-0 rounded-full ${status.color} ${status.pulse ? 'animate-pulse' : ''}`} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium text-text-primary">{ws.name}</div>
                <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-text-tertiary">
                  <GitBranch size={10} />
                  <span className="truncate font-mono">{ws.branch}</span>
                </div>
              </div>
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
                <Archive size={12} />
              </span>
              {idx < 9 && (
                <span className="shrink-0 text-[10px] text-text-tertiary/50 font-mono">{'\u2318'}{idx + 1}</span>
              )}
            </button>
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
                  <span className={`mt-0.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full ${statusColor(task.status)}`} />
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
            className="fixed z-50 min-w-[160px] rounded-lg border border-border bg-bg-primary py-1 shadow-xl"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <ContextItem icon={<Eye size={12} />} label="Review Changes" onClick={() => handleContextAction('review', contextMenu.ws)} />
            <ContextItem icon={<GitMerge size={12} />} label="Merge" onClick={() => handleContextAction('merge', contextMenu.ws)} />
            <ContextItem icon={<MessageSquare size={12} />} label="New Chat" onClick={() => handleContextAction('new-chat', contextMenu.ws)} />
            {isRunning(contextMenu.ws) && (
              <ContextItem icon={<Square size={12} />} label="Stop" onClick={() => handleContextAction('stop', contextMenu.ws)} />
            )}
            <ContextItem icon={<Archive size={12} />} label="Archive" onClick={() => handleContextAction('archive', contextMenu.ws)} />
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
    case 'waiting_input': return 'bg-info';
    case 'done': return 'bg-info';
    case 'error': return 'bg-error';
    default: return 'bg-text-tertiary';
  }
}
