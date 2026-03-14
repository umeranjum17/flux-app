import { useMemo } from 'react';
import { Plus, X } from 'lucide-react';
import { useChatStore } from '../../stores/chat';
import { useAgentStore } from '../../stores/agent';
import { useUiStore } from '../../stores/ui';
import { useWorkspaceStore } from '../../stores/workspace';
import type { TaskStatus } from '../../lib/types';

function StatusDot({ status }: { status: TaskStatus }) {
  switch (status) {
    case 'running':
      return <span className="w-2 h-2 rounded-full bg-accent animate-pulse shrink-0" />;
    case 'waiting_approval':
    case 'waiting_input':
      return <span className="w-2 h-2 rounded-full bg-warning animate-pulse shrink-0" />;
    case 'done':
      return <span className="w-2 h-2 rounded-full bg-success shrink-0" />;
    case 'error':
      return <span className="w-2 h-2 rounded-full bg-error shrink-0" />;
    default:
      return <span className="w-2 h-2 rounded-full bg-text-tertiary/30 shrink-0" />;
  }
}

export function TabBar() {
  const tabOrder = useChatStore((s) => s.tabOrder);
  const tasks = useChatStore((s) => s.tasks);
  const activeTaskId = useChatStore((s) => s.activeTaskId);
  const setActiveTask = useChatStore((s) => s.setActiveTask);
  const closeTab = useChatStore((s) => s.closeTab);
  const createTask = useChatStore((s) => s.createTask);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const workspaces = useWorkspaceStore((s) => s.workspaces);

  const { selectedAgentId, selectedModel, selectedThinking } = useAgentStore();
  const { mode } = useUiStore();

  // Filter tabs: show only chats belonging to the active workspace,
  // or standalone chats when no workspace is selected
  const visibleTabs = useMemo(() => {
    return tabOrder.filter((id) => {
      const task = tasks.get(id);
      if (!task) return false;
      if (activeWorkspaceId) {
        return task.workspaceId === activeWorkspaceId;
      }
      return !task.workspaceId;
    });
  }, [tabOrder, tasks, activeWorkspaceId]);

  if (visibleTabs.length === 0 && !activeWorkspaceId) return null;

  const handleNewTab = () => {
    const taskId = crypto.randomUUID();
    const activeWorkspace = activeWorkspaceId ? workspaces.get(activeWorkspaceId) : null;
    createTask({
      id: taskId,
      title: 'New task',
      agentId: (activeWorkspace?.agentId as any) ?? selectedAgentId,
      model: activeWorkspace?.model ?? selectedModel,
      mode,
      thinking: selectedThinking,
      cwd: activeWorkspace?.worktreePath ?? (useUiStore.getState().cwd || '.'),
      workspaceId: activeWorkspace?.id,
    });
  };

  return (
    <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border/70 px-3 pt-2">
      {visibleTabs.map((id) => {
        const task = tasks.get(id);
        if (!task) return null;
        const isActive = id === activeTaskId;
        const needsAttention = task.status === 'waiting_approval' || task.status === 'waiting_input';

        return (
          <div
            key={id}
            onClick={() => {
              setActiveTask(id);
              if (task.workspaceId) {
                useWorkspaceStore.getState().setActiveWorkspace(task.workspaceId);
              }
            }}
            className={`group chrome-tab relative flex min-w-0 max-w-[260px] cursor-pointer items-center gap-2 px-3.5 py-2.5 text-[13px] ${
              isActive
                ? 'chrome-tab-active'
                : needsAttention
                  ? 'text-warning'
                  : ''
            }`}
          >
            <StatusDot status={task.status} />
            <span className="truncate font-medium">
              {task.title.slice(0, 30) || 'Untitled'}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                closeTab(id);
              }}
              className="premium-toolbar-button ml-auto flex-shrink-0 rounded-lg p-1 text-text-tertiary opacity-0 transition-all group-hover:opacity-100"
            >
              <X size={11} />
            </button>
          </div>
        );
      })}
      <button
        onClick={handleNewTab}
        className="premium-toolbar-button ml-1 flex-shrink-0 rounded-lg p-2 text-text-secondary"
        aria-label="New tab"
      >
        <Plus size={13} />
      </button>
    </div>
  );
}
