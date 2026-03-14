import { FilePlus, FileEdit, FileX, FileSymlink } from 'lucide-react';
import type { DiffFile } from '../../lib/ipc-api';

const statusIcons: Record<DiffFile['status'], React.ReactNode> = {
  added: <FilePlus size={13} className="text-success" />,
  modified: <FileEdit size={13} className="text-warning" />,
  deleted: <FileX size={13} className="text-error" />,
  renamed: <FileSymlink size={13} className="text-info" />,
};

interface FileChangelistProps {
  files: DiffFile[];
  selectedFile: string | null;
  onSelect: (path: string) => void;
  onDiscard?: (path: string) => void;
}

export function FileChangelist({ files, selectedFile, onSelect, onDiscard }: FileChangelistProps) {
  if (files.length === 0) {
    return (
      <div className="px-3 py-6 text-center text-xs text-text-tertiary">
        No changes detected
      </div>
    );
  }

  const totalAdded = files.reduce((sum, f) => sum + f.additions, 0);
  const totalDeleted = files.reduce((sum, f) => sum + f.deletions, 0);

  return (
    <div className="flex flex-col h-full">
      {/* Summary */}
      <div className="px-3 py-2 border-b border-border text-[11px] text-text-tertiary">
        <span>{files.length} file{files.length !== 1 ? 's' : ''} changed</span>
        {totalAdded > 0 && <span className="text-success ml-2">+{totalAdded}</span>}
        {totalDeleted > 0 && <span className="text-error ml-1">-{totalDeleted}</span>}
      </div>

      {/* File list */}
      <div className="flex-1 overflow-y-auto">
        {files.map((file) => (
          <button
            key={file.path}
            onClick={() => onSelect(file.path)}
            className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-colors ${
              file.path === selectedFile
                ? 'bg-bg-hover text-text-primary'
                : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
            }`}
          >
            {statusIcons[file.status]}
            <span className="truncate flex-1 text-left font-mono">{file.path}</span>
            <span className="flex items-center gap-1 shrink-0 text-[10px]">
              {file.additions > 0 && <span className="text-success">+{file.additions}</span>}
              {file.deletions > 0 && <span className="text-error">-{file.deletions}</span>}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
