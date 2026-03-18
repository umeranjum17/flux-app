import { useMemo, useCallback } from 'react';
import { Plus, X } from 'lucide-react';
import { useChatStore } from '../../stores/chat';
import { useUiStore } from '../../stores/ui';
import { useAgentStore } from '../../stores/agent';
import { useWorkspaceStore } from '../../stores/workspace';

export function ChatsPanel() {
  const tasks = useChatStore((s) => s.tasks);
  const activeTaskId = useChatStore((s) => s.activeTaskId);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);

  const contextlessChats = useMemo(
    () => Array.from(tasks.values()).filter((t) => t.contextless),
    [tasks],
  );

  const handleSelect = useCallback((taskId: string) => {
    useWorkspaceStore.getState().setActiveWorkspace(null);
    useChatStore.getState().setActiveTask(taskId);
    useUiStore.getState().setBottomPanelMode('agent');
  }, []);

  const handleNewChat = useCallback(() => {
    const { selectedAgentId, selectedModel, selectedThinking } = useAgentStore.getState();
    const mode = useUiStore.getState().mode;
    const taskId = crypto.randomUUID();
    useChatStore.getState().createTask({
      id: taskId,
      title: 'Incognito Chat',
      agentId: selectedAgentId,
      model: selectedModel,
      mode,
      thinking: selectedThinking,
      cwd: '.',
      contextless: true,
    });
    useWorkspaceStore.getState().setActiveWorkspace(null);
    useChatStore.getState().setActiveTask(taskId);
    useUiStore.getState().setBottomPanelMode('agent');
  }, []);

  const handleDismiss = useCallback((taskId: string) => {
    const task = useChatStore.getState().tasks.get(taskId);
    if (task && (task.status === 'running' || task.status === 'waiting_approval' || task.status === 'waiting_input')) {
      window.api?.invoke('task:stop', { taskId }).catch(() => {});
    }
    useChatStore.getState().removeTask(taskId);
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between px-3 pt-3 pb-1">
        <span className="classic-section-label">Incognito Chats</span>
        <button
          onClick={handleNewChat}
          className="premium-toolbar-button rounded-md p-1.5 text-text-secondary"
          title="New incognito chat"
        >
          <Plus size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2">
        {contextlessChats.length === 0 && (
          <div className="px-3 py-6 text-center">
            <p className="text-[13px] text-text-secondary">No incognito chats</p>
            <p className="mt-1 text-[11px] text-text-tertiary">
              Context-free chats without project or workspace context.
            </p>
          </div>
        )}

        {contextlessChats.map((task) => {
          const isActive = task.id === activeTaskId && !activeWorkspaceId;
          return (
            <button
              key={task.id}
              onClick={() => handleSelect(task.id)}
              className={`group classic-list-button ${isActive ? 'classic-list-button-active' : ''}`}
            >
              <span className={`lifecycle-dot ${statusColor(task.status)}`} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium text-text-primary">
                  {task.title || 'Untitled'}
                </div>
              </div>
              <span
                role="button"
                tabIndex={-1}
                title="Dismiss"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDismiss(task.id);
                }}
                className="rounded-lg p-1 text-text-tertiary opacity-0 transition-opacity group-hover:opacity-100 hover:text-text-primary"
              >
                <X size={12} />
              </span>
            </button>
          );
        })}
      </div>
    </div>
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
