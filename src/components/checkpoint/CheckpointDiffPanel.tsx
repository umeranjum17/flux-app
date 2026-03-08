import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import type { Checkpoint } from '../../lib/ipc-api';
import { DiffViewer } from '../common/DiffViewer';

interface CheckpointDiffPanelProps {
  checkpoint: Checkpoint;
  workspaceId: string;
  onClose: () => void;
}

export function CheckpointDiffPanel({ checkpoint, workspaceId, onClose }: CheckpointDiffPanelProps) {
  const [diff, setDiff] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    window.api.invoke('checkpoint:diff', { checkpointId: checkpoint.id, workspaceId })
      .then((result: unknown) => setDiff(result as string))
      .catch(() => setDiff(null))
      .finally(() => setLoading(false));
  }, [checkpoint.id, workspaceId]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-full max-w-4xl max-h-[80vh] bg-bg-primary border border-border rounded-xl shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
          <div>
            <h3 className="text-sm font-semibold text-text-primary">{checkpoint.description}</h3>
            <p className="text-[11px] text-text-tertiary">
              {checkpoint.filesChanged} file{checkpoint.filesChanged !== 1 ? 's' : ''} changed
              {checkpoint.additions > 0 && <span className="text-success ml-1">+{checkpoint.additions}</span>}
              {checkpoint.deletions > 0 && <span className="text-error ml-1">-{checkpoint.deletions}</span>}
            </p>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-bg-hover text-text-tertiary">
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-4">
          {loading && <p className="text-xs text-text-tertiary text-center py-8">Loading diff...</p>}
          {!loading && !diff && <p className="text-xs text-text-tertiary text-center py-8">No changes in this checkpoint</p>}
          {!loading && diff && (
            <DiffViewer oldValue="" newValue={diff} fileName="Changes" />
          )}
        </div>
      </div>
    </div>
  );
}
