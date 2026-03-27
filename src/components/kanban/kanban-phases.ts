import type { WorkspaceLifecycleState } from '../../lib/workspace-status';
import type { WorkspaceOutcome } from '../../lib/ipc-api';

/** Action triggered when a card is dropped into a column. */
export type KanbanDropAction = 'discover' | 'plan' | 'code' | 'review' | 'merge';

/** Defines a Kanban column mapped to a group of lifecycle states. */
export interface KanbanPhaseGroup {
  id: string;
  label: string;
  /** Lifecycle states that belong to this column */
  states: WorkspaceLifecycleState[];
  /** The outcome to set when a card is dropped into this column (for non-action drops) */
  dropOutcome: WorkspaceOutcome;
  /** Action triggered on drop — requires spawning a task or opening a dialog */
  dropAction?: KanbanDropAction;
  accentColor: string;
  badgeClass: string;
}

export const KANBAN_PHASES: KanbanPhaseGroup[] = [
  {
    id: 'discovery',
    label: 'Discovery',
    states: ['discovering', 'discovered'],
    dropOutcome: 'discovered',
    dropAction: 'discover',
    accentColor: 'bg-warning',
    badgeClass: 'bg-warning/12 text-warning',
  },
  {
    id: 'planning',
    label: 'Planning',
    states: ['planning', 'planned'],
    dropOutcome: 'planned',
    dropAction: 'plan',
    accentColor: 'bg-plan',
    badgeClass: 'bg-plan/12 text-plan',
  },
  {
    id: 'in-progress',
    label: 'In Progress',
    states: ['idle', 'coding', 'awaiting_approval', 'awaiting_input', 'blocked'],
    dropOutcome: 'in_progress',
    dropAction: 'code',
    accentColor: 'bg-info',
    badgeClass: 'bg-info/12 text-info',
  },
  {
    id: 'review',
    label: 'Review',
    states: ['ready_for_review', 'reviewing', 'changes_requested'],
    dropOutcome: 'ready_for_pr',
    dropAction: 'review',
    accentColor: 'bg-accent',
    badgeClass: 'bg-accent/12 text-accent',
  },
  {
    id: 'ready-to-merge',
    label: 'Ready to Merge',
    states: ['ready_to_merge'],
    dropOutcome: 'ready_to_merge',
    accentColor: 'bg-success',
    badgeClass: 'bg-success/12 text-success',
  },
  {
    id: 'done',
    label: 'Done',
    states: ['merging', 'merged', 'ready_to_archive'],
    dropOutcome: 'merged',
    dropAction: 'merge',
    accentColor: 'bg-success/70',
    badgeClass: 'bg-success/12 text-success',
  },
];

/** Client-side outcome transition map (mirrors lifecycle.ts on main process). */
export const validOutcomeTransitions: Record<WorkspaceOutcome, WorkspaceOutcome[]> = {
  in_progress: ['discovered', 'planned', 'ready_for_pr'],
  discovered: ['in_progress', 'planned'],
  planned: ['discovered', 'in_progress', 'ready_for_pr'],
  ready_for_pr: ['reviewing', 'in_progress', 'ready_to_merge', 'merged'],
  reviewing: ['changes_requested', 'ready_to_merge', 'merged'],
  changes_requested: ['in_progress', 'ready_for_pr', 'reviewing'],
  ready_to_merge: ['merged', 'in_progress'],
  merged: ['ready_to_archive'],
  ready_to_archive: [],
};

/**
 * Checks if a drop from one column to another is allowed.
 * Action-based drops (discover, plan, code, merge) are allowed as long as
 * the workspace isn't already in the target column.
 * Outcome-only drops follow the strict transition map.
 */
export function isDropAllowed(
  currentOutcome: WorkspaceOutcome,
  targetPhase: KanbanPhaseGroup,
): boolean {
  // Action-based drops bypass strict outcome transitions — the action itself
  // will handle the state change by spawning a task or opening a dialog.
  if (targetPhase.dropAction) return true;

  // Pure outcome drops must follow the transition map
  const targetOutcome = targetPhase.dropOutcome;
  if (currentOutcome === targetOutcome) return false;
  return validOutcomeTransitions[currentOutcome]?.includes(targetOutcome) ?? false;
}

/** Find which phase group a workspace belongs to based on its lifecycle state. */
export function getPhaseForLifecycleState(state: WorkspaceLifecycleState): KanbanPhaseGroup | undefined {
  return KANBAN_PHASES.find((phase) => phase.states.includes(state));
}
