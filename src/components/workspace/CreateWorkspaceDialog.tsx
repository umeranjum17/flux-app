import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { X, FolderOpen, Wifi, ImagePlus, Play, FileText, Search, Inbox } from 'lucide-react';
import { useAgentStore } from '../../stores/agent';
import { getProjectSourceKey, normalizeProjectSource, useUiStore } from '../../stores/ui';
import { useWorkspaceStore } from '../../stores/workspace';
import type { Workspace, WorkspaceOutcome } from '../../lib/ipc-api';
import { createFluxBranchName, startWorkspaceChat } from '../../lib/workspace-state';
import { ImageAttach } from '../input/ImageAttach';

interface CreateWorkspaceDialogProps {
  onClose: () => void;
  defaultProjectKey?: string | null;
}

function createDefaultBranchName(): string {
  const dateCode = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return createFluxBranchName(`workspace-${dateCode}`);
}

export function CreateWorkspaceDialog({ onClose, defaultProjectKey }: CreateWorkspaceDialogProps) {
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
    if (defaultProjectKey) {
      const match = projectOptions.find((project) => getProjectSourceKey(project) === defaultProjectKey);
      if (match) return defaultProjectKey;
    }
    if (activeProject) {
      const match = projectOptions.find((project) => getProjectSourceKey(project) === getProjectSourceKey(activeProject));
      if (match) return getProjectSourceKey(match);
    }
    return projectOptions[0] ? getProjectSourceKey(projectOptions[0]) : '';
  }, [defaultProjectKey, activeProject, projectOptions]);

  const [agentId, setAgentId] = useState(selectedAgentId);
  const [model, setModel] = useState(selectedModel);
  const [selectedProjectKey, setSelectedProjectKey] = useState(initialProjectKey);
  const [startingOutcome, setStartingOutcome] = useState<WorkspaceOutcome>('in_progress');
  const [prompt, setPrompt] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addImageFromFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setImages((prev) => [...prev, reader.result as string]);
      }
    };
    reader.readAsDataURL(file);
  }, []);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) addImageFromFile(file);
      }
    }
  }, [addImageFromFile]);

  const availableAgents = agents.filter((a) => a.available);
  const selectedAgent = agents.find((a) => a.id === agentId);
  const models = dynamicModels.length > 0 ? dynamicModels : (selectedAgent?.models ?? []).map((m) => ({ id: m, name: m }));
  const selectedProject = projectOptions.find((project) => getProjectSourceKey(project) === selectedProjectKey) ?? projectOptions[0] ?? null;
  const parentRepo = selectedProject?.path ?? cwd;
  const sourceContext = selectedProject?.source === 'ssh'
    ? `${selectedProject.sshHost ?? 'SSH host'} · ${selectedProject.path}`
    : selectedProject?.path ?? 'No project selected';

  useEffect(() => {
    if (!selectedProjectKey && projectOptions[0]) {
      setSelectedProjectKey(getProjectSourceKey(projectOptions[0]));
    }
  }, [projectOptions, selectedProjectKey]);

  const handleCreate = async () => {
    if (!prompt.trim()) return;
    if (!parentRepo) return;
    setCreating(true);
    setError(null);
    let workspace: Workspace | null = null;

    try {
      const branch = createDefaultBranchName();
      workspace = await window.api.invoke('workspace:create', {
        parentRepo: parentRepo,
        branch,
        agentId,
        model,
        thinking: selectedThinking,
        sshHost: selectedProject?.source === 'ssh' ? selectedProject.sshHost : undefined,
        outcome: startingOutcome,
      }) as Workspace;

      useWorkspaceStore.getState().addWorkspace(workspace);
      useWorkspaceStore.getState().setActiveWorkspace(workspace.id);

      if (startingOutcome !== 'backlog') {
        await startWorkspaceChat({
          workspace,
          prompt: prompt.trim(),
          agentId: agentId as any,
          model,
          mode: 'act',
          thinking: selectedThinking,
          images: images.length > 0 ? images : undefined,
        });
      }
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
        className="w-full max-w-md bg-bg-primary border border-border rounded-xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
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
        <div className="px-5 py-4 space-y-3">
          {/* Prompt first — this is the most important field */}
          <div>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onPaste={handlePaste}
              placeholder="What should this agent work on?"
              rows={3}
              className="input-field resize-none"
              autoFocus
            />
            <div className="mt-1.5 flex items-center gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary"
              >
                <ImagePlus size={12} />
                Attach image
              </button>
              {images.length === 0 && (
                <span className="text-[10px] text-text-tertiary/50">or paste from clipboard</span>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                const files = e.target.files;
                if (files) {
                  for (const file of files) addImageFromFile(file);
                }
                e.target.value = '';
              }}
            />
            <ImageAttach
              images={images}
              onRemove={(i) => setImages((prev) => prev.filter((_, idx) => idx !== i))}
              showContextHint
            />
          </div>

          {/* Assignee — combined Agent · Model selector */}
          <Field label="Assignee">
            <select
              value={`${agentId}::${model}`}
              onChange={(e) => {
                const [newAgentId, newModel] = e.target.value.split('::');
                setAgentId(newAgentId as any);
                setModel(newModel);
              }}
              className="input-field"
            >
              {availableAgents.map((agent) => {
                const agentModels = agent.id === agentId && dynamicModels.length > 0
                  ? dynamicModels
                  : (agent.models ?? []).map((m) => ({ id: m, name: m }));
                return (
                  <optgroup key={agent.id} label={agent.name}>
                    {agentModels.map((m) => (
                      <option key={`${agent.id}::${m.id}`} value={`${agent.id}::${m.id}`}>
                        {agent.name} · {m.name}
                      </option>
                    ))}
                  </optgroup>
                );
              })}
            </select>
          </Field>

          {/* How to start */}
          <div>
            <label className="block text-[11px] font-medium text-text-tertiary mb-1.5">How to start</label>
            <div className="grid grid-cols-4 gap-2">
              {([
                { outcome: 'in_progress' as const, icon: Play, label: 'Build', desc: 'Start coding immediately' },
                { outcome: 'planned' as const, icon: FileText, label: 'Plan First', desc: 'Create a plan, then build' },
                { outcome: 'discovery' as const, icon: Search, label: 'Discover', desc: 'Explore and gather context' },
                { outcome: 'backlog' as const, icon: Inbox, label: 'Backlog', desc: 'Save for later' },
              ]).map(({ outcome, icon: Icon, label, desc }) => (
                <button
                  key={outcome}
                  type="button"
                  onClick={() => setStartingOutcome(outcome)}
                  className={`flex flex-col items-center gap-1 rounded-lg border px-3 py-2.5 text-center transition-colors ${
                    startingOutcome === outcome
                      ? 'border-accent/50 bg-accent/8 text-text-primary'
                      : 'border-border bg-bg-secondary text-text-tertiary hover:border-border hover:bg-bg-hover hover:text-text-secondary'
                  }`}
                >
                  <Icon size={14} />
                  <span className="text-[11px] font-medium">{label}</span>
                  <span className="text-[9px] leading-tight opacity-60">{desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Project source — only show selector when multiple projects */}
          {projectOptions.length > 1 && (
            <Field label="Project">
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
            </Field>
          )}

          {/* Context line */}
          <div className="flex items-center gap-1.5 text-[11px] text-text-tertiary">
            {selectedProject?.source === 'ssh'
              ? <Wifi size={11} className="shrink-0 text-accent" />
              : <FolderOpen size={11} className="shrink-0" />}
            <span className="truncate">{sourceContext}</span>
          </div>

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
            disabled={creating || !prompt.trim()}
            className="px-4 py-1.5 text-xs font-medium rounded-lg bg-success text-white hover:bg-success/85 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {creating ? 'Creating...' : startingOutcome === 'backlog' ? 'Add to Backlog' : startingOutcome === 'discovery' ? 'Discover & Start' : startingOutcome === 'planned' ? 'Plan & Start' : 'Create & Start'}
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
