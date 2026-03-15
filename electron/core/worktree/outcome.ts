/**
 * Centralized workspace outcome state machine.
 *
 * All outcome transitions go through `transitionWorkspaceOutcome` which:
 * 1. Resolves the current git state of the workspace
 * 2. Computes the next outcome via a pure transition function
 * 3. Emits the outcome only if it changed
 *
 * This eliminates the scattered, inconsistent outcome-setting logic that
 * previously lived in 7 different call sites with different guard sets.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';

import { logDiagnostic } from '../diagnostics/logger';
import type { Workspace, WorkspaceOutcome } from './types';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WorkspaceOutcomeTrigger =
  | 'task_completed'
  | 'task_completed_merge'
  | 'task_error'
  | 'agent_stopped'
  | 'sync'
  | 'unarchived';

export interface WorkspaceGitState {
  hasCommits: boolean;
  hasUncommittedChanges: boolean;
  hasPendingChanges: boolean;
  isMerged: boolean;
}

// ---------------------------------------------------------------------------
// Git state resolution
// ---------------------------------------------------------------------------

/**
 * Query git to determine the workspace's current state: whether it has
 * commits, uncommitted changes, and whether the branch has been merged.
 */
export async function resolveGitState(workspace: Workspace): Promise<WorkspaceGitState> {
  let hasCommits = false;
  let hasUncommittedChanges = false;
  let isMerged = false;

  const target = await resolveTarget(workspace);

  // 1. Commits ahead of merge-base
  try {
    const { stdout: mergeBaseOut } = await execFileAsync(
      'git', ['merge-base', target, 'HEAD'],
      { cwd: workspace.worktreePath, timeout: 5000 },
    );
    const mergeBase = mergeBaseOut.trim();

    if (mergeBase) {
      const { stdout: countOut } = await execFileAsync(
        'git', ['rev-list', '--count', `${mergeBase}..HEAD`],
        { cwd: workspace.worktreePath, timeout: 5000 },
      );
      hasCommits = parseInt(countOut.trim(), 10) > 0;
    }
  } catch {
    // Fallback: simple rev-list count
    try {
      const { stdout: countOut } = await execFileAsync(
        'git', ['rev-list', '--count', 'HEAD'],
        { cwd: workspace.worktreePath, timeout: 5000 },
      );
      hasCommits = parseInt(countOut.trim(), 10) > 0;
    } catch {
      // Cannot determine commit state
    }
  }

  // 2. Uncommitted changes
  try {
    const { stdout: statusOut } = await execFileAsync(
      'git', ['status', '--porcelain'],
      { cwd: workspace.worktreePath, timeout: 5000 },
    );
    hasUncommittedChanges = statusOut.trim().length > 0;
  } catch {
    // Cannot determine uncommitted state
  }

  // 3. Branch merged check
  try {
    const { stdout: branchTip } = await execFileAsync(
      'git', ['rev-parse', 'HEAD'],
      { cwd: workspace.worktreePath, timeout: 5000 },
    );

    // Find the merge-base between branch tip and target
    const { stdout: mergeBaseOut } = await execFileAsync(
      'git', ['merge-base', branchTip.trim(), target],
      { cwd: workspace.parentRepo, timeout: 5000 },
    );
    const mergeBase = mergeBaseOut.trim();

    // If the branch tip IS the merge base, the branch never diverged — not "merged"
    if (branchTip.trim() !== mergeBase) {
      // The branch has diverged. Now check if it's been merged back.
      try {
        await execFileAsync(
          'git', ['merge-base', '--is-ancestor', branchTip.trim(), target],
          { cwd: workspace.parentRepo, timeout: 5000 },
        );
        // Exit code 0 → fully merged
        isMerged = true;
      } catch {
        // Exit code 1 → not merged
      }
    }
    // else: branch tip === merge base → never diverged → not merged
  } catch {
    // Cannot determine merge state
  }

  return {
    hasCommits,
    hasUncommittedChanges,
    hasPendingChanges: hasCommits || hasUncommittedChanges,
    isMerged,
  };
}

// ---------------------------------------------------------------------------
// Pure transition function
// ---------------------------------------------------------------------------

/** Terminal outcomes that cannot be changed by automated triggers. */
const TERMINAL_OUTCOMES = new Set<WorkspaceOutcome>(['merged', 'ready_to_merge', 'ready_to_archive']);

/**
 * Pure function: given the current outcome, the trigger, and the git state,
 * compute the next outcome. Returns `null` if no transition should happen.
 */
export function computeNextOutcome(
  current: WorkspaceOutcome,
  trigger: WorkspaceOutcomeTrigger,
  gitState: WorkspaceGitState,
): WorkspaceOutcome | null {
  // Terminal outcomes block all automated triggers
  if (TERMINAL_OUTCOMES.has(current)) {
    return null;
  }

  switch (trigger) {
    case 'task_completed':
      if (current === 'in_progress' && gitState.hasCommits) return 'ready_for_pr';
      if (current === 'ready_for_pr' && gitState.isMerged) return 'merged';
      return null;

    case 'task_completed_merge':
      if (gitState.isMerged) return 'merged';
      // Merge task completed but branch not actually merged — at least it has changes
      return 'ready_for_pr';

    case 'task_error':
      // Errors don't promote outcomes
      return null;

    case 'agent_stopped':
      if (current === 'in_progress' && gitState.hasCommits) return 'ready_for_pr';
      return null;

    case 'sync':
      // Merged check takes priority
      if (gitState.isMerged) return 'merged';
      if (current === 'in_progress' && gitState.hasPendingChanges) return 'ready_for_pr';
      if (current === 'ready_for_pr' && !gitState.hasPendingChanges) return 'in_progress';
      return null;

    case 'unarchived':
      // After unarchive, sync to current git state
      if (gitState.isMerged) return 'merged';
      return null;

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export type EmitOutcomeFn = (workspaceId: string, outcome: WorkspaceOutcome) => void;

/**
 * Orchestrates a workspace outcome transition:
 * 1. Resolves git state
 * 2. Computes the next outcome
 * 3. Emits if changed
 */
export async function transitionWorkspaceOutcome(
  workspace: Workspace,
  trigger: WorkspaceOutcomeTrigger,
  emitFn: EmitOutcomeFn,
): Promise<void> {
  const gitState = await resolveGitState(workspace);
  const next = computeNextOutcome(workspace.outcome, trigger, gitState);
  if (next !== null && next !== workspace.outcome) {
    logDiagnostic('outcome', 'workspace outcome transition', { workspaceId: workspace.id, trigger, from: workspace.outcome, to: next });
    emitFn(workspace.id, next);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function resolveTarget(workspace: Workspace): Promise<string> {
  let target = workspace.baseBranch?.trim() || '';
  if (!target) {
    try {
      const { stdout: parentBranch } = await execFileAsync(
        'git', ['rev-parse', '--abbrev-ref', 'HEAD'],
        { cwd: workspace.parentRepo, timeout: 5000 },
      );
      target = parentBranch.trim() || 'HEAD';
    } catch {
      target = 'HEAD';
    }
  }
  return target;
}
