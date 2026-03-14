import { useEffect, useState } from 'react';
import { X, GitMerge, Zap } from 'lucide-react';
import { useUiStore } from '../../stores/ui';
import { useAgentStore } from '../../stores/agent';
import { startWorkspaceChat } from '../../lib/workspace-state';
import type { Workspace } from '../../lib/ipc-api';
import type { AgentId } from '../../lib/types';

/** Pick the cheapest available model for merge tasks per agent family. */
const MERGE_MODELS: Record<AgentId, { model: string; label: string }> = {
  'claude-code': { model: 'haiku', label: 'Haiku' },
  codex: { model: 'gpt-5-codex-mini', label: 'Codex Mini' },
  gemini: { model: 'gemini-2.5-flash', label: 'Gemini Flash' },
  openai: { model: 'gpt-5-mini', label: 'GPT-5 Mini' },
  ollama: { model: 'mistral', label: 'Mistral' },
};

interface MergeDialogProps {
  workspace: Workspace;
  onClose: () => void;
}

export function MergeDialog({ workspace, onClose }: MergeDialogProps) {
  const gitBranch = useUiStore((s) => s.gitBranch);
  const [targetBranch, setTargetBranch] = useState(() => gitBranch?.trim() ?? '');
  const [squash, setSquash] = useState(true);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (!gitBranch?.trim()) return;
    setTargetBranch((current) => current.trim() || gitBranch);
  }, [gitBranch]);

  const agentId = useAgentStore((s) => s.selectedAgentId);
  const mergeInfo = MERGE_MODELS[agentId];

  const handleMerge = async () => {
    setStarting(true);
    try {
      const { mode } = useUiStore.getState();
      const squashNote = squash
        ? 'Use --squash to collapse all commits into one.'
        : '';
      const prompt = `Merge branch "${workspace.branch}" into "${targetBranch}". ${squashNote}\n\nHandle any conflicts, dirty working tree, or other issues automatically. Commit the result when done.`;
      await startWorkspaceChat({
        workspace,
        prompt,
        agentId,
        model: mergeInfo.model,
        mode,
        thinking: 'low',
        skipBranchRename: true,
      });
      onClose();
    } catch {
      setStarting(false);
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

          {/* Model badge */}
          <div className="flex items-center gap-2 rounded-lg bg-bg-elevated border border-border/60 px-3 py-2">
            <Zap size={12} className="text-text-secondary shrink-0" />
            <span className="text-[13px] text-text-secondary">
              Using <span className="font-medium text-text-primary">{mergeInfo.label}</span> for merge — fast and cost-effective
            </span>
          </div>

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
            disabled={starting || !targetBranch.trim()}
            className="px-4 py-1.5 text-xs font-medium rounded-lg bg-success text-white hover:bg-success/85 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {starting ? 'Starting agent...' : 'Merge'}
          </button>
        </div>
      </div>
    </div>
  );
}
