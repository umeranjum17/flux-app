/**
 * System-driven workspace outcome transitions.
 *
 * Agent-driven outcomes (task completion, plan completion, etc.) are handled
 * via `.context/state.json` in task-handlers. This module only handles
 * external/system events: merge detection (sync) and merge action completion
 * (task_completed_merge).
 */

import type { Workspace, WorkspaceOutcome } from './types';
import { createWorkspaceFs, type WorkspaceFs } from './workspace-fs';

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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Triggers for outcome transitions that are NOT agent-driven.
 *
 * Agent-driven outcomes (task completion, plan completion, etc.) are handled
 * via `.context/state.json` parsed in task-handlers.
 * Only external/system events use the state machine.
 */
export type WorkspaceOutcomeTrigger =
  | 'task_completed_merge'
  | 'sync';

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
 *
 * Works identically for local and remote (SSH) workspaces via WorkspaceFs.
 */
export async function resolveGitState(workspace: Workspace): Promise<WorkspaceGitState> {
  const wfs = createWorkspaceFs(workspace.host);

  let hasCommits = false;
  let hasUncommittedChanges = false;
  let isMerged = false;
  const warnings: string[] = [];

  // Pre-check: verify worktree directory exists
  if (!(await wfs.exists(workspace.worktreePath))) {
    return {
      hasCommits: false,
      hasUncommittedChanges: false,
      hasPendingChanges: false,
      isMerged: false,
      warnings: [`Worktree directory does not exist: ${workspace.worktreePath}`],
      worktreeDeleted: true,
    };
  }

  const target = await resolveTarget(wfs, workspace);

  // 1. Commits ahead of merge-base
  try {
    const { stdout: mergeBaseOut } = await wfs.git(workspace.worktreePath, ['merge-base', target, 'HEAD'], { timeout: 5000 });
    const mergeBase = mergeBaseOut.trim();
    if (mergeBase) {
      const { stdout: countOut } = await wfs.git(workspace.worktreePath, ['rev-list', '--count', `${mergeBase}..HEAD`], { timeout: 5000 });
      hasCommits = parseInt(countOut.trim(), 10) > 0;
    }
  } catch {
    try {
      const { stdout: countOut } = await wfs.git(workspace.worktreePath, ['rev-list', '--count', 'HEAD'], { timeout: 5000 });
      hasCommits = parseInt(countOut.trim(), 10) > 0;
    } catch (innerErr) {
      warnings.push(`Cannot determine commit state: ${innerErr instanceof Error ? innerErr.message : String(innerErr)}`);
    }
  }

  // 2. Uncommitted changes
  try {
    const { stdout: statusOut } = await wfs.git(workspace.worktreePath, ['status', '--porcelain'], { timeout: 5000 });
    hasUncommittedChanges = statusOut.trim().length > 0;
  } catch (err) {
    warnings.push(`Cannot determine uncommitted state: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 3. Branch merged check
  try {
    const { stdout: branchTipOut } = await wfs.git(workspace.worktreePath, ['rev-parse', 'HEAD'], { timeout: 5000 });
    const branchTip = branchTipOut.trim();

    const { stdout: mergeBaseOut } = await wfs.git(workspace.parentRepo, ['merge-base', branchTip, target], { timeout: 5000 });
    const mergeBase = mergeBaseOut.trim();

    if (branchTip !== mergeBase) {
      try {
        await wfs.git(workspace.parentRepo, ['merge-base', '--is-ancestor', branchTip, target], { timeout: 5000 });
        isMerged = true;
      } catch {
        // Check for squash merge
        try {
          const { stdout: changedFilesOut } = await wfs.git(workspace.parentRepo, ['diff', '--name-only', mergeBase, branchTip], { timeout: 5000 });
          const changedFiles = changedFilesOut.trim().split('\n').filter(Boolean);
          if (changedFiles.length > 0 && changedFiles.length <= 500) {
            await wfs.git(workspace.parentRepo, ['diff', '--quiet', branchTip, target, '--', ...changedFiles], { timeout: 10000 });
            isMerged = true;
          }
        } catch {
          // Not squash-merged either
        }
      }
    }
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
 * are handled via `.context/state.json` in task-handlers.
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
      if (current === 'in_progress' || current === 'discovery') return 'ready_for_pr';
      return null;

    case 'sync':
      // External merge detection takes priority
      if (gitState.isMerged && current !== 'merged' && current !== 'ready_to_archive') return 'merged';
      // Nudge confirmed-merged workspaces into the cleanup state
      if (current === 'merged' && gitState.isMerged) return 'ready_to_archive';
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
 * 2. Computes the next outcome (merge detection, sync only)
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

async function resolveTarget(wfs: WorkspaceFs, workspace: Workspace): Promise<string> {
  let target = workspace.baseBranch?.trim() || '';
  if (!target) {
    try {
      const { stdout } = await wfs.git(workspace.parentRepo, ['rev-parse', '--abbrev-ref', 'HEAD'], { timeout: 5000 });
      target = stdout.trim() || 'HEAD';
    } catch {
      target = 'HEAD';
    }
  }
  return target;
}
