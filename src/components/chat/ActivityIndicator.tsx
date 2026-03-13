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
  const showSpinner = active && statusKind !== 'diagnostic';

  return (
    <div
      className="flex items-center gap-2.5 rounded-lg bg-bg-surface/60 border border-border-subtle/50 px-3 py-2 text-[12px] text-text-tertiary"
      data-status-kind={statusKind}
    >
      {showSpinner ? (
        <Loader2 size={12} className="shrink-0 animate-spin text-accent" />
      ) : (
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-text-tertiary/50" />
      )}
      <span className="truncate">{label}</span>
    </div>
  );
}
