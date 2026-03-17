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

import fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';

import type { Workspace, WorkspaceOutcome } from './types';

// Lazy-load logDiagnostic to avoid importing 'electron' in test environments
let _logDiagnostic: typeof import('../diagnostics/logger').logDiagnostic | undefined;
function logDiagnostic(...args: Parameters<typeof import('../diagnostics/logger').logDiagnostic>) {
  if (!_logDiagnostic) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      _logDiagnostic = require('../diagnostics/logger').logDiagnostic;
    } catch {
      _logDiagnostic = (() => {}) as any;
    }
  }
  _logDiagnostic!(...args);
}

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WorkspaceOutcomeTrigger =
  | 'task_completed'
  | 'plan_completed'
  | 'task_completed_merge'
  | 'task_error'
  | 'agent_stopped'
  | 'agent_signal_ready_for_review'
  | 'sync'
  | 'unarchived';

export interface WorkspaceGitState {
  hasCommits: boolean;
  hasUncommittedChanges: boolean;
  hasPendingChanges: boolean;
  isMerged: boolean;
  /** Warnings from git commands that failed during state resolution. */
  warnings: string[];
  /** True if the worktree directory does not exist on disk. */
  worktreeDeleted?: boolean;
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
  const warnings: string[] = [];

  // Pre-check: verify worktree directory exists
  if (!fs.existsSync(workspace.worktreePath)) {
    return {
      hasCommits: false,
      hasUncommittedChanges: false,
      hasPendingChanges: false,
      isMerged: false,
      warnings: [`Worktree directory does not exist: ${workspace.worktreePath}`],
      worktreeDeleted: true,
    };
  }

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
  } catch (err) {
    // Fallback: simple rev-list count
    try {
      const { stdout: countOut } = await execFileAsync(
        'git', ['rev-list', '--count', 'HEAD'],
        { cwd: workspace.worktreePath, timeout: 5000 },
      );
      hasCommits = parseInt(countOut.trim(), 10) > 0;
    } catch (innerErr) {
      warnings.push(`Cannot determine commit state: ${innerErr instanceof Error ? innerErr.message : String(innerErr)}`);
    }
  }

  // 2. Uncommitted changes
  try {
    const { stdout: statusOut } = await execFileAsync(
      'git', ['status', '--porcelain'],
      { cwd: workspace.worktreePath, timeout: 5000 },
    );
    hasUncommittedChanges = statusOut.trim().length > 0;
  } catch (err) {
    warnings.push(`Cannot determine uncommitted state: ${err instanceof Error ? err.message : String(err)}`);
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
        // Exit code 1 → not merged (expected, not a warning)
      }
    }
    // else: branch tip === merge base → never diverged → not merged
  } catch (err) {
    warnings.push(`Cannot determine merge state: ${err instanceof Error ? err.message : String(err)}`);
  }

  return {
    hasCommits,
    hasUncommittedChanges,
    hasPendingChanges: hasCommits || hasUncommittedChanges,
    isMerged,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Pure transition function
// ---------------------------------------------------------------------------

/** Terminal outcomes that cannot be changed by automated triggers. */
const TERMINAL_OUTCOMES = new Set<WorkspaceOutcome>(['merged', 'ready_to_merge', 'ready_to_archive', 'reviewing']);

/**
 * Pure function: given the current outcome, the trigger, and the git state,
 * compute the next outcome. Returns `null` if no transition should happen.
 */
export function computeNextOutcome(
  current: WorkspaceOutcome,
  trigger: WorkspaceOutcomeTrigger,
  gitState: WorkspaceGitState,
): WorkspaceOutcome | null {
  // task_completed_merge represents an actual merge operation — allow it to
  // promote ready_to_merge → merged even though ready_to_merge is normally
  // terminal.  Without this, agent-assisted merges that start from
  // ready_to_merge (the common case) would silently fail to advance.
  if (trigger === 'task_completed_merge') {
    if (current === 'merged' || current === 'ready_to_archive') return null;
    if (gitState.isMerged) return 'merged';
    // Merge task completed but branch not actually merged yet — promote to
    // ready_for_pr only if it's an upgrade (don't demote ready_to_merge).
    if (current === 'in_progress') return 'ready_for_pr';
    return null;
  }

  // Terminal outcomes block all other automated triggers
  if (TERMINAL_OUTCOMES.has(current)) {
    return null;
  }

  switch (trigger) {
    case 'plan_completed':
      if (current === 'in_progress') return 'planned';
      return null;

    case 'task_completed':
      if (current === 'in_progress' && gitState.hasCommits) return 'ready_for_pr';
      if (current === 'planned' && gitState.hasCommits) return 'ready_for_pr';
      if (current === 'changes_requested' && gitState.hasCommits) return 'ready_for_pr';
      if (current === 'ready_for_pr' && gitState.isMerged) return 'merged';
      return null;

    case 'agent_signal_ready_for_review':
      if (current === 'in_progress' && gitState.hasCommits) return 'ready_for_pr';
      if (current === 'changes_requested' && gitState.hasCommits) return 'ready_for_pr';
      return null;

    case 'task_error':
      // Errors don't promote outcomes
      return null;

    case 'agent_stopped':
      if (current === 'in_progress' && gitState.hasCommits) return 'ready_for_pr';
      if (current === 'changes_requested' && gitState.hasCommits) return 'ready_for_pr';
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
/** Outcomes ranked by progression — used to detect demotions. */
const OUTCOME_RANK: Record<WorkspaceOutcome, number> = {
  in_progress: 0,
  planned: 1,
  ready_for_pr: 2,
  reviewing: 3,
  changes_requested: 3,
  ready_to_merge: 4,
  merged: 5,
  ready_to_archive: 6,
};

export async function transitionWorkspaceOutcome(
  workspace: Workspace,
  trigger: WorkspaceOutcomeTrigger,
  emitFn: EmitOutcomeFn,
): Promise<void> {
  const gitState = await resolveGitState(workspace);

  if (gitState.warnings.length > 0) {
    for (const w of gitState.warnings) {
      logDiagnostic('outcome', 'git state warning', { workspaceId: workspace.id, warning: w });
    }
  }

  const next = computeNextOutcome(workspace.outcome, trigger, gitState);
  if (next !== null && next !== workspace.outcome) {
    // Guard: skip demotions when git state had errors (could be stale data)
    if (gitState.warnings.length > 0 && OUTCOME_RANK[next] < OUTCOME_RANK[workspace.outcome]) {
      logDiagnostic('outcome', 'skipping demotion due to git warnings', {
        workspaceId: workspace.id, trigger, from: workspace.outcome, to: next,
        warnings: gitState.warnings,
      });
      return;
    }

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
