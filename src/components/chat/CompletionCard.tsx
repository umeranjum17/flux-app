import { useState, useEffect } from 'react';
import { useWorkspaceHasChanges } from '../../hooks/useWorkspaceHasChanges';
import { GitMerge, Files, Eye, MessageSquare, Trash2 } from 'lucide-react';
import { useWorkspaceStore } from '../../stores/workspace';
import { useUiStore } from '../../stores/ui';
import { useChatStore } from '../../stores/chat';
import type { Workspace } from '../../lib/ipc-api';
import type { DiffData, DiffFileEntry } from '../../lib/types';
import { normalizeTrackedFilePath } from '../../lib/path-utils';

function getBasename(path: string): string {
  return path.split('/').pop() ?? path;
}

function FileChip({ file, onClick }: { file: DiffFileEntry; onClick: () => void }) {
  const basename = getBasename(file.path);

  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
      title={file.path}
    >
      <span className="font-medium">{basename}</span>
      <span className="inline-flex items-center gap-1 text-[11px]">
        {file.additions > 0 && <span className="text-success">+{file.additions}</span>}
        {file.deletions > 0 && <span className="text-error">-{file.deletions}</span>}
        {file.additions === 0 && file.deletions === 0 && <span className="text-text-tertiary">±0</span>}
      </span>
    </button>
  );
}

interface CompletionCardProps {
  workspace: Workspace;
  suggestedMergeTarget?: string;
  onContinue?: () => void;
  diff?: DiffData;
  durationMs?: number;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export function CompletionCard({ workspace, suggestedMergeTarget, onContinue, diff, durationMs }: CompletionCardProps) {
  const mergeTarget = suggestedMergeTarget || useUiStore.getState().gitBranch || 'main';
  const isReadyToArchive = workspace.outcome === 'merged' || workspace.outcome === 'ready_to_archive';
  const hasInlineDiff = !!diff && diff.files.length > 0;
  const hasWorkspaceChanges = useWorkspaceHasChanges(workspace.id, { fallback: hasInlineDiff });
  const hasChanges = hasInlineDiff || hasWorkspaceChanges;

  const handleShowFiles = () => {
    useUiStore.getState().toggleFileActivityPanel(workspace.id);
  };

  const handleFullReview = () => {
    useWorkspaceStore.getState().toggleChangesPanel(workspace.id);
  };

  const handleMerge = () => {
    useWorkspaceStore.getState().openMerge(workspace.id);
  };

  const handleArchive = async () => {
    await window.api.invoke('workspace:archive', { workspaceId: workspace.id });
    useWorkspaceStore.getState().archiveWorkspace(workspace.id);
  };

  const handleFileClick = (filePath: string) => {
    // Find the most recent tool call for this file and scroll to it
    const task = useChatStore.getState().getActiveTask();
    if (!task) return;
    const normalizedPath = normalizeTrackedFilePath(filePath, task.cwd);
    const editEntry = task.editedFiles.get(normalizedPath) ?? task.editedFiles.get(filePath);
    if (editEntry) {
      const didScroll = useChatStore.getState().scrollToFileEdit(editEntry.toolCallId);
      if (didScroll) return;
    }

    if (workspace.id) {
      void useWorkspaceStore.getState().openChangesPanel(workspace.id).then(() => {
        void useWorkspaceStore.getState().changesPanelSelectFile(filePath);
      });
    } else {
      const activeTask = useChatStore.getState().getActiveTask();
      useUiStore.getState().setFileActivityPanelOpen(true, activeTask?.workspaceId ?? activeTask?.id ?? '');
    }
  };

  return (
    <div className="mt-2 rounded-xl border border-border/55 bg-bg-surface/35 px-3 py-2.5">
      {/* File list */}
      {diff && diff.files.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-0.5 gap-y-1 text-[12px]">
          <span className="mr-1 text-text-tertiary">
            {diff.files.length} file{diff.files.length !== 1 ? 's' : ''}
          </span>
          {diff.files.map((file) => (
            <FileChip
              key={file.path}
              file={file}
              onClick={() => handleFileClick(file.path)}
            />
          ))}
          {durationMs != null && durationMs > 0 && (
            <>
              <span className="mx-1 text-text-tertiary">·</span>
              <span className="text-text-tertiary text-[11px]">{formatDuration(durationMs)}</span>
            </>
          )}
        </div>
      )}

      {/* Action buttons */}
      <div className={`mt-2 flex flex-wrap items-center gap-1.5 ${diff && diff.files.length > 0 ? 'border-t border-border/45 pt-2' : ''}`}>
        {onContinue && !isReadyToArchive && (
          <button
            onClick={onContinue}
            className="premium-toolbar-button inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-bg-elevated/45 px-2.5 py-1.5 text-[12px] text-text-secondary hover:text-text-primary"
          >
            <MessageSquare size={11} />
            Continue
          </button>
        )}
        {hasChanges && (
          <button
            onClick={handleShowFiles}
            className="premium-toolbar-button inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-bg-elevated/45 px-2.5 py-1.5 text-[12px] text-text-secondary hover:text-text-primary"
          >
            <Files size={11} />
            Show Files
          </button>
        )}
        {hasChanges && (
          <button
            onClick={handleFullReview}
            className="premium-toolbar-button inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-bg-elevated/45 px-2.5 py-1.5 text-[12px] text-text-secondary hover:text-text-primary"
          >
            <Eye size={11} />
            Full Review
          </button>
        )}
        {isReadyToArchive ? (
          <button
            onClick={handleArchive}
            className="premium-toolbar-button inline-flex items-center gap-1.5 rounded-md border border-warning/35 bg-warning/12 px-2.5 py-1.5 text-[12px] font-medium text-warning hover:bg-warning/16"
          >
            <Trash2 size={11} />
            Archive
          </button>
        ) : (
          hasChanges && (
            <button
              onClick={handleMerge}
              className="premium-toolbar-button inline-flex items-center gap-1.5 rounded-md border border-success/35 bg-success/12 px-2.5 py-1.5 text-[12px] font-medium text-success hover:bg-success/16"
            >
              <GitMerge size={11} />
              Merge to {mergeTarget}
            </button>
          )
        )}
      </div>
    </div>
  );
}

/** Hook to track workspace:completion events */
export function useWorkspaceCompletion(workspaceId: string | undefined) {
  const [completionTarget, setCompletionTarget] = useState<string | undefined>();

  useEffect(() => {
    if (!workspaceId) return;
    const unsub = window.api.on('workspace:completion', (data: unknown) => {
      const { workspaceId: wid, suggestedMergeTarget } = data as { workspaceId: string; taskId: string; suggestedMergeTarget: string };
      if (wid === workspaceId) {
        setCompletionTarget(suggestedMergeTarget);
        // Sync outcome from backend (auto-set to ready_for_pr on completion)
        const ws = useWorkspaceStore.getState().workspaces.get(wid);
        if (ws && (ws.outcome === 'in_progress' || !ws.outcome)) {
          useWorkspaceStore.getState().updateWorkspace(wid, { outcome: 'ready_for_pr' });
        }
      }
    });
    return () => { unsub?.(); };
  }, [workspaceId]);

  return completionTarget;
}
