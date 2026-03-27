import { useEffect, useMemo, useState } from 'react';
import { X, Zap, GitBranch, FolderOpen, Wifi } from 'lucide-react';
import { useAgentStore } from '../../stores/agent';
import { getProjectSourceKey, normalizeProjectSource, useUiStore } from '../../stores/ui';
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
  const activeProject = useUiStore((s) => s.activeProject);

  const projectOptions = useMemo(() => {
    if (openProjects.length > 0) return openProjects;
    const fallbackProject = normalizeProjectSource(activeProject ?? cwd);
    return fallbackProject ? [fallbackProject] : [];
  }, [activeProject, cwd, openProjects]);
  const initialProjectKey = useMemo(() => {
    if (activeProject) {
      const match = projectOptions.find((project) => getProjectSourceKey(project) === getProjectSourceKey(activeProject));
      if (match) return getProjectSourceKey(match);
    }
    return projectOptions[0] ? getProjectSourceKey(projectOptions[0]) : '';
  }, [activeProject, projectOptions]);

  const [mode, setMode] = useState<WorkspaceMode>('isolated');
  const [name, setName] = useState('');
  const [branch, setBranch] = useState(() => createDefaultBranchName());
  const [agentId, setAgentId] = useState(selectedAgentId);
  const [model, setModel] = useState(selectedModel);
  const [selectedProjectKey, setSelectedProjectKey] = useState(initialProjectKey);
  const [prompt, setPrompt] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const availableAgents = agents.filter((a) => a.available);
  const selectedAgent = agents.find((a) => a.id === agentId);
  const models = dynamicModels.length > 0 ? dynamicModels : (selectedAgent?.models ?? []).map((m) => ({ id: m, name: m }));
  const selectedProject = projectOptions.find((project) => getProjectSourceKey(project) === selectedProjectKey) ?? projectOptions[0] ?? null;
  const parentRepo = selectedProject?.path ?? cwd;
  const selectedSourceLabel = selectedProject?.source === 'ssh' ? 'SSH project' : 'Local project';
  const sourceContext = selectedProject?.source === 'ssh'
    ? `${selectedProject.sshHost ?? 'SSH host'} · ${selectedProject.path}`
    : selectedProject?.path ?? 'No project selected';
  const modeDescription = mode === 'isolated'
    ? 'Creates a dedicated workspace so you can review and merge changes separately.'
    : 'Runs directly in the selected project without creating a separate worktree.';

  useEffect(() => {
    if (!selectedProjectKey && projectOptions[0]) {
      setSelectedProjectKey(getProjectSourceKey(projectOptions[0]));
    }
  }, [projectOptions, selectedProjectKey]);

  const handleCreate = async () => {
    if (!name.trim() || !prompt.trim()) return;
    if (mode === 'isolated' && !branch.trim()) return;
    if (!parentRepo) return;
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
          sshHost: selectedProject?.source === 'ssh' ? selectedProject.sshHost : undefined,
        }) as Workspace;
      } else {
        workspace = await window.api.invoke('workspace:create', {
          name: name.trim(),
          parentRepo: parentRepo,
          branch: branch.trim(),
          agentId,
          model,
          thinking: selectedThinking,
          sshHost: selectedProject?.source === 'ssh' ? selectedProject.sshHost : undefined,
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
          <div>
            <h2 className="text-sm font-semibold text-text-primary">New Workspace</h2>
            <p className="mt-1 text-[11px] text-text-tertiary">Pick the project source first, then choose whether this should be isolated or direct.</p>
          </div>
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

          <div className="rounded-lg border border-border/60 bg-bg-secondary/60 px-3 py-2">
            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              <span className={`rounded-full border px-2 py-0.5 font-medium ${
                selectedProject?.source === 'ssh'
                  ? 'border-accent/20 bg-accent/8 text-accent'
                  : 'border-border/60 bg-bg-primary/60 text-text-secondary'
              }`}>
                {selectedSourceLabel}
              </span>
              <span className={`rounded-full border px-2 py-0.5 font-medium ${
                mode === 'isolated'
                  ? 'border-success/20 bg-success/8 text-success'
                  : 'border-warning/20 bg-warning/8 text-warning'
              }`}>
                {mode === 'isolated' ? 'Separate workspace' : 'Current branch'}
              </span>
            </div>
            <div className="mt-2 flex items-start gap-2 text-[11px] text-text-tertiary">
              {selectedProject?.source === 'ssh'
                ? <Wifi size={12} className="mt-0.5 shrink-0 text-accent" />
                : <FolderOpen size={12} className="mt-0.5 shrink-0 text-text-secondary" />}
              <div className="min-w-0">
                <p className="truncate text-text-secondary">{sourceContext}</p>
                <p className="mt-1">{modeDescription}</p>
              </div>
            </div>
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

          <Field label="Project Source">
            {projectOptions.length > 1 ? (
              <select
                value={selectedProjectKey}
                onChange={(e) => setSelectedProjectKey(e.target.value)}
                className="input-field"
              >
                {projectOptions.map((project) => (
                  <option key={getProjectSourceKey(project)} value={getProjectSourceKey(project)}>
                    {project.source === 'ssh' && project.sshHost
                      ? `${project.sshHost} · ${project.path.split('/').pop() || project.path}`
                      : project.path.split('/').pop() || project.path}
                  </option>
                ))}
              </select>
            ) : (
              <div className="input-field flex items-center gap-2 text-xs text-text-secondary">
                {selectedProject?.source === 'ssh'
                  ? <Wifi size={12} className="shrink-0 text-accent" />
                  : <FolderOpen size={12} className="shrink-0 text-text-tertiary" />}
                <span className="truncate">{sourceContext}</span>
              </div>
            )}
          </Field>

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
              Direct mode works on the selected project source immediately. Isolated mode keeps the work in a separate workspace.
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
