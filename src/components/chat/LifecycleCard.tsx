import React from 'react';
import { CheckSquare, Play, FileText, Eye, GitMerge } from 'lucide-react';

interface LifecycleCardProps {
  state: string;
  label: string;
}

const stateConfig: Record<string, { icon: React.ElementType; color: string }> = {
  working: { icon: Play, color: 'text-info' },
  planned: { icon: FileText, color: 'text-info' },
  ready_for_review: { icon: CheckSquare, color: 'text-success' },
  reviewing: { icon: Eye, color: 'text-warning' },
  changes_requested: { icon: Eye, color: 'text-error' },
  merged: { icon: GitMerge, color: 'text-success' },
};

export function LifecycleCard({ state, label }: LifecycleCardProps) {
  const config = stateConfig[state] ?? { icon: CheckSquare, color: 'text-text-secondary' };
  const Icon = config.icon;

  return (
    <div className="my-1.5 max-w-md">
      <div className="flex items-center gap-2 mb-1">
        <Icon size={16} className={config.color} />
        <span className="text-sm font-medium text-text-primary">{label}</span>
      </div>
      <div className="rounded-lg bg-bg-tertiary border border-border-primary px-3 py-2">
        <p className="text-xs text-text-secondary">
          Status: <span className="font-semibold text-text-primary">{state}</span>
        </p>
      </div>
    </div>
  );
}
