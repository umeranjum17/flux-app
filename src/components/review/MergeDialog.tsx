import { useEffect, useState, useCallback } from 'react';
import { X, GitMerge, GitPullRequest, AlertTriangle, FileText, Plus, Minus, GitCommit, Loader2, Zap } from 'lucide-react';
import { useUiStore } from '../../stores/ui';
import { useWorkspaceStore } from '../../stores/workspace';
import { startWorkspaceMerge } from '../../lib/workspace-state';
import type { Workspace, MergePreview, MergeResult } from '../../lib/ipc-api';

type MergeMode = 'direct' | 'agent' | 'pr';

interface MergeDialogProps {
  workspace: Workspace;
  onClose: () => void;
}

export function MergeDialog({ workspace, onClose }: MergeDialogProps) {
  const gitBranch = useUiStore((s) => s.gitBranch);
  const defaultBranch = workspace.baseBranch?.trim() || gitBranch?.trim() || '';
  const [targetBranch, setTargetBranch] = useState(() => defaultBranch);
  const [squash, setSquash] = useState(true);
  const [merging, setMerging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<MergeMode>('direct');
  const [preview, setPreview] = useState<MergePreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  // PR fields
  const [prTitle, setPrTitle] = useState(() => workspace.name);
  const [prBody, setPrBody] = useState('');
  const [prDraft, setPrDraft] = useState(false);

  useEffect(() => {
    if (!defaultBranch) return;
    setTargetBranch((current) => current.trim() || defaultBranch);
  }, [defaultBranch]);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !merging) onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [merging, onClose]);

  // Load merge preview when target branch changes
  const loadPreview = useCallback(async () => {
    if (!targetBranch.trim()) return;
    setLoadingPreview(true);
    try {
      const result = await window.api.invoke('workspace:merge-preview', {
        workspaceId: workspace.id,
        targetBranch: targetBranch.trim(),
      }) as MergePreview;
      setPreview(result);
    } catch {
      setPreview(null);
    } finally {
      setLoadingPreview(false);
    }
  }, [workspace.id, targetBranch]);

  useEffect(() => {
    const timer = setTimeout(loadPreview, 300);
    return () => clearTimeout(timer);
  }, [loadPreview]);

  const handleDirectMerge = async () => {
    setMerging(true);
    setError(null);
    try {
      const result = await window.api.invoke('workspace:merge', {
        workspaceId: workspace.id,
        targetBranch: targetBranch.trim(),
        squash,
      }) as MergeResult;
      if (result.success) {
        onClose();
      } else if (result.conflicts?.length) {
        setError(`Merge conflicts in ${result.conflicts.length} file(s): ${result.conflicts.join(', ')}`);
      } else {
        setError(result.error ?? 'Merge failed');
      }
    } catch (err: any) {
      setError(err.message ?? 'Merge failed');
    } finally {
      setMerging(false);
    }
  };

  const handleAgentMerge = async () => {
    setMerging(true);
    setError(null);
    try {
      await startWorkspaceMerge({
        workspace,
        targetBranch: targetBranch.trim(),
        squash,
      });
      onClose();
    } catch (err: any) {
      setError(err.message ?? 'Failed to start merge');
      setMerging(false);
    }
  };

  const handleCreatePR = async () => {
    setMerging(true);
    setError(null);
    try {
      const result = await window.api.invoke('workspace:create-pr', {
        workspaceId: workspace.id,
        title: prTitle.trim(),
        body: prBody.trim(),
        targetBranch: targetBranch.trim(),
        draft: prDraft,
      }) as { url: string; number: number };
      onClose();
    } catch (err: any) {
      setError(err.message ?? 'Failed to create PR');
      setMerging(false);
    }
  };

  const handleSubmit = () => {
    if (mode === 'direct') handleDirectMerge();
    else if (mode === 'agent') handleAgentMerge();
    else handleCreatePR();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-full max-w-lg bg-bg-primary border border-border rounded-xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <GitMerge size={16} className="text-success" />
            <h2 className="text-sm font-semibold text-text-primary">Merge Workspace</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-bg-hover text-text-tertiary"
            title="Close merge dialog"
            aria-label="Close merge dialog"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Summary */}
          <div className="text-xs text-text-secondary">
            Merging{' '}
            <span className="font-mono text-text-primary truncate max-w-[200px] inline-block align-bottom" title={workspace.branch}>
              {workspace.branch}
            </span>
            {targetBranch.trim() && (
              <>
                {' '}into{' '}
                <span className="font-mono text-text-primary">{targetBranch.trim()}</span>
              </>
            )}
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
              placeholder={defaultBranch || 'Enter branch name'}
              className="input-field font-mono text-xs"
            />
          </div>

          {/* Merge Preview */}
          {preview && (
            <div className="bg-bg-secondary rounded-lg border border-border p-3 space-y-2">
              <div className="flex items-center gap-3 text-xs">
                <span className="flex items-center gap-1 text-text-secondary">
                  <GitCommit size={11} />
                  {preview.commitsAhead} commit{preview.commitsAhead !== 1 ? 's' : ''} ahead
                </span>
                <span className="flex items-center gap-1 text-text-secondary">
                  <FileText size={11} />
                  {preview.filesChanged} file{preview.filesChanged !== 1 ? 's' : ''}
                </span>
                <span className="flex items-center gap-1 text-success">
                  <Plus size={11} />
                  {preview.additions}
                </span>
                <span className="flex items-center gap-1 text-error">
                  <Minus size={11} />
                  {preview.deletions}
                </span>
              </div>
              {preview.canFastForward && (
                <div className="text-[11px] text-success">Fast-forward merge possible</div>
              )}
              {preview.conflicts.length > 0 && (
                <div className="flex items-start gap-1.5 text-[11px] text-amber-400">
                  <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                  <span>Potential conflicts: {preview.conflicts.join(', ')}</span>
                </div>
              )}
            </div>
          )}
          {loadingPreview && (
            <div className="flex items-center gap-2 text-xs text-text-tertiary">
              <Loader2 size={12} className="animate-spin" />
              Loading preview...
            </div>
          )}

          {/* Mode selector */}
          <div>
            <label className="block text-[13px] font-medium text-text-tertiary mb-2">Merge Method</label>
            <div className="flex gap-2">
              <ModeButton
                active={mode === 'direct'}
                onClick={() => setMode('direct')}
                icon={<GitMerge size={12} />}
                label="Direct Merge"
                desc="Git merge now"
              />
              <ModeButton
                active={mode === 'agent'}
                onClick={() => setMode('agent')}
                icon={<Zap size={12} />}
                label="Agent Merge"
                desc="Agent handles conflicts"
              />
              <ModeButton
                active={mode === 'pr'}
                onClick={() => setMode('pr')}
                icon={<GitPullRequest size={12} />}
                label="Pull Request"
                desc="Create GitHub PR"
              />
            </div>
          </div>

          {/* Options for direct/agent merge */}
          {mode !== 'pr' && (
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
          )}

          {/* PR-specific fields */}
          {mode === 'pr' && (
            <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-medium text-text-tertiary mb-1">PR Title</label>
                <input
                  value={prTitle}
                  onChange={(e) => setPrTitle(e.target.value)}
                  className="input-field text-xs"
                  placeholder="Pull request title"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-text-tertiary mb-1">Description</label>
                <textarea
                  value={prBody}
                  onChange={(e) => setPrBody(e.target.value)}
                  className="input-field text-xs min-h-[60px] resize-y"
                  placeholder="Describe the changes..."
                  rows={3}
                />
              </div>
              <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
                <input
                  type="checkbox"
                  checked={prDraft}
                  onChange={(e) => setPrDraft(e.target.checked)}
                  className="rounded border-border"
                />
                Create as draft
              </label>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border">
          {preview && preview.conflicts.length > 0 && mode === 'direct' && (
            <span className="flex items-center gap-1 text-[11px] text-amber-400 mr-auto">
              <AlertTriangle size={11} />
              Conflicts detected — consider Agent Merge
            </span>
          )}
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs rounded-lg text-text-secondary hover:bg-bg-hover transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={merging || !targetBranch.trim() || (mode === 'pr' && !prTitle.trim())}
            className="px-4 py-1.5 text-xs font-medium rounded-lg bg-success text-white hover:bg-success/85 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {merging
              ? 'Working...'
              : mode === 'direct'
                ? 'Merge Now'
                : mode === 'agent'
                  ? 'Start Agent Merge'
                  : 'Create PR'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ModeButton({ active, onClick, icon, label, desc }: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  desc: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 flex flex-col items-center gap-1 p-2 rounded-lg border text-xs transition-colors ${
        active
          ? 'border-border-focus bg-accent/10 text-text-primary'
          : 'border-border bg-bg-secondary text-text-tertiary hover:text-text-secondary hover:border-border/80'
      }`}
    >
      {icon}
      <span className="font-medium">{label}</span>
      <span className="text-[10px] text-text-tertiary">{desc}</span>
    </button>
  );
}
