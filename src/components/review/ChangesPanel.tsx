import { useEffect, useCallback, useMemo, useRef } from 'react';
import { X, FilePlus, FileEdit, FileX, FileSymlink, Undo2, ChevronDown, ChevronRight } from 'lucide-react';
import ReactDiffViewer, { DiffMethod } from 'react-diff-viewer-continued';
import { useWorkspaceStore } from '../../stores/workspace';
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
  const listRef = useRef<HTMLDivElement>(null);

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
      // Only handle when no text input is focused
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

  const diffStyles = useMemo(
    () => ({
      variables: {
        dark: {
          diffViewerBackground: 'var(--color-bg-primary)',
          diffViewerColor: 'var(--color-text-primary)',
          addedBackground: 'rgba(34, 197, 94, 0.1)',
          addedColor: 'var(--color-text-primary)',
          removedBackground: 'rgba(239, 68, 68, 0.1)',
          removedColor: 'var(--color-text-primary)',
          wordAddedBackground: 'rgba(34, 197, 94, 0.25)',
          wordRemovedBackground: 'rgba(239, 68, 68, 0.25)',
          addedGutterBackground: 'rgba(34, 197, 94, 0.15)',
          removedGutterBackground: 'rgba(239, 68, 68, 0.15)',
          gutterBackground: 'var(--color-bg-elevated)',
          gutterBackgroundDark: 'var(--color-bg-elevated)',
          highlightBackground: 'var(--color-bg-hover)',
          highlightGutterBackground: 'var(--color-bg-hover)',
          codeFoldGutterBackground: 'var(--color-bg-elevated)',
          codeFoldBackground: 'var(--color-bg-elevated)',
          emptyLineBackground: 'var(--color-bg-primary)',
          codeFoldContentColor: 'var(--color-text-tertiary)',
        },
      },
      line: {
        fontSize: '12px',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Cascadia Code", monospace',
      },
    }),
    [],
  );

  if (!open) return null;

  return (
    <div className="flex h-full w-[460px] min-w-[360px] max-w-[600px] shrink-0 flex-col border-l border-border bg-bg-primary animate-in slide-in-from-right-2 fade-in duration-200">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-bg-secondary shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[11px] font-semibold text-text-primary">Changes</span>
          {files.length > 0 && (
            <span className="text-[10px] text-text-tertiary">
              {files.length} file{files.length !== 1 ? 's' : ''}
              {totalAdded > 0 && <span className="text-success ml-1.5">+{totalAdded}</span>}
              {totalDeleted > 0 && <span className="text-error ml-1">-{totalDeleted}</span>}
            </span>
          )}
          {workspace && (
            <span className="text-[10px] font-mono text-text-tertiary truncate">{workspace.branch}</span>
          )}
        </div>
        <button
          onClick={() => useWorkspaceStore.getState().closeChangesPanel()}
          className="p-1 rounded hover:bg-bg-hover text-text-tertiary hover:text-text-primary transition-colors"
          title="Close (Esc)"
        >
          <X size={13} />
        </button>
      </div>

      {/* File list */}
      <div ref={listRef} className="shrink-0 border-b border-border overflow-y-auto" style={{ maxHeight: '40%' }}>
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
                {isSelected ? <ChevronDown size={11} className="shrink-0 text-text-tertiary" /> : <ChevronRight size={11} className="shrink-0 text-text-tertiary" />}
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

      {/* Diff viewer */}
      <div className="flex-1 min-h-0 overflow-auto">
        {selectedFile && fileDiff ? (
          <ReactDiffViewer
            oldValue={fileDiff.oldContent}
            newValue={fileDiff.newContent}
            splitView={false}
            useDarkTheme
            compareMethod={DiffMethod.WORDS}
            styles={diffStyles}
          />
        ) : selectedFile ? (
          <div className="flex items-center justify-center h-full text-[11px] text-text-tertiary">
            Loading diff...
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-[11px] text-text-tertiary">
            Select a file to view changes
          </div>
        )}
      </div>
    </div>
  );
}
