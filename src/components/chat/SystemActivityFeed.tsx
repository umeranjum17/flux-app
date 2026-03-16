import { useState } from 'react';
import { AlertTriangle, ArrowRightLeft, GitBranch, GitCommitHorizontal, RefreshCw, Activity, ChevronDown, Sparkles } from 'lucide-react';
import type { SystemActivity } from '../../lib/types';

const CATEGORY_META: Record<
  SystemActivity['category'],
  { Icon: React.ComponentType<{ size?: number; className?: string }>; accent: string; accentBg: string; label: string }
> = {
  workspace: {
    Icon: GitBranch,
    accent: 'text-info',
    accentBg: 'bg-info/10',
    label: 'Workspace',
  },
  checkpoint: {
    Icon: GitCommitHorizontal,
    accent: 'text-success',
    accentBg: 'bg-success/10',
    label: 'Checkpoint',
  },
  repomap: {
    Icon: Activity,
    accent: 'text-accent',
    accentBg: 'bg-accent/10',
    label: 'Repo map',
  },
  stall: {
    Icon: AlertTriangle,
    accent: 'text-warning',
    accentBg: 'bg-warning/10',
    label: 'Stall',
  },
  sync: {
    Icon: RefreshCw,
    accent: 'text-text-secondary',
    accentBg: 'bg-bg-tertiary',
    label: 'Sync',
  },
  ipc: {
    Icon: ArrowRightLeft,
    accent: 'text-text-tertiary',
    accentBg: 'bg-bg-tertiary',
    label: 'IPC',
  },
  skill: {
    Icon: Sparkles,
    accent: 'text-accent',
    accentBg: 'bg-accent/10',
    label: 'Skill',
  },
};

function formatRelativeTime(timestamp: number): string {
  const delta = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (delta < 5) return 'just now';
  if (delta < 60) return `${delta}s ago`;
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  return `${Math.floor(delta / 3600)}h ago`;
}

export function SystemActivityInlineItem({ activity }: { activity: SystemActivity }) {
  const meta = CATEGORY_META[activity.category];
  const Icon = meta.Icon;
  return (
    <div className="py-0.5 text-[11px] text-text-tertiary">
      <div className="flex items-center gap-1.5 leading-none">
        <span
          className={`inline-flex shrink-0 items-center justify-center rounded-full p-0.5 ${meta.accentBg} ${meta.accent}`}
        >
          <Icon size={11} />
        </span>
        <span className="text-text-secondary/80 font-medium">{activity.label}</span>
        {activity.detail && (
          <span className="text-text-tertiary/60 truncate">· {activity.detail}</span>
        )}
        <span className="ml-auto shrink-0 tabular-nums text-text-tertiary/40 text-[10px]">
          {formatRelativeTime(activity.timestamp)}
        </span>
      </div>
    </div>
  );
}

/** Minimum group size before collapsing. Groups smaller than this render individually. */
const COLLAPSE_THRESHOLD = 2;

/**
 * Groups consecutive activities of the same category into an expandable block.
 * When collapsed shows only the latest event plus a count badge.
 */
export function SystemActivityGroup({ activities }: { activities: SystemActivity[] }) {
  const [expanded, setExpanded] = useState(false);

  if (activities.length === 0) return null;

  // For small groups, render each item individually
  if (activities.length < COLLAPSE_THRESHOLD) {
    return (
      <div className="flex flex-col">
        {activities.map((a) => (
          <SystemActivityInlineItem key={a.id} activity={a} />
        ))}
      </div>
    );
  }

  const latest = activities[activities.length - 1];
  const meta = CATEGORY_META[latest.category];
  const Icon = meta.Icon;
  const hiddenCount = activities.length - 1;

  if (expanded) {
    return (
      <div className="flex flex-col">
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="flex items-center gap-1.5 py-0.5 text-[11px] leading-none text-text-tertiary hover:text-text-secondary transition-colors"
        >
          <span
            className={`inline-flex shrink-0 items-center justify-center rounded-full p-0.5 ${meta.accentBg} ${meta.accent}`}
          >
            <Icon size={11} />
          </span>
          <span className="font-medium text-text-secondary/80">{meta.label}</span>
          <span className="rounded-full bg-bg-tertiary px-1.5 text-[10px] tabular-nums text-text-tertiary">
            {activities.length}
          </span>
          <ChevronDown size={10} className="ml-auto rotate-180 transition-transform" />
        </button>
        <div className="flex flex-col pl-5 ml-[7px]">
          {activities.map((a) => (
            <SystemActivityInlineItem key={a.id} activity={a} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setExpanded(true)}
      className="group flex items-center gap-1.5 py-0.5 text-[11px] leading-none text-text-tertiary hover:text-text-secondary transition-colors w-full text-left"
    >
      <span
        className={`inline-flex shrink-0 items-center justify-center rounded-full p-0.5 ${meta.accentBg} ${meta.accent}`}
      >
        <Icon size={11} />
      </span>
      <span className="text-text-secondary/80 font-medium">{latest.label}</span>
      {latest.detail && (
        <span className="text-text-tertiary/60 truncate">· {latest.detail}</span>
      )}
      <span className="shrink-0 rounded-full bg-bg-tertiary px-1.5 text-[10px] tabular-nums text-text-tertiary">
        +{hiddenCount}
      </span>
      <ChevronDown size={10} className="ml-auto shrink-0 opacity-0 group-hover:opacity-60 transition-opacity" />
    </button>
  );
}

/** Categories hidden from the activity feed — too noisy for end users. */
const HIDDEN_CATEGORIES = new Set<SystemActivity['category']>(['ipc', 'sync']);

export function groupActivitiesByCategory(activities: SystemActivity[]): SystemActivity[][] {
  const visible = activities.filter((a) => !HIDDEN_CATEGORIES.has(a.category));
  if (visible.length === 0) return [];

  const groups: SystemActivity[][] = [];
  let currentGroup: SystemActivity[] = [visible[0]];

  for (let i = 1; i < visible.length; i++) {
    if (visible[i].category === currentGroup[0].category) {
      currentGroup.push(visible[i]);
    } else {
      groups.push(currentGroup);
      currentGroup = [visible[i]];
    }
  }
  groups.push(currentGroup);
  return groups;
}
