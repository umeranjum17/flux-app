import { useState, useMemo, useCallback } from 'react';
import { Plus, GitBranch, ChevronDown, ChevronRight, Eye, GitMerge, Square, Trash2, MessageSquare } from 'lucide-react';
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
  const activeTaskId = useChatStore((s) => s.activeTaskId);
  const [creating, setCreating] = useState(false);
  const [chatsCollapsed, setChatsCollapsed] = useState(false);
  const [expandedWorkspaces, setExpandedWorkspaces] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; ws: Workspace } | null>(null);

  const workspaceList = useMemo(
    () => Array.from(workspaces.values()).sort((a, b) => b.updatedAt - a.updatedAt),
    [workspaces],
  );

  const standaloneTasks = useMemo(
    () => Array.from(tasks.values()).filter((t) => !t.workspaceId),
    [tasks],
  );

  const workspaceTasksMap = useMemo(() => {
    const map = new Map<string, typeof tasks extends Map<string, infer T> ? T[] : never>();
    for (const task of tasks.values()) {
      if (task.workspaceId) {
        const existing = map.get(task.workspaceId) ?? [];
        existing.push(task);
        map.set(task.workspaceId, existing);
      }
    }
    return map;
  }, [tasks]);

  const toggleExpanded = useCallback((wsId: string) => {
    setExpandedWorkspaces((prev) => {
      const next = new Set(prev);
      if (next.has(wsId)) {
        next.delete(wsId);
      } else {
        next.add(wsId);
      }
      return next;
    });
  }, []);

  const handleSelectChat = useCallback((wsId: string | null, taskId: string) => {
    useWorkspaceStore.getState().setActiveWorkspace(wsId);
    useChatStore.getState().setActiveTask(taskId);
    useUiStore.getState().setBottomPanelMode('agent');
  }, []);

  const handleAddChatToWorkspace = useCallback((ws: Workspace) => {
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
    setExpandedWorkspaces((prev) => new Set([...prev, ws.id]));
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
      case 'stop':
        window.api.invoke('workspace:stop', { workspaceId: ws.id }).then(() => {
          useWorkspaceStore.getState().updateWorkspace(ws.id, { status: 'done' });
          // agent:done events update individual task statuses
        });
        break;
      case 'delete':
        window.api.invoke('workspace:delete', { workspaceId: ws.id }).then(() => {
          useWorkspaceStore.getState().removeWorkspace(ws.id);
          // Remove all tasks for this workspace
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
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <span className="classic-section-label">Workspaces</span>
        <button
          onClick={async () => {
            if (creating) return;
            const cwd = useUiStore.getState().cwd;
            if (!cwd) return;
            setCreating(true);
            try {
              const { selectedAgentId: agentId, selectedModel: model } = useAgentStore.getState();
              await createEmptyWorkspace({ agentId, model, cwd });
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              toast.error(message);
            } finally {
              setCreating(false);
            }
          }}
          disabled={creating}
          className="premium-toolbar-button rounded-lg p-1.5 text-text-secondary disabled:opacity-50"
          title="New workspace"
        >
          <Plus size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3">
        {workspaceList.length === 0 && (
          <div className="px-3 py-6 text-center">
            <p className="text-[12px] text-text-secondary">No workspaces</p>
            <p className="mt-1 text-[10px] text-text-tertiary">Click + to create one instantly.</p>
          </div>
        )}
        {workspaceList.map((ws, idx) => {
          const status = workspaceStatusConfig[ws.status] ?? workspaceStatusConfig.idle;
          const isActive = ws.id === activeWorkspaceId;
          const isExpanded = expandedWorkspaces.has(ws.id);
          const wsTasks = workspaceTasksMap.get(ws.id) ?? [];

          return (
            <div key={ws.id}>
              <button
                onClick={() => toggleExpanded(ws.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setContextMenu({ x: e.clientX, y: e.clientY, ws });
                }}
                className={`classic-list-button ${isActive ? 'classic-list-button-active' : ''}`}
              >
                {isExpanded ? <ChevronDown size={10} className="shrink-0 text-text-tertiary" /> : <ChevronRight size={10} className="shrink-0 text-text-tertiary" />}
                <span className={`mt-0.5 inline-block h-2 w-2 shrink-0 rounded-full ${status.color} ${status.pulse ? 'animate-pulse' : ''}`} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12px] font-medium text-text-primary">{ws.name}</div>
                  <div className="mt-0.5 flex items-center gap-1 text-[10px] text-text-tertiary">
                    <GitBranch size={9} />
                    <span className="truncate font-mono">{ws.branch}</span>
                  </div>
                </div>
                {idx < 9 && (
                  <span className="shrink-0 text-[9px] text-text-tertiary/50 font-mono">{'\u2318'}{idx + 1}</span>
                )}
              </button>

              {/* Nested chats */}
              {isExpanded && (
                <div className="ml-4 mb-1 border-l border-border/40 pl-2">
                  {wsTasks.map((task) => {
                    const isChatActive = task.id === activeTaskId;
                    return (
                      <button
                        key={task.id}
                        onClick={() => handleSelectChat(ws.id, task.id)}
                        className={`classic-list-button py-1 ${isChatActive ? 'classic-list-button-active' : ''}`}
                      >
                        <span className={`mt-0.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full ${statusColor(task.status)}`} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[11px] text-text-primary">{task.title || 'Untitled'}</div>
                        </div>
                      </button>
                    );
                  })}
                  <button
                    onClick={() => handleAddChatToWorkspace(ws)}
                    className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-[10px] text-text-tertiary hover:text-text-secondary hover:bg-bg-hover"
                  >
                    <Plus size={10} />
                    New chat
                  </button>
                </div>
              )}
            </div>
          );
        })}

        {/* Quick Chats section */}
        {standaloneTasks.length > 0 && (
          <>
            <button
              onClick={() => setChatsCollapsed(!chatsCollapsed)}
              className="mt-4 mb-1 flex w-full items-center gap-1 px-1 text-[10px] font-medium uppercase tracking-[0.1em] text-text-tertiary hover:text-text-secondary"
            >
              {chatsCollapsed ? <ChevronRight size={10} /> : <ChevronDown size={10} />}
              Quick Chats
              <span className="ml-auto text-[9px]">{standaloneTasks.length}</span>
            </button>
            {!chatsCollapsed && standaloneTasks.map((task) => {
              const isChatActive = task.id === activeTaskId && !activeWorkspaceId;
              return (
                <button
                  key={task.id}
                  onClick={() => handleSelectChat(null, task.id)}
                  className={`classic-list-button ${isChatActive ? 'classic-list-button-active' : ''}`}
                >
                  <span className={`mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full ${statusColor(task.status)}`} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12px] font-medium text-text-primary">{task.title || 'Untitled'}</div>
                    <div className="mt-0.5 text-[10px] text-text-tertiary">{task.status.replace('_', ' ')}</div>
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
            <ContextItem icon={<MessageSquare size={12} />} label="New Chat" onClick={() => { setContextMenu(null); handleAddChatToWorkspace(contextMenu.ws); }} />
            {isRunning(contextMenu.ws) && (
              <ContextItem icon={<Square size={12} />} label="Stop" onClick={() => handleContextAction('stop', contextMenu.ws)} />
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
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-[11px] ${
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

