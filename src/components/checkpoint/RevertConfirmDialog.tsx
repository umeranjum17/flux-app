import { AlertTriangle, X } from 'lucide-react';
import type { Checkpoint } from '../../lib/ipc-api';

interface RevertConfirmDialogProps {
  checkpoint: Checkpoint;
  totalCheckpoints: number;
  workspaceId: string;
  onConfirm: () => void;
  onClose: () => void;
}

export function RevertConfirmDialog({
  checkpoint,
  totalCheckpoints,
  workspaceId,
  onConfirm,
  onClose,
}: RevertConfirmDialogProps) {
  const turnsToUndo = totalCheckpoints - checkpoint.messageIndex;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-full max-w-sm bg-bg-primary border border-border rounded-xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} className="text-warning" />
            <h2 className="text-sm font-semibold text-text-primary">Revert to Checkpoint</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-bg-hover text-text-tertiary"
            title="Close revert dialog"
            aria-label="Close revert dialog"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-3">
          <p className="text-xs text-text-secondary">
            This will revert the workspace to <span className="font-medium text-text-primary">"{checkpoint.description}"</span>.
          </p>
          {turnsToUndo > 0 && (
            <p className="text-xs text-warning">
              {turnsToUndo} subsequent turn{turnsToUndo !== 1 ? 's' : ''} will be lost. This action cannot be undone.
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs rounded-lg text-text-secondary hover:bg-bg-hover transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-1.5 text-xs font-medium rounded-lg bg-warning text-white hover:bg-warning/90 transition-colors"
          >
            Revert
          </button>
        </div>
      </div>
    </div>
  );
}
