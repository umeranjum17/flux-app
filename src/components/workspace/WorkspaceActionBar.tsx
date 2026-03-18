import { useEffect, useRef } from 'react';
import { Eye, GitMerge, Square, Trash2, GitBranch, ExternalLink, Files, Search, Archive, TerminalSquare, LoaderCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useWorkspaceStore } from '../../stores/workspace';
import { useUiStore } from '../../stores/ui';
import { useWorkspaceHasChanges } from '../../hooks/useWorkspaceHasChanges';
import { useChatStore } from '../../stores/chat';
import { getWorkspaceLifecycleState, isTerminalOutcome, workspaceLifecycleConfig } from '../../lib/workspace-status';
import { archiveWorkspace, formatWorkspaceOperationLabel, isWorkspaceArchiving } from '../../lib/workspace-operations';

export function WorkspaceActionBar() {
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const operation = useWorkspaceStore((s) => (activeWorkspaceId ? s.workspaceOperations.get(activeWorkspaceId) : undefined));
  const workspace = activeWorkspaceId ? workspaces.get(activeWorkspaceId) : null;

  const isRunning = workspace?.status === 'running' || workspace?.status === 'waiting_approval' || workspace?.status === 'waiting_input';
  const isMerged = isTerminalOutcome(workspace?.outcome);
  const hasChanges = useWorkspaceHasChanges(workspace?.id, {
    pollMs: isRunning ? 2000 : 4000,
  });
  const workspaceId = workspace?.id ?? null;
  const previousReviewStateRef = useRef<{ workspaceId: string | null; hasChanges: boolean }>({
    workspaceId: null,
    hasChanges: false,
  });

  useEffect(() => {
    if (!workspaceId) {
      previousReviewStateRef.current = { workspaceId: null, hasChanges: false };
      return;
    }

    const previousState = previousReviewStateRef.current;
    const hadChanges = previousState.workspaceId === workspaceId ? previousState.hasChanges : false;

    if (hasChanges && !hadChanges && !isMerged) {
      const store = useWorkspaceStore.getState();
      if (!store.changesPanelOpen || store.changesPanelWorkspaceId !== workspaceId) {
        void store.openChangesPanel(workspaceId);
      }
    }

    previousReviewStateRef.current = {
      workspaceId,
      hasChanges,
    };
  }, [hasChanges, isMerged, workspaceId]);

  if (!workspace) return null;

  const lifecycleState = getWorkspaceLifecycleState(workspace);
  const lifecycle = workspaceLifecycleConfig[lifecycleState] ?? workspaceLifecycleConfig.idle;
  const isArchiving = isWorkspaceArchiving(operation);
  const archiveLabel = formatWorkspaceOperationLabel(operation) ?? 'Archive';

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

  const handleArchive = async () => {
    try {
      await archiveWorkspace(workspace.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to archive workspace');
    }
  };

  const handleOpenIde = async () => {
    await window.api.invoke('workspace:open-ide', { workspaceId: workspace.id });
  };

  const handleOpenTerminal = () => {
    const uiStore = useUiStore.getState();
    // Store the pending request so TerminalPanel picks it up even if it hasn't mounted yet
    uiStore.setPendingWorkspaceTerminalId(workspace.id);
    uiStore.setBottomPanelMode('terminal');
    uiStore.setBottomPanelOpen(true);
    // Also dispatch the event for when the panel is already open
    window.dispatchEvent(new CustomEvent('flux:open-workspace-terminal', {
      detail: { workspaceId: workspace.id },
    }));
  };

  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-border/70 bg-bg-secondary/35 px-3 py-1.5">
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <GitBranch size={13} className="shrink-0 text-text-tertiary" />
        <span className="truncate font-mono text-[12px] text-text-secondary">{workspace.branch}</span>
        <span className={`lifecycle-badge ${lifecycle.badgeClass}`}>
          <span className={`lifecycle-dot h-[6px] w-[6px] ${lifecycle.color} ${lifecycle.dotMotionClass} ${lifecycle.glow ?? ''}`} />
          {lifecycle.label}
        </span>
      </div>
      <div className="flex items-center gap-1">
        <ActionBtn icon={<Files size={12} />} label="Files" onClick={() => useUiStore.getState().openWorkspacePanelTab('files')} />
        <ActionBtn icon={<Search size={12} />} label="Search" onClick={() => useUiStore.getState().openWorkspacePanelTab('search')} />
        {isRunning && (
          <ActionBtn icon={<Square size={12} />} label="Stop" onClick={handleStop} />
        )}
        <ActionBtn icon={<TerminalSquare size={12} />} label="Terminal" onClick={handleOpenTerminal} />
        <ActionBtn icon={<ExternalLink size={12} />} label="Open IDE" onClick={handleOpenIde} />
        {hasChanges && !isMerged && (
          <>
            <ActionBtn icon={<Eye size={12} />} label="Review Changes" onClick={() => useWorkspaceStore.getState().toggleChangesPanel(workspace.id)} />
            <ActionBtn icon={<GitMerge size={12} />} label="Merge" onClick={() => useWorkspaceStore.getState().openMerge(workspace.id)} />
          </>
        )}
        {!isRunning && (
          <>
            <ActionBtn
              icon={isArchiving ? <LoaderCircle size={12} className="animate-spin" /> : <Archive size={12} />}
              label={isArchiving ? archiveLabel : 'Archive'}
              title={archiveLabel}
              onClick={handleArchive}
              disabled={isArchiving}
              danger
            />
            {!isMerged && (
              <ActionBtn icon={<Trash2 size={12} />} label="Delete" onClick={handleDelete} danger />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ActionBtn({
  icon,
  label,
  onClick,
  danger,
  disabled,
  title,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title ?? label}
      disabled={disabled}
      className={`premium-toolbar-button rounded-md p-1.5 text-text-tertiary transition-colors ${
        danger ? 'hover:bg-error/10 hover:text-error' : 'hover:bg-bg-hover hover:text-text-primary'
      } ${disabled ? 'cursor-not-allowed opacity-60 hover:bg-transparent hover:text-text-tertiary' : ''}`}
    >
      {icon}
    </button>
  );
}
