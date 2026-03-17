import React from 'react';
import { CheckSquare, Play, FileText, Eye, GitMerge, Circle } from 'lucide-react';

interface LifecycleCardProps {
  state: string;
  label: string;
}

const stateConfig: Record<string, { icon: React.ElementType; color: string; bg: string }> = {
  working: { icon: Play, color: 'text-accent', bg: 'bg-accent/8' },
  planned: { icon: FileText, color: 'text-info', bg: 'bg-info/8' },
  ready_for_review: { icon: CheckSquare, color: 'text-success', bg: 'bg-success/8' },
  reviewing: { icon: Eye, color: 'text-warning', bg: 'bg-warning/8' },
  changes_requested: { icon: Eye, color: 'text-error', bg: 'bg-error/8' },
  merged: { icon: GitMerge, color: 'text-success', bg: 'bg-success/8' },
};

export function LifecycleCard({ state, label }: LifecycleCardProps) {
  const config = stateConfig[state] ?? { icon: Circle, color: 'text-text-secondary', bg: 'bg-bg-tertiary' };
  const Icon = config.icon;

  return (
    <div className={`my-2 flex items-center gap-2.5 rounded-lg ${config.bg} border border-border-primary px-3 py-2`}>
      <Icon size={15} className={config.color} />
      <span className={`text-sm font-medium ${config.color}`}>{label}</span>
    </div>
  );
}
