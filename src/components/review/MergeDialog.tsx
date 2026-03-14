import { useEffect, useState } from 'react';
import { X, GitMerge } from 'lucide-react';
import { useUiStore } from '../../stores/ui';
import { useWorkspaceStore } from '../../stores/workspace';
import type { Workspace, MergeResult } from '../../lib/ipc-api';

interface MergeDialogProps {
  workspace: Workspace;
  onClose: () => void;
}

export function MergeDialog({ workspace, onClose }: MergeDialogProps) {
  const gitBranch = useUiStore((s) => s.gitBranch);
  const [targetBranch, setTargetBranch] = useState(() => gitBranch?.trim() ?? '');
  const [squash, setSquash] = useState(true);
  const [merging, setMerging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!gitBranch?.trim()) return;
    setTargetBranch((current) => current.trim() || gitBranch);
  }, [gitBranch]);

  const handleMerge = async () => {
    setMerging(true);
    setError(null);
    try {
      const result = await window.api.invoke('workspace:merge', {
        workspaceId: workspace.id,
        targetBranch: targetBranch.trim(),
        squash,
      }) as MergeResult;

      if (result.success) {
        useWorkspaceStore.getState().updateWorkspace(workspace.id, { outcome: 'merged' });
        onClose();
      } else if (result.conflicts?.length) {
        setError(`Merge conflicts in: ${result.conflicts.join(', ')}`);
        setMerging(false);
      } else {
        setError(result.error ?? 'Merge failed');
        setMerging(false);
      }
    } catch (err: any) {
      setError(err.message ?? 'Merge failed');
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
            <GitMerge size={16} className="text-success" />
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

          {/* Error */}
          {error && (
            <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          {/* Target branch */}
          <div>
            <label className="block text-[13px] font-medium text-text-tertiary mb-1">Target Branch</label>
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
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs rounded-lg text-text-secondary hover:bg-bg-hover transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleMerge}
            disabled={merging || !targetBranch.trim()}
            className="px-4 py-1.5 text-xs font-medium rounded-lg bg-success text-white hover:bg-success/85 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {merging ? 'Merging...' : 'Merge'}
          </button>
        </div>
      </div>
    </div>
  );
}
