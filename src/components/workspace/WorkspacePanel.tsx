import { useWorkspaceStore } from '../../stores/workspace';
import { useChatStore } from '../../stores/chat';
import { MessageList } from '../chat/MessageList';
import { ChatInput } from '../input/ChatInput';
import { ArrowLeft, Eye } from 'lucide-react';
import { AnimatedWorkspaceName } from './AnimatedWorkspaceName';

export function WorkspacePanel() {
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const workspace = activeWorkspaceId ? workspaces.get(activeWorkspaceId) : null;

  if (!workspace) {
    return (
      <div className="chrome-stage flex flex-1 items-center justify-center text-text-tertiary">
        <p>Select a workspace to view its chat</p>
      </div>
    );
  }

  return (
    <div className="chrome-stage flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border/70 bg-bg-primary/18 px-5 py-4">
        <button
          onClick={() => {
            useWorkspaceStore.getState().setActiveWorkspace(null);
            useChatStore.getState().setActiveTask(null);
          }}
          className="premium-toolbar-button rounded-xl p-2 text-text-secondary"
          title="Back to dashboard"
        >
          <ArrowLeft size={14} />
        </button>
        <div className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-text-primary">
            <AnimatedWorkspaceName name={workspace.name} />
          </span>
          <span className="text-[10px] uppercase tracking-[0.14em] text-text-tertiary">{workspace.branch} · {workspace.agentId} · {workspace.model}</span>
        </div>
        <button
          onClick={() => useWorkspaceStore.getState().toggleChangesPanel(workspace.id)}
          className="premium-toolbar-button inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] text-text-secondary"
          title="Review changes"
        >
          <Eye size={14} />
          Review
        </button>
      </div>

      <MessageList />

      <div className="shrink-0 border-t border-border/70 bg-bg-primary/28 px-5 py-4">
        <ChatInput focused />
      </div>
    </div>
  );
}
