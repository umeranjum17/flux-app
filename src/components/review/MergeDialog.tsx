import { useEffect, useState } from 'react';
import { X, GitMerge, AlertTriangle } from 'lucide-react';
import { useWorkspaceStore } from '../../stores/workspace';
import { useChatStore } from '../../stores/chat';
import { useUiStore } from '../../stores/ui';
import type { Workspace, MergeResult } from '../../lib/ipc-api';

interface MergeDialogProps {
  workspace: Workspace;
  onClose: () => void;
}

export function MergeDialog({ workspace, onClose }: MergeDialogProps) {
  const gitBranch = useUiStore((s) => s.gitBranch);
  const [targetBranch, setTargetBranch] = useState(() => gitBranch?.trim() ?? '');
  const [squash, setSquash] = useState(true);
  const [deleteAfterMerge, setDeleteAfterMerge] = useState(true);
  const [merging, setMerging] = useState(false);
  const [result, setResult] = useState<MergeResult | null>(null);

  useEffect(() => {
    if (!gitBranch?.trim()) return;
    setTargetBranch((current) => current.trim() || gitBranch);
  }, [gitBranch]);

  const handleMerge = async () => {
    setMerging(true);
    try {
      const mergeResult = await window.api.invoke('workspace:merge', {
        workspaceId: workspace.id,
        targetBranch,
        squash,
      }) as MergeResult;

      setResult(mergeResult);

      if (mergeResult.success) {
        useWorkspaceStore.getState().updateWorkspace(workspace.id, { status: 'done' });

        if (deleteAfterMerge) {
          await window.api.invoke('workspace:delete', { workspaceId: workspace.id });
          useWorkspaceStore.getState().removeWorkspace(workspace.id);
          useChatStore.getState().removeTask(workspace.id);
        }
      }
    } catch (err) {
      setResult({ success: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      setMerging(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-full max-w-md bg-bg-primary border border-border rounded-xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <GitMerge size={16} className="text-accent" />
            <h2 className="text-sm font-semibold text-text-primary">Merge Workspace</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-bg-hover text-text-tertiary">
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Summary */}
          <div className="text-xs text-text-secondary">
            Merging <span className="font-mono text-text-primary">{workspace.branch}</span> into target branch
          </div>

          {/* Target branch */}
          <div>
            <label className="block text-[11px] font-medium text-text-tertiary mb-1">Target Branch</label>
            <input
              value={targetBranch}
              onChange={(e) => setTargetBranch(e.target.value)}
              placeholder={gitBranch ?? 'Enter branch name'}
              className="input-field font-mono text-xs"
            />
          </div>

          {/* Options */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
              <input
                type="checkbox"
                checked={squash}
                onChange={(e) => setSquash(e.target.checked)}
                className="rounded border-border"
              />
              Squash commits (recommended — collapses checkpoint commits)
            </label>

            <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
              <input
                type="checkbox"
                checked={deleteAfterMerge}
                onChange={(e) => setDeleteAfterMerge(e.target.checked)}
                className="rounded border-border"
              />
              Delete worktree after merge
            </label>
          </div>

          {/* Result */}
          {result && !result.success && (
            <div className="flex items-start gap-2 text-xs text-error bg-error/10 border border-error/30 rounded-lg px-3 py-2">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              <div>
                {result.conflicts ? (
                  <>
                    <p className="font-medium mb-1">Merge conflicts in:</p>
                    <ul className="list-disc list-inside font-mono">
                      {result.conflicts.map((f) => <li key={f}>{f}</li>)}
                    </ul>
                  </>
                ) : (
                  result.error
                )}
              </div>
            </div>
          )}

          {result?.success && (
            <div className="text-xs text-success bg-success/10 border border-success/30 rounded-lg px-3 py-2">
              Merge successful!
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs rounded-lg text-text-secondary hover:bg-bg-hover transition-colors"
          >
            {result?.success ? 'Close' : 'Cancel'}
          </button>
          {!result?.success && (
            <button
              onClick={handleMerge}
              disabled={merging || !targetBranch.trim()}
              className="px-4 py-1.5 text-xs font-medium rounded-lg bg-accent text-white hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {merging ? 'Merging...' : 'Merge'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
