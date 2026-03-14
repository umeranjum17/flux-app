import { useState, useMemo, useCallback } from 'react';
import { Plus, GitBranch, ChevronDown, ChevronRight, Eye, GitMerge, Square, Trash2 } from 'lucide-react';
import { useWorkspaceStore } from '../../stores/workspace';
import { useChatStore } from '../../stores/chat';
import { useUiStore } from '../../stores/ui';
import { workspaceStatusConfig } from '../../lib/workspace-status';
import type { Workspace } from '../../lib/ipc-api';

export function WorkspaceTab() {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const tasks = useChatStore((s) => s.tasks);
  const activeTaskId = useChatStore((s) => s.activeTaskId);
  const [showCreate, setShowCreate] = useState(false);
  const [chatsCollapsed, setChatsCollapsed] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; ws: Workspace } | null>(null);

  const workspaceList = useMemo(
    () => Array.from(workspaces.values()).sort((a, b) => b.updatedAt - a.updatedAt),
    [workspaces],
  );

  const standaloneTasks = useMemo(
    () => Array.from(tasks.values()).filter((t) => !workspaces.has(t.id)),
    [tasks, workspaces],
  );

  const handleSelectWorkspace = useCallback((ws: Workspace) => {
    useWorkspaceStore.getState().setActiveWorkspace(ws.id);
    useChatStore.getState().setActiveTask(ws.id);
    useUiStore.getState().setBottomPanelMode('agent');
  }, []);

  const handleSelectChat = useCallback((taskId: string) => {
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
      case 'stop':
        window.api.invoke('workspace:stop', { workspaceId: ws.id }).then(() => {
          useWorkspaceStore.getState().updateWorkspace(ws.id, { status: 'done' });
          useChatStore.getState().setTaskStatus(ws.id, 'done');
        });
        break;
      case 'delete':
        window.api.invoke('workspace:delete', { workspaceId: ws.id }).then(() => {
          useWorkspaceStore.getState().removeWorkspace(ws.id);
          useChatStore.getState().removeTask(ws.id);
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
          onClick={() => setShowCreate(!showCreate)}
          className="premium-toolbar-button rounded-lg p-1.5 text-text-secondary"
          title="New workspace"
        >
          <Plus size={14} />
        </button>
      </div>

      {showCreate && <QuickCreate onClose={() => setShowCreate(false)} />}

      <div className="flex-1 overflow-y-auto px-3">
        {workspaceList.length === 0 && !showCreate && (
          <div className="px-3 py-6 text-center">
            <p className="text-[12px] text-text-secondary">No workspaces</p>
            <p className="mt-1 text-[10px] text-text-tertiary">Create one to run agents on isolated branches.</p>
          </div>
        )}
        {workspaceList.map((ws, idx) => {
          const status = workspaceStatusConfig[ws.status] ?? workspaceStatusConfig.idle;
          const isActive = ws.id === activeWorkspaceId && ws.id === activeTaskId;

          return (
            <button
              key={ws.id}
              onClick={() => handleSelectWorkspace(ws)}
              onContextMenu={(e) => {
                e.preventDefault();
                setContextMenu({ x: e.clientX, y: e.clientY, ws });
              }}
              className={`classic-list-button ${isActive ? 'classic-list-button-active' : ''}`}
            >
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
          );
        })}

        {/* Chats section */}
        {standaloneTasks.length > 0 && (
          <>
            <button
              onClick={() => setChatsCollapsed(!chatsCollapsed)}
              className="mt-4 mb-1 flex w-full items-center gap-1 px-1 text-[10px] font-medium uppercase tracking-[0.1em] text-text-tertiary hover:text-text-secondary"
            >
              {chatsCollapsed ? <ChevronRight size={10} /> : <ChevronDown size={10} />}
              Chats
              <span className="ml-auto text-[9px]">{standaloneTasks.length}</span>
            </button>
            {!chatsCollapsed && standaloneTasks.map((task) => {
              const isActive = task.id === activeTaskId && !activeWorkspaceId;
              return (
                <button
                  key={task.id}
                  onClick={() => handleSelectChat(task.id)}
                  className={`classic-list-button ${isActive ? 'classic-list-button-active' : ''}`}
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

/* ── Inline Quick Create ─────────────────── */

function QuickCreate({ onClose }: { onClose: () => void }) {
  const [prompt, setPrompt] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cwd = useUiStore((s) => s.cwd);

  const handleCreate = async () => {
    if (!prompt.trim() || !cwd) return;
    setCreating(true);
    setError(null);

    const name = prompt.trim().slice(0, 40);
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 20);
    const hash = Math.random().toString(36).slice(2, 6);
    const branch = `flux/${slug}-${hash}`;

    const { selectedAgentId: agentId, selectedModel: model } = await import('../../stores/agent').then((m) => m.useAgentStore.getState());

    let workspace: Workspace | null = null;
    try {
      workspace = await window.api.invoke('workspace:create', {
        name,
        parentRepo: cwd,
        branch,
        agentId,
        model,
      }) as Workspace;

      useWorkspaceStore.getState().addWorkspace(workspace);
      useWorkspaceStore.getState().setActiveWorkspace(workspace.id);

      useChatStore.getState().createTask({
        id: workspace.id,
        title: `[WS] ${workspace.name}`,
        agentId: workspace.agentId as any,
        model: workspace.model,
        mode: 'act',
        thinking: 'medium',
        cwd: workspace.worktreePath,
      });
      useChatStore.getState().setTaskStatus(workspace.id, 'running');
      useChatStore.getState().setActiveTask(workspace.id);
      useWorkspaceStore.getState().updateWorkspace(workspace.id, { status: 'running' });

      const result = await window.api.invoke('workspace:spawn', {
        workspaceId: workspace.id,
        prompt: prompt.trim(),
        mode: 'act' as const,
      }) as { session: { id: string } };

      useChatStore.getState().setTaskSessionId(workspace.id, result.session.id);
      useWorkspaceStore.getState().updateWorkspace(workspace.id, {
        status: 'running',
        sessionId: result.session.id,
      });

      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      if (workspace) {
        useWorkspaceStore.getState().updateWorkspace(workspace.id, { status: 'error' });
        useChatStore.getState().setTaskStatus(workspace.id, 'error');
      }
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="mx-3 mb-2 rounded-lg border border-border/80 bg-bg-surface p-3">
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleCreate();
          }
          if (e.key === 'Escape') onClose();
        }}
        placeholder="What should this workspace work on?"
        rows={3}
        autoFocus
        className="w-full resize-none rounded-md border border-border/60 bg-bg-primary px-2.5 py-2 text-xs text-text-primary placeholder:text-text-tertiary outline-none focus:border-accent"
      />
      {error && (
        <div className="mt-1.5 text-[10px] text-error">{error}</div>
      )}
      <div className="mt-2 flex items-center justify-between">
        <span className="text-[9px] text-text-tertiary">Enter to create · Esc to cancel</span>
        <button
          onClick={handleCreate}
          disabled={creating || !prompt.trim()}
          className="rounded-md bg-accent px-2.5 py-1 text-[10px] font-medium text-white hover:bg-accent/90 disabled:opacity-50"
        >
          {creating ? 'Creating...' : 'Create'}
        </button>
      </div>
    </div>
  );
}
