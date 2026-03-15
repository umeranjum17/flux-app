import { useEffect, useCallback, useMemo } from 'react';
import { X, FilePlus, FileEdit, FileX, FileSymlink, Undo2 } from 'lucide-react';
import { useWorkspaceStore } from '../../stores/workspace';
import { ReviewDiffViewer } from './ReviewDiffViewer';
import type { DiffFile } from '../../lib/ipc-api';

const statusIcons: Record<DiffFile['status'], React.ReactNode> = {
  added: <FilePlus size={12} className="text-success shrink-0" />,
  modified: <FileEdit size={12} className="text-warning shrink-0" />,
  deleted: <FileX size={12} className="text-error shrink-0" />,
  renamed: <FileSymlink size={12} className="text-info shrink-0" />,
};

function fileName(path: string): string {
  return path.split('/').pop() || path;
}

function dirName(path: string): string {
  const parts = path.split('/');
  return parts.length > 1 ? parts.slice(0, -1).join('/') + '/' : '';
}

export function ChangesPanel() {
  const open = useWorkspaceStore((s) => s.changesPanelOpen);
  const workspaceId = useWorkspaceStore((s) => s.changesPanelWorkspaceId);
  const files = useWorkspaceStore((s) => s.changesPanelFiles);
  const selectedFile = useWorkspaceStore((s) => s.changesPanelSelectedFile);
  const fileDiff = useWorkspaceStore((s) => s.changesPanelFileDiff);
  const workspaces = useWorkspaceStore((s) => s.workspaces);

  const workspace = workspaceId ? workspaces.get(workspaceId) : null;

  const totalAdded = useMemo(() => files.reduce((s, f) => s + f.additions, 0), [files]);
  const totalDeleted = useMemo(() => files.reduce((s, f) => s + f.deletions, 0), [files]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        useWorkspaceStore.getState().closeChangesPanel();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open]);

  // Keyboard navigation: up/down arrows to cycle files
  useEffect(() => {
    if (!open || files.length === 0) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      const active = document.activeElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;

      e.preventDefault();
      const store = useWorkspaceStore.getState();
      const currentIdx = store.changesPanelFiles.findIndex((f) => f.path === store.changesPanelSelectedFile);
      const len = store.changesPanelFiles.length;
      if (len === 0) return;

      let nextIdx: number;
      if (e.key === 'ArrowDown') {
        nextIdx = currentIdx < 0 ? 0 : (currentIdx + 1) % len;
      } else {
        nextIdx = currentIdx < 0 ? len - 1 : (currentIdx - 1 + len) % len;
      }
      store.changesPanelSelectFile(store.changesPanelFiles[nextIdx].path);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, files.length]);

  const handleDiscard = useCallback(async (filePath: string) => {
    if (!workspaceId) return;
    await window.api.invoke('workspace:discard-file', { workspaceId, filePath });
    useWorkspaceStore.getState().refreshChangesPanelFiles();
  }, [workspaceId]);

  if (!open) return null;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-bg-secondary shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-semibold text-text-primary">Changes</span>
          {files.length > 0 && (
            <span className="text-[11px] text-text-tertiary">
              {files.length} file{files.length !== 1 ? 's' : ''}
              {totalAdded > 0 && <span className="text-success ml-1.5">+{totalAdded}</span>}
              {totalDeleted > 0 && <span className="text-error ml-1">-{totalDeleted}</span>}
            </span>
          )}
          {workspace && (
            <span className="text-[11px] font-mono text-text-tertiary truncate">{workspace.branch}</span>
          )}
        </div>
        <button
          onClick={() => useWorkspaceStore.getState().closeChangesPanel()}
          className="p-1 rounded hover:bg-bg-hover text-text-tertiary hover:text-text-primary transition-colors"
          title="Close (Esc)"
        >
          <X size={14} />
        </button>
      </div>

      {/* Split: file list + diff viewer */}
      <div className="flex flex-1 min-h-0">
        {/* File list sidebar */}
        <div className="w-64 shrink-0 border-r border-border bg-bg-secondary overflow-y-auto">
          {files.length === 0 ? (
            <div className="px-3 py-6 text-center text-[11px] text-text-tertiary">No changes detected</div>
          ) : (
            files.map((file) => {
              const isSelected = file.path === selectedFile;
              return (
                <button
                  key={file.path}
                  onClick={() => useWorkspaceStore.getState().changesPanelSelectFile(file.path)}
                  className={`group w-full flex items-center gap-1.5 px-3 py-1.5 text-left transition-colors ${
                    isSelected
                      ? 'bg-accent/10 text-text-primary'
                      : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
                  }`}
                >
                  {statusIcons[file.status]}
                  <span className="flex-1 min-w-0 truncate text-[11px] font-mono">
                    <span className="text-text-tertiary">{dirName(file.path)}</span>
                    {fileName(file.path)}
                  </span>
                  <span className="flex items-center gap-1 shrink-0 text-[10px]">
                    {file.additions > 0 && <span className="text-success">+{file.additions}</span>}
                    {file.deletions > 0 && <span className="text-error">-{file.deletions}</span>}
                  </span>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDiscard(file.path); }}
                    className="p-0.5 rounded opacity-0 group-hover:opacity-100 text-text-tertiary hover:text-error hover:bg-error/10 transition-all"
                    title="Discard changes"
                  >
                    <Undo2 size={11} />
                  </button>
                </button>
              );
            })
          )}
        </div>

        {/* Diff viewer - main area */}
        <div className="flex-1 min-w-0">
          {selectedFile && fileDiff ? (
            <ReviewDiffViewer
              oldContent={fileDiff.oldContent}
              newContent={fileDiff.newContent}
              fileName={selectedFile}
              onDiscard={() => handleDiscard(selectedFile)}
            />
          ) : selectedFile ? (
            <div className="flex items-center justify-center h-full text-xs text-text-tertiary">
              Loading diff...
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-xs text-text-tertiary">
              Select a file to view changes
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
