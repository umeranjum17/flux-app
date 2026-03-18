import React from 'react';
import { Loader2 } from 'lucide-react';

interface ActivityIndicatorProps {
  label?: string;
  active?: boolean;
  statusKind?: 'spawn' | 'startup' | 'progress' | 'diagnostic';
}

export function ActivityIndicator({
  label = 'Working...',
  active = true,
  statusKind = 'diagnostic',
}: ActivityIndicatorProps) {
  const showSpinner = active && (statusKind === 'spawn' || statusKind === 'startup');
  const showDots = active && statusKind === 'progress';
  const normalizedLabel = label.trim() === 'Agent is working...' ? 'Agent is analyzing and editing' : label;

  return (
    <div
      className="flex items-center gap-2 px-1 py-1 text-[12px] text-text-tertiary"
      data-status-kind={statusKind}
    >
      {showSpinner ? (
        <Loader2 size={13} className="shrink-0 animate-spin text-text-secondary" />
      ) : showDots ? (
        <span className="inline-flex w-6 items-center justify-center gap-[3px]" aria-hidden>
          <span className="chat-progress-dot chat-progress-dot-primary" />
          <span className="chat-progress-dot chat-progress-dot-secondary" />
          <span className="chat-progress-dot chat-progress-dot-tertiary" />
        </span>
      ) : (
        <span className="flex items-center justify-center w-5 h-5">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-text-tertiary/60" />
        </span>
      )}
      <span>{normalizedLabel}</span>
    </div>
  );
}
