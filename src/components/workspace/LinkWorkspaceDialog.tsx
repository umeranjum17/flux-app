import { useEffect, useMemo, useState } from 'react';
import { Link2, X } from 'lucide-react';
import { useWorkspaceStore } from '../../stores/workspace';
import { useWorkspaceGroupStore } from '../../stores/workspace-group';
import { useUiStore } from '../../stores/ui';
import { getWorkspaceListSignal } from '../../lib/workspace-status';
import { WorkspaceLifecycleIcon } from './WorkspaceLifecycleIcon';
import type { Workspace } from '../../lib/ipc-api';

function basename(value: string): string {
  return value.split('/').pop() || value.split('\\').pop() || value;
}

export function LinkWorkspaceDialog() {
  const linkingWorkspaceId = useUiStore((s) => s.linkingWorkspaceId);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const getSiblingsOf = useWorkspaceGroupStore((s) => s.getSiblingsOf);
  const linkWorkspaces = useWorkspaceGroupStore((s) => s.linkWorkspaces);
  const sourceWorkspace = linkingWorkspaceId ? workspaces.get(linkingWorkspaceId) : null;
  const linkedWorkspaceIds = new Set((linkingWorkspaceId ? getSiblingsOf(linkingWorkspaceId) : []).map((member) => member.workspaceId));
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const groupedCandidates = useMemo(() => {
    if (!sourceWorkspace) return new Map<string, Workspace[]>();
    const candidates = (Array.from(workspaces.values()) as Workspace[])
      .filter((workspace) => workspace.id !== sourceWorkspace.id)
      .filter((workspace) => workspace.parentRepo !== sourceWorkspace.parentRepo)
      .filter((workspace) => {
        const siblingCount = getSiblingsOf(workspace.id).length;
        return siblingCount === 0 || linkedWorkspaceIds.has(workspace.id);
      });

    const groups = new Map<string, typeof candidates>();
    for (const candidate of candidates) {
      const key = basename(candidate.parentRepo);
      groups.set(key, [...(groups.get(key) ?? []), candidate]);
    }
    return groups;
  }, [getSiblingsOf, linkedWorkspaceIds, sourceWorkspace, workspaces]);

  useEffect(() => {
    setSelectedIds([]);
    setSubmitting(false);
  }, [linkingWorkspaceId]);

  useEffect(() => {
    if (linkingWorkspaceId && !sourceWorkspace) {
      useUiStore.getState().setLinkingWorkspaceId(null);
    }
  }, [linkingWorkspaceId, sourceWorkspace]);

  if (!sourceWorkspace) return null;

  const close = () => useUiStore.getState().setLinkingWorkspaceId(null);

  const toggleSelection = (workspaceId: string) => {
    setSelectedIds((current) =>
      current.includes(workspaceId)
        ? current.filter((id) => id !== workspaceId)
        : [...current, workspaceId],
    );
  };

  const handleSubmit = async () => {
    if (selectedIds.length === 0) return;
    setSubmitting(true);
    try {
      await linkWorkspaces(sourceWorkspace.id, selectedIds);
      close();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={close}>
      <div className="w-full max-w-lg rounded-xl border border-border bg-bg-primary shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-text-primary">Link Workspace</h2>
            <p className="mt-1 text-xs text-text-tertiary">
              Link <span className="font-medium text-text-secondary">{sourceWorkspace.name}</span> to related workspaces in other repos.
            </p>
          </div>
          <button onClick={close} className="rounded p-1 text-text-tertiary hover:bg-bg-hover" aria-label="Close link workspace dialog">
            <X size={16} />
          </button>
        </div>

        <div className="max-h-[420px] space-y-4 overflow-y-auto px-5 py-4">
          {Array.from(groupedCandidates.entries()).map(([projectName, candidates]) => (
            <div key={projectName}>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">{projectName}</div>
              <div className="space-y-2">
                {candidates.map((workspace) => {
                  const signal = getWorkspaceListSignal(workspace);
                  const alreadyLinked = linkedWorkspaceIds.has(workspace.id);
                  return (
                    <label
                      key={workspace.id}
                      className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 ${
                        alreadyLinked ? 'border-border bg-bg-secondary/50 opacity-70' : 'border-border/70 hover:bg-bg-hover'
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={alreadyLinked || selectedIds.includes(workspace.id)}
                        disabled={alreadyLinked}
                        onChange={() => toggleSelection(workspace.id)}
                      />
                      <WorkspaceLifecycleIcon state={signal.state} size={12} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm text-text-primary">{workspace.name}</div>
                        <div className="mt-0.5 truncate font-mono text-[11px] text-text-tertiary">{workspace.branch}</div>
                      </div>
                      {alreadyLinked && <Link2 size={14} className="text-accent" />}
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
          {groupedCandidates.size === 0 && (
            <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-text-tertiary">
              No eligible workspaces from other projects are available.
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <button onClick={close} className="rounded-lg px-3 py-1.5 text-xs text-text-secondary hover:bg-bg-hover">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || selectedIds.length === 0}
            className="rounded-lg bg-accent px-4 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? 'Linking...' : 'Link Workspaces'}
          </button>
        </div>
      </div>
    </div>
  );
}
