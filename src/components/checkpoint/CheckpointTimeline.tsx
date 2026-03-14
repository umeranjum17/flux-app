import { Clock, Eye, Undo2 } from 'lucide-react';
import type { Checkpoint } from '../../lib/ipc-api';

interface CheckpointTimelineProps {
  checkpoints: Checkpoint[];
  onViewDiff: (checkpoint: Checkpoint) => void;
  onRevert: (checkpoint: Checkpoint) => void;
}

export function CheckpointTimeline({ checkpoints, onViewDiff, onRevert }: CheckpointTimelineProps) {
  if (checkpoints.length === 0) return null;

  return (
    <div className="flex flex-col gap-0">
      {checkpoints.map((cp, idx) => (
        <div key={cp.id} className="flex items-stretch gap-2">
          {/* Timeline line */}
          <div className="flex flex-col items-center w-4 shrink-0">
            <div className={`w-0.5 flex-1 ${idx === 0 ? 'bg-transparent' : 'bg-border'}`} />
            <div className="w-2.5 h-2.5 rounded-full bg-success border-2 border-bg-primary shrink-0" />
            <div className={`w-0.5 flex-1 ${idx === checkpoints.length - 1 ? 'bg-transparent' : 'bg-border'}`} />
          </div>

          {/* Content */}
          <div className="flex items-center gap-2 py-1.5 min-w-0 flex-1">
            <div className="min-w-0 flex-1">
              <span className="text-[11px] text-text-primary font-medium">{cp.description}</span>
              <div className="flex items-center gap-2 text-[10px] text-text-tertiary">
                <span className="flex items-center gap-0.5">
                  <Clock size={9} />
                  {new Date(cp.createdAt).toLocaleTimeString()}
                </span>
                {cp.filesChanged > 0 && (
                  <span>
                    {cp.filesChanged} file{cp.filesChanged !== 1 ? 's' : ''}
                    {cp.additions > 0 && <span className="text-success ml-1">+{cp.additions}</span>}
                    {cp.deletions > 0 && <span className="text-error ml-0.5">-{cp.deletions}</span>}
                  </span>
                )}
              </div>
            </div>

            {/* Actions */}
            <button
              onClick={() => onViewDiff(cp)}
              title="View diff"
              className="p-1 rounded text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors"
            >
              <Eye size={12} />
            </button>
            <button
              onClick={() => onRevert(cp)}
              title="Revert to here"
              className="p-1 rounded text-text-tertiary hover:text-warning hover:bg-warning/10 transition-colors"
            >
              <Undo2 size={12} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
