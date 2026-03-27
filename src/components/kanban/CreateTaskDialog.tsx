import { useState, useEffect, useRef, useCallback } from 'react';
import {
  X,
  Search,
  Map,
  Code,
  MessageSquare,
  Building2,
  GitBranch,
  Zap,
  ChevronDown,
  Sparkles,
  Brain,
  AlertCircle,
} from 'lucide-react';
import { useAgentStore } from '../../stores/agent';
import { useUiStore } from '../../stores/ui';
import { useWorkspaceStore } from '../../stores/workspace';
import { createFluxBranchName, startWorkspaceChat } from '../../lib/workspace-state';
import type { Workspace } from '../../lib/ipc-api';
import type { AgentId, TaskMode, ThinkingLevel } from '../../lib/types';
import { toast } from 'sonner';

type WorkspaceType = 'isolated' | 'direct';

const MODE_OPTIONS: { mode: TaskMode; label: string; description: string; icon: typeof Code; color: string }[] = [
  { mode: 'discovery', label: 'Discovery', description: 'Research & explore', icon: Search, color: 'bg-warning text-warning' },
  { mode: 'plan', label: 'Plan', description: 'Read & plan changes', icon: Map, color: 'bg-plan text-plan' },
  { mode: 'act', label: 'Act', description: 'Make changes directly', icon: Code, color: 'bg-info text-info' },
  { mode: 'architect', label: 'Architect', description: 'High-level design', icon: Building2, color: 'bg-accent text-accent' },
  { mode: 'ask', label: 'Ask', description: 'Answer questions', icon: MessageSquare, color: 'bg-success text-success' },
];

const MODE_PLACEHOLDERS: Record<TaskMode, string> = {
  discovery: 'Describe what to research, explore, or understand...',
  plan: 'Describe what changes to plan and how...',
  act: 'Describe the changes to implement...',
  architect: 'Describe the system or feature to design...',
  ask: 'Ask a question about the codebase...',
};

const THINKING_OPTIONS: { level: ThinkingLevel; label: string }[] = [
  { level: 'disabled', label: 'Off' },
  { level: 'low', label: 'Low' },
  { level: 'medium', label: 'Med' },
  { level: 'high', label: 'High' },
  { level: 'xhigh', label: 'Max' },
];

interface CreateTaskDialogProps {
  /** Pre-select this mode when dialog opens (e.g. from clicking "+" on a specific column) */
  initialMode?: TaskMode;
  onClose: () => void;
}

export function CreateTaskDialog({ initialMode, onClose }: CreateTaskDialogProps) {
  const agents = useAgentStore((s) => s.agents);
  const globalAgentId = useAgentStore((s) => s.selectedAgentId);
  const globalModel = useAgentStore((s) => s.selectedModel);
  const globalThinking = useAgentStore((s) => s.selectedThinking);
  const dynamicModels = useAgentStore((s) => s.dynamicModels);
  const cwd = useUiStore((s) => s.cwd);
  const openProjects = useUiStore((s) => s.openProjects);

  const [title, setTitle] = useState('');
  const [prompt, setPrompt] = useState('');
  const [mode, setMode] = useState<TaskMode>(initialMode ?? 'act');
  const [agentId, setAgentId] = useState<AgentId>(globalAgentId);
  const [model, setModel] = useState(globalModel);
  const [thinking, setThinking] = useState<ThinkingLevel>(globalThinking);
  const [workspaceType, setWorkspaceType] = useState<WorkspaceType>('isolated');
  const [parentRepo, setParentRepo] = useState(cwd);
  const [branch, setBranch] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const titleRef = useRef<HTMLInputElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  const projectOptions = openProjects.length > 0 ? openProjects : cwd ? [cwd] : [];
  const availableAgents = agents.filter((a) => a.available);
  const selectedAgent = agents.find((a) => a.id === agentId);
  const models = dynamicModels.length > 0
    ? dynamicModels
    : (selectedAgent?.models ?? []).map((m) => ({ id: m, name: m }));

  // Auto-generate branch from title
  useEffect(() => {
    if (workspaceType === 'isolated' && title.trim()) {
      setBranch(createFluxBranchName(title.trim()));
    }
  }, [title, workspaceType]);

  // Focus title on mount
  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  // Escape to close
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  // Fetch models when agent changes
  useEffect(() => {
    if (agentId !== globalAgentId) {
      useAgentStore.getState().fetchModels(agentId);
    }
  }, [agentId, globalAgentId]);

  const handleCreate = useCallback(async () => {
    if (!prompt.trim()) return;
    if (!parentRepo) {
      setError('Open a project before creating a task.');
      return;
    }
    setCreating(true);
    setError(null);

    const effectiveTitle = title.trim() || prompt.trim().slice(0, 60);
    let workspace: Workspace | null = null;

    try {
      if (workspaceType === 'direct') {
        workspace = await window.api.invoke('workspace:create-direct', {
          name: effectiveTitle,
          parentRepo,
          agentId,
          model,
          mode,
          thinking,
        }) as Workspace;
      } else {
        const effectiveBranch = branch || createFluxBranchName(effectiveTitle);
        workspace = await window.api.invoke('workspace:create', {
          name: effectiveTitle,
          parentRepo,
          branch: effectiveBranch,
          agentId,
          model,
          mode,
          thinking,
        }) as Workspace;
      }

      useWorkspaceStore.getState().addWorkspace(workspace);
      useWorkspaceStore.getState().setActiveWorkspace(workspace.id);

      await startWorkspaceChat({
        workspace,
        prompt: prompt.trim(),
        agentId,
        model,
        mode,
        thinking,
      });

      toast.success(`Task created: ${effectiveTitle}`);
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      if (workspace) {
        useWorkspaceStore.getState().updateWorkspace(workspace.id, { status: 'error' });
      }
    } finally {
      setCreating(false);
    }
  }, [title, prompt, mode, agentId, model, thinking, workspaceType, parentRepo, branch, onClose]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleCreate();
    }
  };

  const modeOption = MODE_OPTIONS.find((m) => m.mode === mode)!;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-full max-w-xl bg-bg-primary border border-border rounded-xl shadow-2xl flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent/10">
              <Sparkles size={14} className="text-accent" />
            </div>
            <h2 className="text-sm font-semibold text-text-primary">Create Task</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-bg-hover text-text-tertiary"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4" onKeyDown={handleKeyDown}>
          {/* Title */}
          <div>
            <input
              ref={titleRef}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Task title (optional — derived from prompt)"
              className="w-full bg-transparent text-[15px] font-medium text-text-primary placeholder:text-text-tertiary/50 outline-none border-none py-1"
            />
          </div>

          {/* Mode selector - prominent pills */}
          <div>
            <label className="block text-[11px] font-medium text-text-tertiary mb-2">Mode</label>
            <div className="flex flex-wrap gap-1.5">
              {MODE_OPTIONS.map((opt) => {
                const Icon = opt.icon;
                const isActive = opt.mode === mode;
                const [bgClass, textClass] = opt.color.split(' ');
                return (
                  <button
                    key={opt.mode}
                    type="button"
                    onClick={() => setMode(opt.mode)}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-medium transition-all ${
                      isActive
                        ? `${bgClass}/15 ${textClass} ring-1 ring-current/20`
                        : 'bg-bg-secondary text-text-tertiary hover:text-text-secondary hover:bg-bg-hover'
                    }`}
                  >
                    <Icon size={12} />
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Prompt / Description */}
          <div>
            <label className="block text-[11px] font-medium text-text-tertiary mb-1.5">
              Prompt <span className="text-error">*</span>
            </label>
            <textarea
              ref={promptRef}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={MODE_PLACEHOLDERS[mode]}
              rows={5}
              className="w-full resize-none rounded-lg border border-border bg-bg-secondary px-3 py-2.5 text-[13px] text-text-primary placeholder:text-text-tertiary/40 outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/15 transition-colors"
            />
          </div>

          {/* Agent + Model row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-text-tertiary mb-1.5">Assignee (Agent)</label>
              <select
                value={agentId}
                onChange={(e) => {
                  const newAgent = e.target.value as AgentId;
                  setAgentId(newAgent);
                  const agent = agents.find((a) => a.id === newAgent);
                  if (agent?.models[0]) setModel(agent.models[0]);
                }}
                className="input-field"
              >
                {availableAgents.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-text-tertiary mb-1.5">Model</label>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="input-field"
              >
                {models.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Thinking level */}
          <div>
            <label className="block text-[11px] font-medium text-text-tertiary mb-1.5">
              <span className="inline-flex items-center gap-1">
                <Brain size={10} />
                Thinking
              </span>
            </label>
            <div className="flex gap-1">
              {THINKING_OPTIONS.map((opt) => (
                <button
                  key={opt.level}
                  type="button"
                  onClick={() => setThinking(opt.level)}
                  className={`flex-1 rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors ${
                    thinking === opt.level
                      ? 'bg-accent/15 text-accent ring-1 ring-accent/20'
                      : 'bg-bg-secondary text-text-tertiary hover:text-text-secondary hover:bg-bg-hover'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Advanced section */}
          <div>
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="inline-flex items-center gap-1 text-[11px] text-text-tertiary hover:text-text-secondary transition-colors"
            >
              <ChevronDown size={10} className={`transition-transform ${showAdvanced ? 'rotate-0' : '-rotate-90'}`} />
              Advanced
            </button>

            {showAdvanced && (
              <div className="mt-3 space-y-3 rounded-lg border border-border/50 bg-bg-secondary/40 p-3">
                {/* Workspace type */}
                <div>
                  <label className="block text-[11px] font-medium text-text-tertiary mb-1.5">Workspace</label>
                  <div className="flex rounded-lg border border-border overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setWorkspaceType('isolated')}
                      className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-[11px] font-medium transition-colors ${
                        workspaceType === 'isolated'
                          ? 'bg-bg-hover text-text-primary'
                          : 'bg-bg-secondary text-text-tertiary hover:text-text-secondary'
                      }`}
                    >
                      <GitBranch size={11} />
                      Isolated Branch
                    </button>
                    <button
                      type="button"
                      onClick={() => setWorkspaceType('direct')}
                      className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-[11px] font-medium transition-colors ${
                        workspaceType === 'direct'
                          ? 'bg-bg-hover text-text-primary'
                          : 'bg-bg-secondary text-text-tertiary hover:text-text-secondary'
                      }`}
                    >
                      <Zap size={11} />
                      Direct
                    </button>
                  </div>
                </div>

                {/* Branch name (isolated only) */}
                {workspaceType === 'isolated' && (
                  <div>
                    <label className="block text-[11px] font-medium text-text-tertiary mb-1">Branch</label>
                    <input
                      value={branch}
                      onChange={(e) => setBranch(e.target.value)}
                      placeholder="Auto-generated from title"
                      className="input-field font-mono text-xs"
                    />
                  </div>
                )}

                {/* Project selector (multi-project) */}
                {projectOptions.length > 1 && (
                  <div>
                    <label className="block text-[11px] font-medium text-text-tertiary mb-1">Project</label>
                    <select
                      value={parentRepo}
                      onChange={(e) => setParentRepo(e.target.value)}
                      className="input-field"
                    >
                      {projectOptions.map((p) => (
                        <option key={p} value={p}>{p.split('/').pop() || p}</option>
                      ))}
                    </select>
                  </div>
                )}

                {workspaceType === 'direct' && (
                  <div className="flex items-start gap-2 text-[11px] text-warning bg-warning/8 rounded-md px-2.5 py-2">
                    <AlertCircle size={12} className="shrink-0 mt-0.5" />
                    <span>Direct mode works on the current branch — changes apply immediately without isolation.</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="text-xs text-error bg-error/10 border border-error/30 rounded-lg px-3 py-2">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-border shrink-0">
          <span className="text-[10px] text-text-tertiary">{'\u2318'}+Enter to create</span>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs rounded-lg text-text-secondary hover:bg-bg-hover transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={creating || !prompt.trim()}
              className="px-4 py-1.5 text-xs font-medium rounded-lg bg-accent text-white hover:bg-accent/85 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {creating ? 'Creating...' : 'Create Task'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
