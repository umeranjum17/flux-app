import React, { useState } from 'react';
import { CheckSquare, Play, FileText, Eye, GitMerge, Circle, ChevronDown, ChevronRight } from 'lucide-react';
import type { AgentMessage } from '../../lib/types';

interface LifecycleCardProps {
  state: string;
  label: string;
}

const stateConfig: Record<string, { icon: React.ElementType; accent: string; accentBg: string }> = {
  working: { icon: Play, accent: 'text-text-tertiary', accentBg: 'bg-bg-hover/50' },
  planned: { icon: FileText, accent: 'text-text-tertiary', accentBg: 'bg-bg-hover/50' },
  ready_for_review: { icon: CheckSquare, accent: 'text-text-tertiary', accentBg: 'bg-bg-hover/50' },
  reviewing: { icon: Eye, accent: 'text-text-tertiary', accentBg: 'bg-bg-hover/50' },
  changes_requested: { icon: Eye, accent: 'text-text-tertiary', accentBg: 'bg-bg-hover/50' },
  merged: { icon: GitMerge, accent: 'text-text-tertiary', accentBg: 'bg-bg-hover/50' },
  completed: { icon: CheckSquare, accent: 'text-text-tertiary', accentBg: 'bg-bg-hover/50' },
};

const defaultConfig = { icon: Circle, accent: 'text-text-tertiary', accentBg: 'bg-bg-hover/50' };

function getConfig(state: string) {
  return stateConfig[state] ?? defaultConfig;
}

export function LifecycleCard({ state, label }: LifecycleCardProps) {
  const config = getConfig(state);
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

interface LifecycleGroupProps {
  items: AgentMessage[];
  latest: AgentMessage;
}

export function LifecycleGroup({ items, latest }: LifecycleGroupProps) {
  const [expanded, setExpanded] = useState(false);
  const config = getConfig(latest.lifecycleState ?? 'unknown');
  const Icon = config.icon;
  const hiddenCount = items.length - 1;

  return (
    <div className="py-0.5 text-[11px] text-text-tertiary">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="group flex w-full items-center gap-1.5 leading-none text-left hover:text-text-secondary transition-colors"
      >
        <span className="inline-flex shrink-0 items-center justify-center rounded-full p-0.5 bg-bg-hover/50 text-text-tertiary">
          <Icon size={11} />
        </span>
        <span className="text-text-secondary/80 font-medium">
          {latest.lifecycleLabel ?? 'Lifecycle event'}
        </span>
        {hiddenCount > 0 && (
          <span className="shrink-0 rounded-full bg-bg-tertiary px-1.5 text-[10px] tabular-nums text-text-tertiary">
            +{hiddenCount}
          </span>
        )}
        <span className="ml-auto shrink-0 text-text-tertiary/70">
          {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        </span>
      </button>

      {expanded && (
        <div className="flex flex-col pl-5 ml-[7px] mt-0.5">
          {items.map((item, i) => (
            <LifecycleCard
              key={item._seqId ?? `${item.timestamp}-${i}`}
              state={item.lifecycleState ?? 'unknown'}
              label={item.lifecycleLabel ?? 'Lifecycle event'}
            />
          ))}
        </div>
      )}
    </div>
  );
}
