import React from 'react';
import { CheckSquare, Play, FileText, Eye, GitMerge, Circle } from 'lucide-react';

interface LifecycleCardProps {
  state: string;
  label: string;
}

const stateConfig: Record<string, { icon: React.ElementType; accent: string; accentBg: string }> = {
  working: { icon: Play, accent: 'text-accent', accentBg: 'bg-accent/10' },
  planned: { icon: FileText, accent: 'text-info', accentBg: 'bg-info/10' },
  ready_for_review: { icon: CheckSquare, accent: 'text-success', accentBg: 'bg-success/10' },
  reviewing: { icon: Eye, accent: 'text-warning', accentBg: 'bg-warning/10' },
  changes_requested: { icon: Eye, accent: 'text-error', accentBg: 'bg-error/10' },
  merged: { icon: GitMerge, accent: 'text-success', accentBg: 'bg-success/10' },
  completed: { icon: CheckSquare, accent: 'text-success', accentBg: 'bg-success/10' },
};

const defaultConfig = { icon: Circle, accent: 'text-text-secondary', accentBg: 'bg-bg-tertiary' };

export function LifecycleCard({ state, label }: LifecycleCardProps) {
  const config = stateConfig[state] ?? defaultConfig;
  const Icon = config.icon;

  return (
    <div className="py-0.5 text-[11px] text-text-tertiary">
      <div className="flex items-center gap-1.5 leading-none">
        <span
          className={`inline-flex shrink-0 items-center justify-center rounded-full p-0.5 ${config.accentBg} ${config.accent}`}
        >
          <Icon size={11} />
        </span>
        <span className="text-text-secondary/80 font-medium">{label}</span>
      </div>
    </div>
  );
}
