import { useEffect, useState, useCallback } from 'react';
import { X, GitCommit, Plus, Minus, Loader2, Check } from 'lucide-react';
import { toast } from 'sonner';
import type { Workspace, DiffFile, WorkspaceDiffSections } from '../../lib/ipc-api';

interface CommitDialogProps {
  workspace: Workspace;
  onClose: () => void;
}

export function CommitDialog({ workspace, onClose }: CommitDialogProps) {
  const [files, setFiles] = useState<DiffFile[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadFiles = useCallback(async () => {
    setLoading(true);
    try {
      const sections = await window.api.invoke('workspace:diff-files-separated', {
        workspaceId: workspace.id,
      }) as WorkspaceDiffSections;
      const allFiles = [...sections.uncommitted, ...sections.committed];
      setFiles(allFiles);
      setSelected(new Set(allFiles.map((f) => f.path)));
    } catch {
      try {
        const result = await window.api.invoke('workspace:diff-files', {
          workspaceId: workspace.id,
        }) as DiffFile[];
        setFiles(result);
        setSelected(new Set(result.map((f) => f.path)));
      } catch {
        setFiles([]);
      }
    } finally {
      setLoading(false);
    }
  }, [workspace.id]);

  useEffect(() => { void loadFiles(); }, [loadFiles]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !committing) onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [committing, onClose]);

  const toggleFile = (path: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === files.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(files.map((f) => f.path)));
    }
  };

  const totalAdditions = files.filter((f) => selected.has(f.path)).reduce((sum, f) => sum + f.additions, 0);
  const totalDeletions = files.filter((f) => selected.has(f.path)).reduce((sum, f) => sum + f.deletions, 0);

  const handleCommit = async () => {
    if (committing || selected.size === 0) return;
    setCommitting(true);
    setError(null);
    try {
      const selectedFiles = selected.size === files.length ? undefined : Array.from(selected);
      const result = await window.api.invoke('workspace:commit', {
        workspaceId: workspace.id,
        message: message.trim() || undefined,
        files: selectedFiles,
      }) as { sha: string; message: string };
      toast.success(`Committed ${result.sha}`);
      onClose();
    } catch (err: any) {
      setError(err.message ?? 'Commit failed');
      setCommitting(false);
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
          <div className="flex items-center gap-2">
            <GitCommit size={16} className="text-success" />
            <h2 className="text-sm font-semibold text-text-primary">Commit Changes</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-bg-hover text-text-tertiary"
            title="Close commit dialog"
            aria-label="Close commit dialog"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Branch info */}
          <div className="text-xs text-text-secondary">
            Committing to{' '}
            <span className="font-mono text-text-primary">{workspace.branch}</span>
          </div>

          {/* Error */}
          {error && (
            <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          {/* Commit message */}
          <div>
            <label className="block text-[13px] font-medium text-text-tertiary mb-1">Commit Message</label>
            <input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Describe your changes..."
              className="input-field text-xs"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && selected.size > 0) {
                  e.preventDefault();
                  handleCommit();
                }
              }}
            />
          </div>

          {/* File list */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-[13px] font-medium text-text-tertiary">
                Files ({selected.size}/{files.length})
              </label>
              {files.length > 0 && (
                <button
                  onClick={toggleAll}
                  className="text-[11px] text-text-tertiary hover:text-text-secondary"
                >
                  {selected.size === files.length ? 'Deselect all' : 'Select all'}
                </button>
              )}
            </div>

            {loading ? (
              <div className="flex items-center gap-2 text-xs text-text-tertiary py-4 justify-center">
                <Loader2 size={12} className="animate-spin" />
                Loading files...
              </div>
            ) : files.length === 0 ? (
              <div className="text-xs text-text-tertiary py-4 text-center">
                No changes to commit
              </div>
            ) : (
              <div className="max-h-52 overflow-y-auto rounded-lg border border-border bg-bg-secondary">
                {files.map((file) => (
                  <label
                    key={file.path}
                    className="flex items-center gap-2 px-3 py-1.5 hover:bg-bg-hover cursor-pointer border-b border-border/40 last:border-b-0"
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(file.path)}
                      onChange={() => toggleFile(file.path)}
                      className="rounded border-border"
                    />
                    <span className="flex-1 min-w-0 text-xs text-text-primary font-mono truncate" title={file.path}>
                      {file.path}
                    </span>
                    <span className="flex items-center gap-1.5 text-[11px] shrink-0">
                      {file.additions > 0 && (
                        <span className="flex items-center gap-0.5 text-success">
                          <Plus size={10} />
                          {file.additions}
                        </span>
                      )}
                      {file.deletions > 0 && (
                        <span className="flex items-center gap-0.5 text-error">
                          <Minus size={10} />
                          {file.deletions}
                        </span>
                      )}
                    </span>
                  </label>
                ))}
              </div>
            )}

            {/* Summary */}
            {selected.size > 0 && (
              <div className="flex items-center gap-3 mt-2 text-[11px] text-text-tertiary">
                <span>{selected.size} file{selected.size !== 1 ? 's' : ''} selected</span>
                {totalAdditions > 0 && <span className="text-success">+{totalAdditions}</span>}
                {totalDeletions > 0 && <span className="text-error">-{totalDeletions}</span>}
              </div>
            )}
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
            onClick={handleCommit}
            disabled={committing || selected.size === 0 || files.length === 0}
            className="px-4 py-1.5 text-xs font-medium rounded-lg bg-success text-white hover:bg-success/85 disabled:opacity-50 disabled:cursor-not-allowed transition-colors inline-flex items-center gap-1.5"
          >
            {committing ? (
              <>
                <Loader2 size={11} className="animate-spin" />
                Committing...
              </>
            ) : (
              <>
                <Check size={11} />
                Commit {selected.size > 0 ? `${selected.size} file${selected.size !== 1 ? 's' : ''}` : ''}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
