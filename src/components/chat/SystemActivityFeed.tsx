import { AlertTriangle, GitBranch, GitCommitHorizontal, RefreshCw, Activity } from 'lucide-react';
import type { SystemActivity } from '../../lib/types';

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

export function SystemActivityInlineItem({ activity }: { activity: SystemActivity }) {
  const meta = CATEGORY_META[activity.category];
  const Icon = meta.Icon;
  return (
    <div className="flex items-center gap-2 px-1 py-1 text-[12px] text-text-tertiary">
      <span className={`inline-flex shrink-0 ${meta.accent}`}>
        <Icon size={13} />
      </span>
      <span className="text-text-secondary font-medium">{meta.label}</span>
      <span className="text-text-tertiary">{activity.label}</span>
      {activity.detail && (
        <span className="text-text-tertiary/70">· {activity.detail}</span>
      )}
    </div>
  );
}
