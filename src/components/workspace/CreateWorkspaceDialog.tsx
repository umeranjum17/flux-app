import { useState } from 'react';
import { X } from 'lucide-react';
import { useAgentStore } from '../../stores/agent';
import { useUiStore } from '../../stores/ui';
import { useWorkspaceStore } from '../../stores/workspace';
import { useChatStore } from '../../stores/chat';
import type { Workspace } from '../../lib/ipc-api';

interface CreateWorkspaceDialogProps {
  onClose: () => void;
}

export function CreateWorkspaceDialog({ onClose }: CreateWorkspaceDialogProps) {
  const agents = useAgentStore((s) => s.agents);
  const selectedAgentId = useAgentStore((s) => s.selectedAgentId);
  const selectedModel = useAgentStore((s) => s.selectedModel);
  const dynamicModels = useAgentStore((s) => s.dynamicModels);
  const cwd = useUiStore((s) => s.cwd);

  const [name, setName] = useState('');
  const [branch, setBranch] = useState(`flux-workspace-${Date.now()}`);
  const [agentId, setAgentId] = useState(selectedAgentId);
  const [model, setModel] = useState(selectedModel);
  const [prompt, setPrompt] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const availableAgents = agents.filter((a) => a.available);
  const selectedAgent = agents.find((a) => a.id === agentId);
  const models = dynamicModels.length > 0 ? dynamicModels : (selectedAgent?.models ?? []).map((m) => ({ id: m, name: m }));

  const handleCreate = async () => {
    if (!name.trim() || !branch.trim() || !prompt.trim()) return;
    setCreating(true);
    setError(null);
    let workspace: Workspace | null = null;

    try {
      workspace = await window.api.invoke('workspace:create', {
        name: name.trim(),
        parentRepo: cwd,
        branch: branch.trim(),
        agentId,
        model,
      }) as Workspace;

      useWorkspaceStore.getState().addWorkspace(workspace);
      useWorkspaceStore.getState().setActiveWorkspace(workspace.id);

      useChatStore.getState().createTask({
        id: workspace.id,
        title: `[WS] ${workspace.name}`,
        agentId: workspace.agentId as any,
        model: workspace.model,
        mode: 'act',
        thinking: 'medium',
        cwd: workspace.worktreePath,
      });
      useChatStore.getState().setTaskStatus(workspace.id, 'running');
      useChatStore.getState().setActiveTask(workspace.id);
      useWorkspaceStore.getState().updateWorkspace(workspace.id, {
        status: 'running',
      });

      // Spawn the agent
      const result = await window.api.invoke('workspace:spawn', {
        workspaceId: workspace.id,
        prompt: prompt.trim(),
        mode: 'act' as const,
      }) as { session: { id: string } };

      useChatStore.getState().setTaskSessionId(workspace.id, result.session.id);
      useWorkspaceStore.getState().updateWorkspace(workspace.id, {
        status: 'running',
        sessionId: result.session.id,
      });

      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);

      if (workspace) {
        useWorkspaceStore.getState().updateWorkspace(workspace.id, {
          status: 'error',
        });
        useChatStore.getState().addMessage(workspace.id, {
          type: 'error',
          role: 'system',
          content: message,
          timestamp: Date.now(),
        });
        useChatStore.getState().setTaskStatus(workspace.id, 'error');
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
          <button onClick={onClose} className="p-1 rounded hover:bg-bg-hover text-text-tertiary">
            <X size={16} />
          </button>
        </div>

        {/* Form */}
        <div className="px-5 py-4 space-y-4">
          <Field label="Name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Add auth system"
              className="input-field"
              autoFocus
            />
          </Field>

          <Field label="Branch">
            <input
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              className="input-field font-mono text-xs"
            />
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
            className="px-4 py-1.5 text-xs font-medium rounded-lg bg-accent text-white hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
