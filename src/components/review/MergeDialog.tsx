import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { X, GitMerge, GitPullRequest, AlertTriangle, FileText, Plus, Minus, GitCommit, Loader2, Zap, ChevronRight, RefreshCw, Check } from 'lucide-react';
import { useUiStore } from '../../stores/ui';
import { useAgentStore } from '../../stores/agent';
import { startWorkspaceMerge } from '../../lib/workspace-state';
import { AgentIcon, AGENT_COLORS } from '../icons/AgentIcons';
import type { Workspace, MergePreview } from '../../lib/ipc-api';
import type { AgentId, DetectedAgent, ModelInfo, ThinkingLevel } from '../../lib/types';

type MergeMode = 'agent' | 'pr';
const thinkingLevels: { value: ThinkingLevel; label: string }[] = [
  { value: 'disabled', label: 'Disabled' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'Extra High' },
];

interface MergeDialogProps {
  workspace: Workspace;
  onClose: () => void;
}

export function MergeDialog({ workspace, onClose }: MergeDialogProps) {
  const gitBranch = useUiStore((s) => s.gitBranch);
  const agents = useAgentStore((s) => s.agents);
  const defaultBranch = workspace.baseBranch?.trim() || gitBranch?.trim() || '';
  const [targetBranch, setTargetBranch] = useState(() => defaultBranch);
  const [squash, setSquash] = useState(true);
  const [merging, setMerging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<MergeMode>('agent');
  const [preview, setPreview] = useState<MergePreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const defaultAgentId = (workspace.actAgentId ?? workspace.agentId) as AgentId;
  const defaultModel = workspace.actModel ?? workspace.model;
  const defaultThinking = workspace.actThinking ?? workspace.thinking ?? 'medium';
  const [mergeAgentId, setMergeAgentId] = useState<AgentId>(defaultAgentId);
  const [mergeModel, setMergeModel] = useState(defaultModel);
  const [mergeThinking, setMergeThinking] = useState<ThinkingLevel>(defaultThinking);
  const [mergeModels, setMergeModels] = useState<ModelInfo[]>([]);
  const [mergeModelsLoading, setMergeModelsLoading] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const fetchSequence = useRef(0);

  // PR fields
  const [prTitle, setPrTitle] = useState(() => workspace.name);
  const [prBody, setPrBody] = useState('');
  const [prDraft, setPrDraft] = useState(false);
  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.id === mergeAgentId) ?? null,
    [agents, mergeAgentId],
  );
  const modelOptions = useMemo(() => {
    if (!selectedAgent) return [];
    const fallbackModels = selectedAgent.models.map((model) => ({ id: model, name: model }));
    const combined = mergeModels.length > 0 ? mergeModels : fallbackModels;
    if (!mergeModel || combined.some((model) => model.id === mergeModel)) {
      return combined;
    }
    return [{ id: mergeModel, name: mergeModel }, ...combined];
  }, [mergeModel, mergeModels, selectedAgent]);

  useEffect(() => {
    if (!defaultBranch) return;
    setTargetBranch((current) => current.trim() || defaultBranch);
  }, [defaultBranch]);

  useEffect(() => {
    setMergeAgentId(defaultAgentId);
    setMergeModel(defaultModel);
    setMergeThinking(defaultThinking);
    setMergeModels([]);
    setReloadToken(0);
  }, [defaultAgentId, defaultModel, defaultThinking, workspace.id]);

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

  useEffect(() => {
    if (!pickerOpen || !mergeAgentId) return;
    const requestId = ++fetchSequence.current;
    const fallbackModels = agents.find((agent) => agent.id === mergeAgentId)?.models ?? [];
    setMergeModelsLoading(true);

    void window.api.invoke('agents:list-models', { agentId: mergeAgentId }).then((result) => {
      if (fetchSequence.current !== requestId) return;
      const fetchedModels = Array.isArray(result) ? result as ModelInfo[] : [];
      setMergeModels(fetchedModels);
      setMergeModel((current) => {
        if (fetchedModels.some((model) => model.id === current)) return current;
        if (fallbackModels.includes(current)) return current;
        return fetchedModels[0]?.id ?? fallbackModels[0] ?? '';
      });
    }).catch(() => {
      if (fetchSequence.current !== requestId) return;
      const fallback = fallbackModels.map((model) => ({ id: model, name: model }));
      setMergeModels(fallback);
      setMergeModel((current) => (
        fallbackModels.includes(current)
          ? current
          : fallbackModels[0] ?? ''
      ));
    }).finally(() => {
      if (fetchSequence.current === requestId) {
        setMergeModelsLoading(false);
      }
    });
  }, [pickerOpen, mergeAgentId, agents, reloadToken]);

  const handleAgentMerge = async () => {
    setMerging(true);
    setError(null);
    try {
      await startWorkspaceMerge({
        workspace,
        targetBranch: targetBranch.trim(),
        squash,
        agentId: mergeAgentId,
        model: mergeModel,
        thinking: mergeThinking,
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
      await window.api.invoke('workspace:create-pr', {
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
    if (mode === 'agent') handleAgentMerge();
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
                active={mode === 'agent'}
                onClick={() => setMode('agent')}
                icon={<Zap size={12} />}
                label="Agent Merge"
                desc="Agent handles merge flow"
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

          {/* Options for agent merge */}
          {mode !== 'pr' && (
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                className="w-full flex items-center justify-between gap-3 rounded-lg border border-border bg-bg-secondary px-3 py-2 text-left transition-colors hover:border-border/80 hover:bg-bg-hover"
              >
                <div className="min-w-0">
                  <div className="text-[11px] font-medium uppercase tracking-wider text-text-tertiary">Merge Agent</div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-text-primary">
                    {selectedAgent && (
                      <AgentIcon
                        agentId={selectedAgent.id}
                        size={12}
                        className={AGENT_COLORS[selectedAgent.id] ?? 'text-text-primary'}
                      />
                    )}
                    <span className="truncate">
                      {selectedAgent?.name ?? mergeAgentId}
                      {' · '}
                      {mergeModel || 'Select model'}
                    </span>
                  </div>
                  <div className="mt-1 text-[11px] text-text-tertiary">
                    Pick a cheaper model for routine merges if you want.
                  </div>
                </div>
                <ChevronRight size={14} className="shrink-0 text-text-tertiary" />
              </button>
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
          {preview && preview.conflicts.length > 0 && mode === 'agent' && (
            <span className="flex items-center gap-1 text-[11px] text-amber-400 mr-auto">
              <AlertTriangle size={11} />
              Conflicts detected — agent will stop if a human decision is needed
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
              : mode === 'agent'
                ? 'Start Agent Merge'
                : 'Create PR'}
          </button>
        </div>
      </div>
      {pickerOpen && (
        <MergeAgentPickerModal
          agents={agents}
          selectedAgent={selectedAgent}
          agentId={mergeAgentId}
          model={mergeModel}
          thinking={mergeThinking}
          modelOptions={modelOptions}
          loadingModels={mergeModelsLoading}
          onClose={() => {
            setPickerOpen(false);
            void window.api.invoke('workspace:update', {
              workspaceId: workspace.id,
              actAgentId: mergeAgentId,
              actModel: mergeModel,
              actThinking: mergeThinking,
            });
          }}
          onReloadModels={() => setReloadToken((current) => current + 1)}
          onSelectAgent={(agent) => {
            const fallbackModel = agent.models[0] ?? '';
            setMergeAgentId(agent.id);
            setMergeModels([]);
            setMergeModel(fallbackModel);
            if (!agent.supportsThinking) {
              setMergeThinking('disabled');
            }
          }}
          onSelectModel={setMergeModel}
          onSelectThinking={setMergeThinking}
        />
      )}
    </div>
  );
}

function MergeAgentPickerModal({
  agents,
  selectedAgent,
  agentId,
  model,
  thinking,
  modelOptions,
  loadingModels,
  onClose,
  onReloadModels,
  onSelectAgent,
  onSelectModel,
  onSelectThinking,
}: {
  agents: DetectedAgent[];
  selectedAgent: DetectedAgent | null;
  agentId: AgentId;
  model: string;
  thinking: ThinkingLevel;
  modelOptions: ModelInfo[];
  loadingModels: boolean;
  onClose: () => void;
  onReloadModels: () => void;
  onSelectAgent: (agent: DetectedAgent) => void;
  onSelectModel: (model: string) => void;
  onSelectThinking: (thinking: ThinkingLevel) => void;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-full max-w-2xl rounded-xl border border-border bg-bg-primary shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h3 className="text-sm font-semibold text-text-primary">Merge Agent Picker</h3>
            <p className="mt-1 text-xs text-text-tertiary">Choose the agent and model for this merge run.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-bg-hover text-text-tertiary"
            title="Close merge agent picker"
            aria-label="Close merge agent picker"
          >
            <X size={16} />
          </button>
        </div>

        <div className="grid gap-4 px-5 py-4 md:grid-cols-[1.2fr_1fr]">
          <div className="space-y-1 max-h-72 overflow-y-auto">
            {agents.map((agent) => (
              <button
                key={agent.id}
                type="button"
                disabled={!agent.available}
                onClick={() => {
                  if (!agent.available) return;
                  onSelectAgent(agent);
                }}
                className={`w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${
                  agent.id === agentId
                    ? 'bg-bg-elevated text-text-primary ring-1 ring-border'
                    : agent.available
                      ? 'text-text-secondary hover:bg-bg-hover'
                      : 'cursor-not-allowed text-text-tertiary opacity-50'
                }`}
              >
                <AgentIcon
                  agentId={agent.id}
                  size={16}
                  className={agent.id === agentId ? (AGENT_COLORS[agent.id] ?? 'text-text-primary') : 'text-text-tertiary'}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-medium">{agent.name}</span>
                    <span className="text-[11px] text-text-tertiary">v{agent.version}</span>
                  </div>
                  <div className="mt-0.5 text-[11px] text-text-tertiary">
                    {agent.available ? `Default: ${agent.models[0] ?? 'none'}` : 'Unavailable'}
                  </div>
                </div>
                {agent.id === agentId && <Check size={15} className="text-success" />}
              </button>
            ))}
          </div>

          <div className="space-y-4 border-t border-border pt-4 md:border-l md:border-t-0 md:pl-4 md:pt-0">
            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">Model</label>
                <button
                  type="button"
                  onClick={onReloadModels}
                  disabled={loadingModels || !selectedAgent}
                  className="p-1 rounded-md text-text-tertiary hover:text-text-primary hover:bg-bg-hover disabled:opacity-50"
                  title="Refresh models"
                  aria-label="Refresh models"
                >
                  <RefreshCw size={12} className={loadingModels ? 'animate-spin' : ''} />
                </button>
              </div>
              {loadingModels && modelOptions.length === 0 ? (
                <div className="flex items-center gap-2 rounded-xl border border-border bg-bg-secondary px-3 py-2.5 text-[13px] text-text-tertiary">
                  <Loader2 size={13} className="animate-spin" />
                  Loading models...
                </div>
              ) : (
                <select
                  value={model}
                  onChange={(event) => onSelectModel(event.target.value)}
                  disabled={!selectedAgent || modelOptions.length === 0}
                  className="w-full rounded-xl border border-border bg-bg-primary px-3 py-2.5 text-[13px] text-text-primary outline-none transition-all focus:border-border-focus focus:ring-1 focus:ring-border-focus/20"
                >
                  {modelOptions.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {selectedAgent?.supportsThinking && (
              <div>
                <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
                  Thinking Level
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {thinkingLevels.map((level) => (
                    <button
                      key={level.value}
                      type="button"
                      onClick={() => onSelectThinking(level.value)}
                      className={`rounded-lg border px-3 py-2 text-xs transition-colors ${
                        thinking === level.value
                          ? 'border-border-focus bg-accent/10 text-text-primary'
                          : 'border-border bg-bg-secondary text-text-tertiary hover:border-border/80 hover:text-text-secondary'
                      }`}
                    >
                      {level.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {!selectedAgent?.supportsThinking && (
              <div className="rounded-lg border border-border bg-bg-secondary px-3 py-2 text-xs text-text-tertiary">
                This agent does not expose thinking controls.
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-xs rounded-lg text-text-secondary hover:bg-bg-hover transition-colors"
          >
            Done
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
