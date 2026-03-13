import { Plus, X } from 'lucide-react';
import { useChatStore } from '../../stores/chat';
import { useAgentStore } from '../../stores/agent';
import { useUiStore } from '../../stores/ui';
import type { TaskStatus, AgentId } from '../../lib/types';

const AGENT_LABELS: Record<string, string> = {
  'claude-code': 'Claude',
  codex: 'Codex',
  gemini: 'Gemini',
  openai: 'OpenAI',
  ollama: 'Ollama',
};

function StatusDot({ status }: { status: TaskStatus }) {
  switch (status) {
    case 'running':
      return <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />;
    case 'waiting_approval':
    case 'waiting_input':
      return <span className="w-1.5 h-1.5 rounded-full bg-warning animate-pulse" />;
    case 'done':
      return <span className="w-1.5 h-1.5 rounded-full bg-success" />;
    case 'error':
      return <span className="w-1.5 h-1.5 rounded-full bg-error" />;
    default:
      return <span className="w-1.5 h-1.5 rounded-full bg-text-tertiary/40" />;
  }
}

export function TabBar() {
  const tabOrder = useChatStore((s) => s.tabOrder);
  const tasks = useChatStore((s) => s.tasks);
  const activeTaskId = useChatStore((s) => s.activeTaskId);
  const setActiveTask = useChatStore((s) => s.setActiveTask);
  const closeTab = useChatStore((s) => s.closeTab);
  const createTask = useChatStore((s) => s.createTask);

  const { selectedAgentId, selectedModel, selectedThinking } = useAgentStore();
  const { mode } = useUiStore();

  if (tabOrder.length === 0) return null;

  const handleNewTab = () => {
    const taskId = crypto.randomUUID();
    createTask({
      id: taskId,
      title: 'New task',
      agentId: selectedAgentId,
      model: selectedModel,
      mode,
      thinking: selectedThinking,
      cwd: useUiStore.getState().cwd || '.',
    });
  };

  return (
    <div className="flex items-center gap-0 bg-bg-secondary/40 border-b border-border-subtle shrink-0 px-1 overflow-x-auto">
      {tabOrder.map((id) => {
        const task = tasks.get(id);
        if (!task) return null;
        const isActive = id === activeTaskId;
        const needsAttention = task.status === 'waiting_approval' || task.status === 'waiting_input';

        return (
          <div
            key={id}
            onClick={() => setActiveTask(id)}
            className={`group relative flex items-center gap-1.5 px-3 py-1 text-[11px] cursor-pointer border-b-[1.5px] transition-colors min-w-0 max-w-[180px] ${
              isActive
                ? 'border-accent text-text-primary bg-bg-elevated/40'
                : needsAttention
                  ? 'border-transparent text-warning hover:text-text-secondary hover:bg-bg-hover/40'
                  : 'border-transparent text-text-tertiary hover:text-text-secondary hover:bg-bg-hover/40'
            }`}
          >
            <StatusDot status={task.status} />
            <span className="truncate font-medium">
              {AGENT_LABELS[task.agentId] ?? task.agentId}
            </span>
            <span className="truncate text-text-tertiary hidden sm:inline">
              {task.title.slice(0, 20)}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                closeTab(id);
              }}
              className="ml-auto flex-shrink-0 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-bg-hover text-text-tertiary hover:text-text-primary transition-all"
            >
              <X size={11} />
            </button>
          </div>
        );
      })}
      <button
        onClick={handleNewTab}
        className="flex-shrink-0 p-1.5 rounded text-text-tertiary hover:text-text-secondary hover:bg-bg-hover transition-colors"
        aria-label="New tab"
      >
        <Plus size={13} />
      </button>
    </div>
  );
}
