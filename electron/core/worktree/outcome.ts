/**
 * System-driven workspace outcome transitions.
 *
 * Agent-driven outcomes (task completion, plan completion, etc.) are handled
 * via FLUX_SIGNAL outcome/completed signals in task-handlers. This module
 * only handles external/system events: merge detection (sync), merge action
 * completion (task_completed_merge), and unarchive.
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

/**
 * Triggers for outcome transitions that are NOT agent-driven.
 *
 * Agent-driven outcomes (task completion, plan completion, etc.) are handled
 * via FLUX_SIGNAL outcome/completed signals parsed in task-handlers.
 * Only external/system events use the state machine.
 */
export type WorkspaceOutcomeTrigger =
  | 'task_completed_merge'
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
        // Exit code 0 → fully merged (regular merge)
        isMerged = true;
      } catch {
        // Exit code 1 → not a regular merge. Check for squash merge:
        // if all files changed by the branch have the same content in
        // target, the branch was effectively squash-merged.
        try {
          const { stdout: changedFilesOut } = await execFileAsync(
            'git', ['diff', '--name-only', mergeBase, branchTip.trim()],
            { cwd: workspace.parentRepo, timeout: 5000 },
          );
          const changedFiles = changedFilesOut.trim().split('\n').filter(Boolean);
          if (changedFiles.length > 0 && changedFiles.length <= 500) {
            await execFileAsync(
              'git', ['diff', '--quiet', branchTip.trim(), target, '--', ...changedFiles],
              { cwd: workspace.parentRepo, timeout: 10000 },
            );
            // Exit code 0 → all branch-changed files match target → squash-merged
            isMerged = true;
          }
        } catch {
          // Diff found or command failed → not squash-merged either
        }
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

/**
 * Pure function: given the current outcome, the trigger, and the git state,
 * compute the next outcome. Returns `null` if no transition should happen.
 *
 * Only handles system/external triggers. Agent-driven outcome transitions
 * are handled via FLUX_SIGNAL in task-handlers.
 */
export function computeNextOutcome(
  current: WorkspaceOutcome,
  trigger: WorkspaceOutcomeTrigger,
  gitState: WorkspaceGitState,
): WorkspaceOutcome | null {
  switch (trigger) {
    case 'task_completed_merge':
      // Merge action — allow promotion even from terminal states (except already merged/archived)
      if (current === 'merged' || current === 'ready_to_archive') return null;
      if (gitState.isMerged) return 'merged';
      if (current === 'in_progress') return 'ready_for_pr';
      return null;

    case 'sync':
      // External merge detection takes priority
      if (gitState.isMerged && current !== 'merged' && current !== 'ready_to_archive') return 'merged';
      return null;

    case 'unarchived':
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
 * Orchestrates a system-driven outcome transition:
 * 1. Resolves git state
 * 2. Computes the next outcome (merge detection, sync, unarchive only)
 * 3. Emits if changed
 */
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
    // Skip promotion when git state had errors (stale data could false-positive merge detection)
    if (gitState.warnings.length > 0) {
      logDiagnostic('outcome', 'skipping transition due to git warnings', {
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
