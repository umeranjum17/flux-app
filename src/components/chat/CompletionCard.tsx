import { useState, useEffect } from 'react';
import { GitMerge, Eye, MessageSquare, CheckCircle2 } from 'lucide-react';
import { useWorkspaceStore } from '../../stores/workspace';
import { useUiStore } from '../../stores/ui';
import type { Workspace } from '../../lib/ipc-api';

interface CompletionCardProps {
  workspace: Workspace;
  suggestedMergeTarget?: string;
  onContinue?: () => void;
}

export function CompletionCard({ workspace, suggestedMergeTarget, onContinue }: CompletionCardProps) {
  const mergeTarget = suggestedMergeTarget || useUiStore.getState().gitBranch || 'main';

  const handleReview = () => {
    useWorkspaceStore.getState().openReview(workspace.id);
  };

  const handleMerge = () => {
    useWorkspaceStore.getState().openMerge(workspace.id);
  };

  return (
    <div className="rounded-xl border border-border bg-bg-elevated/60 p-4">
      <div className="flex items-center gap-2 mb-3">
        <CheckCircle2 size={15} className="text-success shrink-0" />
        <span className="text-[14px] font-medium text-text-primary">Task complete</span>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          onClick={handleReview}
          className="flex items-center gap-1.5 rounded-lg border border-border bg-bg-primary px-3.5 py-2 text-[13px] text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
        >
          <Eye size={12} />
          Review Changes
        </button>
        <button
          onClick={handleMerge}
          className="flex items-center gap-1.5 rounded-lg bg-success px-3.5 py-2 text-[13px] font-medium text-white hover:bg-success/85 transition-colors"
        >
          <GitMerge size={12} />
          Merge to {mergeTarget}
        </button>
        {onContinue && (
          <button
            onClick={onContinue}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-bg-primary px-3.5 py-2 text-[13px] text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
          >
            <MessageSquare size={13} />
            Continue Working
          </button>
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
      }
    });
    return () => { unsub?.(); };
  }, [workspaceId]);

  return completionTarget;
}
