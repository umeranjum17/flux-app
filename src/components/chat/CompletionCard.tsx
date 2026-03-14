import { useState, useEffect } from 'react';
import { GitMerge, Eye, MessageSquare, Archive } from 'lucide-react';
import { useWorkspaceStore } from '../../stores/workspace';
import { useUiStore } from '../../stores/ui';
import type { Workspace } from '../../lib/ipc-api';
import type { DiffData, DiffFileEntry } from '../../lib/types';

function getBasename(path: string): string {
  return path.split('/').pop() ?? path;
}

function FileChip({ file, onClick }: { file: DiffFileEntry; onClick: () => void }) {
  const basename = getBasename(file.path);
  const net = file.additions - file.deletions;
  const label = net > 0 ? `+${net}` : net < 0 ? `${net}` : '±0';
  const color = net > 0 ? 'text-success' : net < 0 ? 'text-error' : 'text-text-tertiary';

  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
      title={file.path}
    >
      <span className="font-medium">{basename}</span>
      <span className={`text-[11px] ${color}`}>{label}</span>
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

  const handleReview = () => {
    useWorkspaceStore.getState().openReview(workspace.id);
  };

  const handleMerge = () => {
    useWorkspaceStore.getState().openMerge(workspace.id);
  };

  const handleArchive = async () => {
    await window.api.invoke('workspace:archive', { workspaceId: workspace.id });
    useWorkspaceStore.getState().archiveWorkspace(workspace.id);
  };

  const handleFileClick = async (filePath: string) => {
    const store = useWorkspaceStore.getState();
    await store.openReview(workspace.id);
    // Small delay to ensure diff files are loaded before selecting
    setTimeout(() => {
      useWorkspaceStore.getState().selectFile(filePath);
    }, 100);
  };

  return (
    <div className="mt-2 flex flex-col gap-2">
      {/* File list */}
      {diff && diff.files.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-0.5 gap-y-1 text-[12px]">
          <span className="text-text-tertiary mr-1">
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
              <span className="text-text-tertiary mx-1">·</span>
              <span className="text-text-tertiary text-[11px]">{formatDuration(durationMs)}</span>
            </>
          )}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-1.5">
        <button
          onClick={handleReview}
          className="flex items-center gap-1.5 rounded-lg border border-border/60 px-3 py-1.5 text-[12px] text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
        >
          <Eye size={11} />
          Review
        </button>
        {isReadyToArchive ? (
          <button
            onClick={handleArchive}
            className="flex items-center gap-1.5 rounded-lg bg-warning px-3 py-1.5 text-[12px] font-medium text-white hover:bg-warning/85 transition-colors"
          >
            <Archive size={11} />
            Archive
          </button>
        ) : (
          <>
            <button
              onClick={handleMerge}
              className="flex items-center gap-1.5 rounded-lg bg-success px-3 py-1.5 text-[12px] font-medium text-white hover:bg-success/85 transition-colors"
            >
              <GitMerge size={11} />
              Merge to {mergeTarget}
            </button>
            {onContinue && (
              <button
                onClick={onContinue}
                className="flex items-center gap-1.5 rounded-lg border border-border/60 px-3 py-1.5 text-[12px] text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
              >
                <MessageSquare size={11} />
                Continue
              </button>
            )}
          </>
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
