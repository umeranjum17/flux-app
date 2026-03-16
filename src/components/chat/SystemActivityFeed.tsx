import { Activity, AlertTriangle, GitBranch, GitCommitHorizontal, RefreshCw } from 'lucide-react';
import type { SystemActivity } from '../../lib/types';

interface SystemActivityFeedProps {
  activities: SystemActivity[];
}

const CATEGORY_META = {
  workspace: {
    Icon: GitBranch,
    accent: 'text-info',
    label: 'Workspace',
  },
  checkpoint: {
    Icon: GitCommitHorizontal,
    accent: 'text-success',
    label: 'Checkpoint',
  },
  repomap: {
    Icon: Activity,
    accent: 'text-accent',
    label: 'Repo map',
  },
  stall: {
    Icon: AlertTriangle,
    accent: 'text-warning',
    label: 'Stall',
  },
  sync: {
    Icon: RefreshCw,
    accent: 'text-text-secondary',
    label: 'Sync',
  },
} as const;

export function SystemActivityFeed({ activities }: SystemActivityFeedProps) {
  if (activities.length === 0) {
    return null;
  }

  const visibleActivities = activities.slice(-8);

  return (
    <div className="my-3 rounded-2xl border border-border/60 bg-bg-surface/55 px-4 py-3">
      <div className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-text-tertiary">
        <Activity size={12} />
        Background activity
      </div>

      <div className="space-y-2">
        {visibleActivities.map((activity) => {
          const meta = CATEGORY_META[activity.category];
          const Icon = meta.Icon;
          return (
            <div
              key={activity.id}
              className="flex items-start gap-3 rounded-xl border border-border/40 bg-bg-primary/45 px-3 py-2"
            >
              <span className={`mt-0.5 inline-flex shrink-0 ${meta.accent}`}>
                <Icon size={14} />
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] font-medium text-text-secondary">
                    {meta.label}
                  </span>
                  <span className="text-sm text-text-primary">
                    {activity.label}
                  </span>
                  <span className="text-[11px] text-text-tertiary">
                    {formatRelativeTime(activity.timestamp)}
                  </span>
                </div>

                {activity.detail && (
                  <div className="mt-0.5 text-xs text-text-tertiary">
                    {activity.detail}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function formatRelativeTime(timestamp: number): string {
  const deltaSeconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (deltaSeconds < 5) return 'just now';
  if (deltaSeconds < 60) return `${deltaSeconds}s ago`;

  const minutes = Math.floor(deltaSeconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
