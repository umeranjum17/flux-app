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
      className="premium-pill flex items-center gap-2 rounded-full px-3 py-1.5 text-xs text-text-tertiary"
      data-status-kind={statusKind}
    >
      {showSpinner ? (
        <Loader2 size={13} className="shrink-0 animate-spin text-accent" />
      ) : (
        <span className="h-2 w-2 shrink-0 rounded-full bg-text-tertiary/60" />
      )}
      <span>{label}</span>
    </div>
  );
}
