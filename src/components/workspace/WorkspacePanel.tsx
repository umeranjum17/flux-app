import { useWorkspaceStore } from '../../stores/workspace';
import { useChatStore } from '../../stores/chat';
import { MessageList } from '../chat/MessageList';
import { ChatInput } from '../input/ChatInput';
import { ArrowLeft, Eye, GitMerge } from 'lucide-react';

export function WorkspacePanel() {
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const workspace = activeWorkspaceId ? workspaces.get(activeWorkspaceId) : null;

  if (!workspace) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-tertiary">
        <p>Select a workspace to view its chat</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Workspace header */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border shrink-0 bg-bg-secondary">
        <button
          onClick={() => {
            useWorkspaceStore.getState().setActiveWorkspace(null);
            useChatStore.getState().setActiveTask(null);
          }}
          className="p-1 rounded hover:bg-bg-hover text-text-tertiary hover:text-text-primary transition-colors"
          title="Back to dashboard"
        >
          <ArrowLeft size={14} />
        </button>
        <div className="min-w-0 flex-1">
          <span className="text-xs font-medium text-text-primary truncate block">{workspace.name}</span>
          <span className="text-[10px] text-text-tertiary">{workspace.branch} &middot; {workspace.agentId} &middot; {workspace.model}</span>
        </div>
        <button
          onClick={() => useWorkspaceStore.getState().openReview(workspace.id)}
          className="p-1.5 rounded-md text-text-tertiary hover:bg-bg-hover hover:text-text-primary transition-colors"
          title="Review changes"
        >
          <Eye size={14} />
        </button>
      </div>

      {/* Chat */}
      <MessageList />

      {/* Input */}
      <div className="px-3 py-2 border-t border-border shrink-0">
        <ChatInput focused />
      </div>
    </div>
  );
}
