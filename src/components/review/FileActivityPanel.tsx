import { useEffect, useRef } from 'react';
import { X, FilePen } from 'lucide-react';
import { useChatStore } from '../../stores/chat';
import { useUiStore } from '../../stores/ui';
import type { EditedFileEntry } from '../../lib/types';

function getBasename(path: string): string {
  return path.split('/').pop() ?? path;
}

function getDirectory(path: string): string {
  const parts = path.split('/');
  if (parts.length <= 1) return '';
  return parts.slice(-2, -1)[0] + '/';
}

function FileRow({
  entry,
  isActive,
  onClick,
}: {
  entry: EditedFileEntry;
  isActive: boolean;
  onClick: () => void;
}) {
  const basename = getBasename(entry.filePath);
  const dir = getDirectory(entry.filePath);

  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${
        isActive
          ? 'bg-accent/10 text-accent'
          : 'text-text-secondary hover:bg-bg-hover/50 hover:text-text-primary'
      }`}
      title={entry.filePath}
    >
      <FilePen size={12} className="shrink-0 text-info" />
      <div className="min-w-0 flex-1 flex items-baseline gap-1">
        <span className="text-[12px] font-medium truncate">{basename}</span>
        {dir && (
          <span className="text-[11px] text-text-tertiary truncate">{dir}</span>
        )}
      </div>
      <span className="flex items-center gap-1 shrink-0 text-[11px] font-mono">
        {entry.additions > 0 && (
          <span className="text-success">+{entry.additions}</span>
        )}
        {entry.deletions > 0 && (
          <span className="text-error">-{entry.deletions}</span>
        )}
        {entry.additions === 0 && entry.deletions === 0 && (
          <span className="text-text-tertiary">±0</span>
        )}
      </span>
    </button>
  );
}

export function FileActivityPanel() {
  const task = useChatStore((s) => s.getActiveTask());
  const scrollToFileEdit = useChatStore((s) => s.scrollToFileEdit);
  const panelRef = useRef<HTMLDivElement>(null);

  const editedFiles = task?.editedFiles;
  const files = editedFiles ? Array.from(editedFiles.values()) : [];
  const totalAdditions = files.reduce((sum, f) => sum + f.additions, 0);
  const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0);

  // Close on Escape
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        useUiStore.getState().setFileActivityPanelOpen(false);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  if (files.length === 0) {
    return (
      <div
        ref={panelRef}
        className="w-[220px] shrink-0 border-l border-border/50 bg-bg-surface/30 flex flex-col"
      >
        <div className="flex items-center justify-between px-3 py-2 border-b border-border/40">
          <span className="text-[12px] font-medium text-text-secondary">Files</span>
          <button
            onClick={() => useUiStore.getState().setFileActivityPanelOpen(false)}
            className="p-0.5 rounded text-text-tertiary hover:text-text-primary transition-colors"
          >
            <X size={13} />
          </button>
        </div>
        <div className="flex-1 flex items-center justify-center px-3">
          <p className="text-[12px] text-text-tertiary text-center">
            No files edited yet
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={panelRef}
      className="w-[220px] shrink-0 border-l border-border/50 bg-bg-surface/30 flex flex-col"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/40">
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-medium text-text-secondary">
            {files.length} file{files.length !== 1 ? 's' : ''}
          </span>
          <span className="flex items-center gap-1 text-[11px] font-mono">
            <span className="text-success">+{totalAdditions}</span>
            <span className="text-error">-{totalDeletions}</span>
          </span>
        </div>
        <button
          onClick={() => useUiStore.getState().setFileActivityPanelOpen(false)}
          className="p-0.5 rounded text-text-tertiary hover:text-text-primary transition-colors"
        >
          <X size={13} />
        </button>
      </div>

      {/* File list */}
      <div className="flex-1 overflow-y-auto px-1 py-1 space-y-0.5">
        {files
          .sort((a, b) => b.timestamp - a.timestamp)
          .map((entry) => (
            <FileRow
              key={entry.filePath}
              entry={entry}
              isActive={false}
              onClick={() => scrollToFileEdit(entry.toolCallId)}
            />
          ))}
      </div>
    </div>
  );
}
