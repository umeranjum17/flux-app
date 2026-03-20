import { useEffect, useRef, useState } from 'react';
import { Eye, GitMerge, Square, Trash2, GitBranch, ExternalLink, Files, Search, Archive, TerminalSquare, LoaderCircle, Link2 } from 'lucide-react';
import { WorkspaceLifecycleIcon } from './WorkspaceLifecycleIcon';
import { toast } from 'sonner';
import { useWorkspaceStore } from '../../stores/workspace';
import { useUiStore } from '../../stores/ui';
import { useWorkspaceHasChanges } from '../../hooks/useWorkspaceHasChanges';
import { useChatStore } from '../../stores/chat';
import { getWorkspaceLifecycleState, isTerminalOutcome, workspaceLifecycleConfig } from '../../lib/workspace-status';
import { archiveWorkspace, formatWorkspaceOperationLabel, isWorkspaceArchiving } from '../../lib/workspace-operations';
import type { WorkspaceGroupMember } from '../../lib/ipc-api';
import { useWorkspaceGroupStore } from '../../stores/workspace-group';

const EMPTY_SIBLINGS: WorkspaceGroupMember[] = [];

export function WorkspaceActionBar() {
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const operation = useWorkspaceStore((s) => (activeWorkspaceId ? s.workspaceOperations.get(activeWorkspaceId) : undefined));
  const workspace = activeWorkspaceId ? workspaces.get(activeWorkspaceId) : null;
  const siblings = useWorkspaceGroupStore((s) => (activeWorkspaceId ? s.getSiblingsOf(activeWorkspaceId) : EMPTY_SIBLINGS));
  const dissolveGroup = useWorkspaceGroupStore((s) => s.dissolveGroup);
  const unlinkWorkspace = useWorkspaceGroupStore((s) => s.unlinkWorkspace);
  const [groupPopoverOpen, setGroupPopoverOpen] = useState(false);

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

  useEffect(() => {
    setGroupPopoverOpen(false);
  }, [workspaceId]);

  useEffect(() => {
    if (siblings.length === 0) {
      setGroupPopoverOpen(false);
    }
  }, [siblings.length]);

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

  const activeGroupId = siblings[0]?.groupId ?? null;

  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-border/70 bg-bg-secondary/35 px-3 py-1.5">
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <GitBranch size={13} className="shrink-0 text-text-tertiary" />
        <span className="truncate font-mono text-[12px] text-text-secondary">{workspace.branch}</span>
        <span className={`lifecycle-badge ${lifecycle.badgeClass}`}>
          <WorkspaceLifecycleIcon state={lifecycleState} size={12} />
          {lifecycle.label}
        </span>
      </div>
      <div className="flex items-center gap-1">
        <ActionBtn icon={<Link2 size={12} />} label="Link" onClick={() => useUiStore.getState().setLinkingWorkspaceId(workspace.id)} />
        {siblings.length > 0 && (
          <div className="relative">
            <button
              onClick={() => setGroupPopoverOpen((open) => !open)}
              className="rounded-full border border-border/80 px-2 py-1 text-[11px] font-medium text-text-secondary hover:bg-bg-hover hover:text-text-primary"
            >
              Linked ({siblings.length})
            </button>
            {groupPopoverOpen && (
              <div className="absolute right-0 top-8 z-20 w-72 rounded-xl border border-border bg-bg-primary p-2 shadow-xl">
                <div className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">Linked Workspaces</div>
                <div className="space-y-1">
                  {siblings.map((sibling) => (
                    <div key={sibling.workspaceId} className="rounded-lg border border-border/60 px-2 py-2">
                      <div className="truncate text-[12px] font-medium text-text-primary">{sibling.workspaceName}</div>
                      <div className="mt-0.5 text-[11px] text-text-tertiary">{sibling.parentRepo.split('/').pop()} · {sibling.branch}</div>
                      <div className="mt-2 flex items-center gap-2">
                        <button
                          onClick={() => {
                            const wsStore = useWorkspaceStore.getState();
                            const chatStore = useChatStore.getState();
                            wsStore.setActiveWorkspace(sibling.workspaceId);

                            const workspace = wsStore.workspaces.get(sibling.workspaceId);
                            if (workspace) {
                              useUiStore.getState().setActiveProject(workspace.parentRepo);
                            }

                            const wsTask = Array.from(chatStore.tasks.values())
                              .filter((t) => t.workspaceId === sibling.workspaceId)
                              .sort((a, b) => (b.activeRun?.startedAt ?? 0) - (a.activeRun?.startedAt ?? 0))[0];
                            if (wsTask) {
                              chatStore.setActiveTask(wsTask.id);
                            } else {
                              chatStore.setActiveTask(null);
                            }
                            useUiStore.getState().setBottomPanelMode('agent');
                            setGroupPopoverOpen(false);
                          }}
                          className="rounded bg-bg-secondary px-2 py-1 text-[11px] text-text-secondary hover:bg-bg-hover hover:text-text-primary"
                        >
                          Navigate
                        </button>
                        <button
                          onClick={() => {
                            void unlinkWorkspace(sibling.workspaceId);
                            setGroupPopoverOpen(false);
                          }}
                          className="rounded bg-error/10 px-2 py-1 text-[11px] text-error hover:bg-error/20"
                        >
                          Unlink
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                {activeGroupId && (
                  <button
                    onClick={() => {
                      void dissolveGroup(activeGroupId);
                      setGroupPopoverOpen(false);
                    }}
                    className="mt-2 w-full rounded-lg border border-border/60 px-2 py-1.5 text-[11px] text-text-secondary hover:bg-bg-hover hover:text-text-primary"
                  >
                    Dissolve Group
                  </button>
                )}
              </div>
            )}
          </div>
        )}
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
