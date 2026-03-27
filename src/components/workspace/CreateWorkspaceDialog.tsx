import { useState } from 'react';
import { X, Zap, GitBranch } from 'lucide-react';
import { useAgentStore } from '../../stores/agent';
import { useUiStore } from '../../stores/ui';
import { useWorkspaceStore } from '../../stores/workspace';
import type { Workspace } from '../../lib/ipc-api';
import { createFluxBranchName, startWorkspaceChat } from '../../lib/workspace-state';

type WorkspaceMode = 'isolated' | 'direct';

interface CreateWorkspaceDialogProps {
  onClose: () => void;
}

function createDefaultBranchName(): string {
  const dateCode = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return createFluxBranchName(`workspace-${dateCode}`);
}

export function CreateWorkspaceDialog({ onClose }: CreateWorkspaceDialogProps) {
  const agents = useAgentStore((s) => s.agents);
  const selectedAgentId = useAgentStore((s) => s.selectedAgentId);
  const selectedModel = useAgentStore((s) => s.selectedModel);
  const selectedThinking = useAgentStore((s) => s.selectedThinking);
  const dynamicModels = useAgentStore((s) => s.dynamicModels);
  const cwd = useUiStore((s) => s.cwd);
  const openProjects = useUiStore((s) => s.openProjects);

  const [mode, setMode] = useState<WorkspaceMode>('isolated');
  const [name, setName] = useState('');
  const [branch, setBranch] = useState(() => createDefaultBranchName());
  const [agentId, setAgentId] = useState(selectedAgentId);
  const [model, setModel] = useState(selectedModel);
  const [parentRepo, setParentRepo] = useState(cwd);
  const [prompt, setPrompt] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const projectOptions = openProjects.length > 0 ? openProjects.map((p) => p.path) : cwd ? [cwd] : [];

  const availableAgents = agents.filter((a) => a.available);
  const selectedAgent = agents.find((a) => a.id === agentId);
  const models = dynamicModels.length > 0 ? dynamicModels : (selectedAgent?.models ?? []).map((m) => ({ id: m, name: m }));

  const handleCreate = async () => {
    if (!name.trim() || !prompt.trim()) return;
    if (mode === 'isolated' && !branch.trim()) return;
    setCreating(true);
    setError(null);
    let workspace: Workspace | null = null;

    try {
      if (mode === 'direct') {
        workspace = await window.api.invoke('workspace:create-direct', {
          name: name.trim(),
          parentRepo: parentRepo,
          agentId,
          model,
          thinking: selectedThinking,
        }) as Workspace;
      } else {
        workspace = await window.api.invoke('workspace:create', {
          name: name.trim(),
          parentRepo: parentRepo,
          branch: branch.trim(),
          agentId,
          model,
          thinking: selectedThinking,
        }) as Workspace;
      }

      useWorkspaceStore.getState().addWorkspace(workspace);
      useWorkspaceStore.getState().setActiveWorkspace(workspace.id);

      await startWorkspaceChat({
        workspace,
        prompt: prompt.trim(),
        agentId: agentId as any,
        model,
        mode: 'act',
        thinking: selectedThinking,
      });
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);

      if (workspace) {
        useWorkspaceStore.getState().updateWorkspace(workspace.id, {
          status: 'error',
        });
      }
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-full max-w-lg bg-bg-primary border border-border rounded-xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold text-text-primary">New Workspace</h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-bg-hover text-text-tertiary"
            title="Close create workspace dialog"
            aria-label="Close create workspace dialog"
          >
            <X size={16} />
          </button>
        </div>

        {/* Form */}
        <div className="px-5 py-4 space-y-4">
          {/* Mode selector */}
          <div className="flex rounded-lg border border-border overflow-hidden">
            <button
              type="button"
              onClick={() => setMode('isolated')}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${
                mode === 'isolated'
                  ? 'bg-bg-hover text-text-primary'
                  : 'bg-bg-secondary text-text-tertiary hover:text-text-secondary'
              }`}
            >
              <GitBranch size={12} />
              Isolated
            </button>
            <button
              type="button"
              onClick={() => setMode('direct')}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${
                mode === 'direct'
                  ? 'bg-bg-hover text-text-primary'
                  : 'bg-bg-secondary text-text-tertiary hover:text-text-secondary'
              }`}
            >
              <Zap size={12} />
              Direct
            </button>
          </div>

          <Field label="Name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Add auth system"
              className="input-field"
              autoFocus
            />
          </Field>

          {mode === 'isolated' && (
            <Field label="Branch">
              <input
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                className="input-field font-mono text-xs"
              />
            </Field>
          )}

          {projectOptions.length > 1 && (
            <Field label="Project">
              <select
                value={parentRepo}
                onChange={(e) => setParentRepo(e.target.value)}
                className="input-field"
              >
                {projectOptions.map((p) => (
                  <option key={p} value={p}>{p.split('/').pop() || p}</option>
                ))}
              </select>
            </Field>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Agent">
              <select
                value={agentId}
                onChange={(e) => setAgentId(e.target.value as any)}
                className="input-field"
              >
                {availableAgents.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </Field>

            <Field label="Model">
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="input-field"
              >
                {models.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="Initial Prompt">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="What should this agent work on?"
              rows={4}
              className="input-field resize-none"
            />
          </Field>

          {mode === 'direct' && (
            <div className="text-xs text-text-tertiary bg-bg-secondary border border-border/50 rounded-lg px-3 py-2">
              Works on the current branch. No worktree or merge needed.
            </div>
          )}

          {error && (
            <div className="text-xs text-error bg-error/10 border border-error/30 rounded-lg px-3 py-2">
              {error}
            </div>
          )}
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
            onClick={handleCreate}
            disabled={creating || !name.trim() || !prompt.trim()}
            className="px-4 py-1.5 text-xs font-medium rounded-lg bg-success text-white hover:bg-success/85 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {creating ? 'Creating...' : 'Create & Start'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] font-medium text-text-tertiary mb-1">{label}</label>
      {children}
    </div>
  );
}
