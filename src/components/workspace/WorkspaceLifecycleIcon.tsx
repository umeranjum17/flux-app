import { workspaceLifecycleConfig } from '../../lib/workspace-status';
import type { WorkspaceLifecycleState, WorkspaceListSignalState } from '../../lib/workspace-status';
import type { CSSProperties } from 'react';

type IconState = WorkspaceLifecycleState | WorkspaceListSignalState;
type IndicatorVariant = 'ring' | 'quarter' | 'half' | 'three-quarter' | 'solid' | 'core' | 'filled';

const indicatorVariantMap = {
  idle: 'ring',
  has_changes: 'quarter',
  coding: 'solid',
  planning: 'solid',
  planned: 'quarter',
  awaiting_approval: 'core',
  awaiting_input: 'core',
  ready_for_review: 'half',
  reviewing: 'half',
  changes_requested: 'core',
  ready_to_merge: 'three-quarter',
  merging: 'three-quarter',
  merged: 'filled',
  ready_to_archive: 'three-quarter',
  blocked: 'core',
  archiving: 'solid',
  archive_failed: 'core',
} satisfies Record<IconState, IndicatorVariant>;

/** Dot motion for list-only states not in workspaceLifecycleConfig. */
const dotMotionFallback: Partial<Record<WorkspaceListSignalState, string>> = {
  has_changes: 'workspace-dot-settled',
  archiving: 'workspace-dot-active',
};

/** Label + detail for list-only states not in workspaceLifecycleConfig. */
const listOnlyLabels: Partial<Record<WorkspaceListSignalState, { label: string; detail: string }>> = {
  has_changes: { label: 'Has Changes', detail: 'Workspace has unreviewed changes.' },
  archiving: { label: 'Archiving', detail: 'Workspace archive is in progress.' },
  archive_failed: { label: 'Archive Failed', detail: 'Workspace archive failed — needs attention.' },
};

/** States that need user action — show a radar-ping ring to draw attention. */
const ringStates = new Set<IconState>([
  'awaiting_approval',
  'awaiting_input',
  'changes_requested',
  'blocked',
  'archive_failed',
]);

/** Fast ring for more urgent states. */
const fastRingStates = new Set<IconState>([
  'awaiting_approval',
  'changes_requested',
  'blocked',
]);

/** Active/working states — show a spinning arc to signal ongoing work. */
const arcStates = new Set<IconState>([
  'coding',
  'planning',
  'merging',
  'archiving',
]);

interface WorkspaceLifecycleIconProps {
  state: IconState;
  size?: number;
  className?: string;
  outlined?: boolean;
}

export function WorkspaceLifecycleIcon({ state, size = 12, className = '', outlined = false }: WorkspaceLifecycleIconProps) {
  const showRing = ringStates.has(state);
  const showArc = arcStates.has(state);
  const ringClass = `workspace-dot-ring ${fastRingStates.has(state) ? 'workspace-dot-ring-fast' : ''}`;
  const config = workspaceLifecycleConfig[state as WorkspaceLifecycleState];
  const fallback = listOnlyLabels[state as WorkspaceListSignalState];
  const dotMotion = config?.dotMotionClass
    ?? dotMotionFallback[state as WorkspaceListSignalState]
    ?? 'workspace-dot-idle';
  const variant = indicatorVariantMap[state];
  const borderW = size <= 8 ? 1 : size <= 11 ? 1.05 : 1.3;
  const fillInset = size <= 8 ? 1 : size <= 11 ? 1.15 : 1.55;
  const label = config?.label ?? fallback?.label ?? state;
  const detail = config?.detail ?? fallback?.detail ?? '';
  const tooltip = `${label} — ${detail}`;
  const indicatorStyle = {
    width: size,
    height: size,
    '--workspace-indicator-shell-border': `${borderW}px`,
    '--workspace-indicator-fill-inset': `${fillInset}px`,
    '--workspace-indicator-core-inset': size <= 9 ? '33%' : size <= 11 ? '36%' : '34%',
    '--workspace-indicator-ring-border': `${size <= 8 ? 1 : size <= 11 ? 1.1 : 1.35}px`,
  } as CSSProperties;

  return (
    <span
      className={`workspace-indicator ${dotMotion} ${outlined ? 'workspace-indicator-outlined' : ''} ${className}`.trim()}
      data-state={state}
      data-indicator-variant={variant}
      style={indicatorStyle}
      role="status"
      aria-label={tooltip}
      aria-live="polite"
      title={tooltip}
    >
      <span className="workspace-indicator-shell" />
      {variant !== 'ring' && <span className="workspace-indicator-fill" />}
      {variant === 'core' && <span className="workspace-indicator-core" />}
      {showRing && <span className={ringClass} />}
      {showArc && <span className="workspace-indicator-arc" />}
    </span>
  );
}
