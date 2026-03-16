import { FilePlus, FileEdit, FileX, FileSymlink, Undo2 } from 'lucide-react';
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

interface FileChangelistProps {
  files: DiffFile[];
  selectedFile: string | null;
  onSelect: (path: string) => void;
  onDiscard?: (path: string) => void;
  /** Hide the summary header */
  hideSummary?: boolean;
  className?: string;
}

export function FileChangelist({ files, selectedFile, onSelect, onDiscard, hideSummary, className }: FileChangelistProps) {
  if (files.length === 0) {
    return (
      <div className="px-3 py-6 text-center text-[11px] text-text-tertiary">
        No changes detected
      </div>
    );
  }

  const totalAdded = files.reduce((sum, f) => sum + f.additions, 0);
  const totalDeleted = files.reduce((sum, f) => sum + f.deletions, 0);

  return (
    <div className={`flex flex-col h-full ${className ?? ''}`}>
      {/* Summary */}
      {!hideSummary && (
        <div className="px-3 py-2 border-b border-border text-[11px] text-text-tertiary">
          <span>{files.length} file{files.length !== 1 ? 's' : ''} changed</span>
          {totalAdded > 0 && <span className="text-success ml-2">+{totalAdded}</span>}
          {totalDeleted > 0 && <span className="text-error ml-1">-{totalDeleted}</span>}
        </div>
      )}

      {/* File list */}
      <div className="flex-1 overflow-y-auto py-1">
        {files.map((file) => {
          const isSelected = file.path === selectedFile;
          return (
            <button
              key={file.path}
              onClick={() => onSelect(file.path)}
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
              {onDiscard && (
                <button
                  onClick={(e) => { e.stopPropagation(); onDiscard(file.path); }}
                  className="p-0.5 rounded opacity-0 group-hover:opacity-100 text-text-tertiary hover:text-error hover:bg-error/10 transition-all"
                  title="Discard changes"
                >
                  <Undo2 size={11} />
                </button>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
