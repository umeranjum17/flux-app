import { Eye, GitMerge, Square, Trash2, GitBranch, ExternalLink } from 'lucide-react';
import { useWorkspaceStore } from '../../stores/workspace';
import { useChatStore } from '../../stores/chat';
import { workspaceStatusConfig } from '../../lib/workspace-status';

export function WorkspaceActionBar() {
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const workspace = activeWorkspaceId ? workspaces.get(activeWorkspaceId) : null;

  if (!workspace) return null;

  const status = workspaceStatusConfig[workspace.status] ?? workspaceStatusConfig.idle;
  const isRunning = workspace.status === 'running' || workspace.status === 'waiting_approval' || workspace.status === 'waiting_input';

  const handleStop = async () => {
    await window.api.invoke('workspace:stop', { workspaceId: workspace.id });
    useWorkspaceStore.getState().updateWorkspace(workspace.id, { status: 'done' });
    const chatStore = useChatStore.getState();
    for (const task of chatStore.tasks.values()) {
      if (task.workspaceId === workspace.id) {
        chatStore.setTaskStatus(task.id, 'done');
      }
    }
  };

  const handleDelete = async () => {
    await window.api.invoke('workspace:delete', { workspaceId: workspace.id });
    useWorkspaceStore.getState().removeWorkspace(workspace.id);
    const chatStore = useChatStore.getState();
    for (const task of [...chatStore.tasks.values()]) {
      if (task.workspaceId === workspace.id) {
        chatStore.removeTask(task.id);
      }
    }
  };

  const handleOpenIde = async () => {
    await window.api.invoke('workspace:open-ide', { workspaceId: workspace.id });
  };

  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-border/70 bg-bg-secondary/40 px-4 py-2">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <GitBranch size={13} className="shrink-0 text-text-tertiary" />
        <span className="truncate font-mono text-[12px] text-text-secondary">{workspace.branch}</span>
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${status.color}/15 text-text-tertiary`}>
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${status.color} ${status.pulse ? 'animate-pulse' : ''}`} />
          {status.label}
        </span>
      </div>
      <div className="flex items-center gap-1">
        {isRunning && (
          <ActionBtn icon={<Square size={12} />} label="Stop" onClick={handleStop} />
        )}
        <ActionBtn icon={<ExternalLink size={12} />} label="Open IDE" onClick={handleOpenIde} />
        <ActionBtn icon={<Eye size={12} />} label="Review" onClick={() => useWorkspaceStore.getState().openReview(workspace.id)} />
        <ActionBtn icon={<GitMerge size={12} />} label="Merge" onClick={() => useWorkspaceStore.getState().openMerge(workspace.id)} />
        <ActionBtn icon={<Trash2 size={12} />} label="Delete" onClick={handleDelete} danger />
      </div>
    </div>
  );
}

function ActionBtn({ icon, label, onClick, danger }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={`premium-toolbar-button rounded-lg p-1.5 text-text-tertiary transition-colors ${
        danger ? 'hover:bg-error/10 hover:text-error' : 'hover:bg-bg-hover hover:text-text-primary'
      }`}
    >
      {icon}
    </button>
  );
}
