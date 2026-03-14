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
    <div className="rounded-xl border border-success/30 bg-success/5 p-4">
      <div className="flex items-center gap-2 mb-3">
        <CheckCircle2 size={15} className="text-success shrink-0" />
        <span className="text-sm font-medium text-text-primary">Task complete</span>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          onClick={handleReview}
          className="flex items-center gap-1.5 rounded-lg border border-border bg-bg-primary px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
        >
          <Eye size={12} />
          Review Changes
        </button>
        <button
          onClick={handleMerge}
          className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent/90 transition-colors"
        >
          <GitMerge size={12} />
          Merge to {mergeTarget}
        </button>
        {onContinue && (
          <button
            onClick={onContinue}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-bg-primary px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
          >
            <MessageSquare size={12} />
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
