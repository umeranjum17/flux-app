/**
 * Centralized workspace lifecycle manager.
 *
 * Single owner of all workspace status and outcome mutations.
 * Provides:
 * - Per-workspace async serialization to prevent race conditions
 * - isTaskActive() guard for done-handler cancellation
 * - Aggregated multi-task status
 * - Deduplication of emissions
 */

import fs from 'fs';

import type { Workspace, WorkspaceOutcome, WorkspaceStatus } from './types';
import { resolveGitState, computeNextOutcome } from './outcome';
import type { WorkspaceOutcomeTrigger } from './outcome';
import type { WorkspaceStore } from './store';

// ---------------------------------------------------------------------------
// Valid outcome transitions
// ---------------------------------------------------------------------------

const validOutcomeTransitions: Record<WorkspaceOutcome, WorkspaceOutcome[]> = {
  in_progress: ['planned', 'ready_for_pr'],
  planned: ['in_progress', 'ready_for_pr'],
  ready_for_pr: ['reviewing', 'in_progress', 'ready_to_merge', 'merged'],
  reviewing: ['changes_requested', 'ready_to_merge', 'merged'],
  changes_requested: ['in_progress', 'ready_for_pr', 'reviewing'],
  ready_to_merge: ['merged', 'in_progress'],
  merged: ['ready_to_archive'],
  ready_to_archive: [],
};

// Lazy-load logDiagnostic to avoid importing 'electron' in test environments
let _logDiagnostic: typeof import('../diagnostics/logger').logDiagnostic | undefined;
function getLogDiagnostic() {
  if (!_logDiagnostic) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      _logDiagnostic = require('../diagnostics/logger').logDiagnostic;
    } catch {
      _logDiagnostic = (() => {}) as any;
    }
  }
  return _logDiagnostic!;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SendToRendererFn = (channel: string, payload: unknown) => boolean;

// ---------------------------------------------------------------------------
// Valid status transitions
// ---------------------------------------------------------------------------

const validStatusTransitions: Record<WorkspaceStatus, WorkspaceStatus[]> = {
  idle: ['running', 'merging'],
  running: ['done', 'error', 'waiting_approval', 'waiting_input', 'idle'],
  merging: ['done', 'error', 'idle', 'waiting_approval', 'waiting_input', 'running'],
  waiting_approval: ['running', 'done', 'error', 'idle'],
  waiting_input: ['running', 'done', 'error', 'idle'],
  done: ['running', 'merging', 'idle'],
  error: ['running', 'merging', 'idle'],
};

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

export class WorkspaceLifecycleManager {
  private readonly taskWorkspaceMap = new Map<string, string>();
  private readonly taskWorkspaceStatusMap = new Map<string, WorkspaceStatus>();

  /** Per-workspace async lock chain. Prevents race conditions between
   *  concurrent operations (stop, done handler, archive, sync) on the
   *  same workspace. */
  private readonly _locks = new Map<string, Promise<void>>();

  constructor(
    private readonly workspaceStore: WorkspaceStore,
    private readonly sendToRenderer: SendToRendererFn,
  ) {}

  // -----------------------------------------------------------------------
  // Per-workspace serialization
  // -----------------------------------------------------------------------

  /**
   * Serialize async operations on a workspace. All workspace-level
   * operations (stop, archive, sync-outcomes) should go through this
   * to prevent interleaving.
   *
   * The done handler should NOT use this — it uses isTaskActive() guards
   * instead so that stop can interrupt it immediately.
   */
  async serialized<T>(workspaceId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this._locks.get(workspaceId) ?? Promise.resolve();
    let resolve!: () => void;
    const next = new Promise<void>(r => { resolve = r; });
    this._locks.set(workspaceId, next);
    await prev;
    try {
      return await fn();
    } finally {
      resolve();
      // Clean up if no one else queued behind us
      if (this._locks.get(workspaceId) === next) {
        this._locks.delete(workspaceId);
      }
    }
  }

  // -----------------------------------------------------------------------
  // Startup reconciliation
  // -----------------------------------------------------------------------

  /**
   * Self-heal workspace state on app startup. Must run in the main process
   * BEFORE accepting renderer connections.
   *
   * Phase 1: Reset impossible statuses (running/merging/waiting_* with no
   *          active task) — synchronous, immediate.
   * Phase 2: Sync outcomes from git — async, best-effort per workspace.
   */
  async reconcileOnStartup(): Promise<void> {
    // Phase 0: Kill orphaned agent processes from a previous crash
    try {
      const { killOrphanedAgents } = await import('../agents/pid-tracker');
      killOrphanedAgents();
    } catch (err) {
      console.warn('[lifecycle:reconcile] Failed to kill orphaned agents:', err);
    }

    const allWorkspaces = this.workspaceStore.list();

    const activeStatuses: WorkspaceStatus[] = ['running', 'merging', 'waiting_approval', 'waiting_input'];

    // Phase 1: Reset impossible statuses (no tasks survive a restart)
    for (const ws of allWorkspaces) {
      if (activeStatuses.includes(ws.status)) {
        const resetStatus = ws.outcome === 'in_progress' ? 'idle' : 'done';
        console.log(`[lifecycle:reconcile] ${ws.id}: status ${ws.status} → ${resetStatus} (no active task)`);
        this.workspaceStore.update(ws.id, { status: resetStatus });
      }
    }

    // Phase 2: Sync outcomes from git (async, best-effort per workspace)
    await Promise.allSettled(
      allWorkspaces
        .filter(ws => !ws.archivedAt)
        .map(ws => this.serialized(ws.id, async () => {
          try {
            const fresh = this.workspaceStore.get(ws.id);
            if (!fresh) return;

            // Validate worktree directory exists on disk
            if (!fs.existsSync(fresh.worktreePath)) {
              console.warn(`[lifecycle:reconcile] Worktree missing for ${ws.id}: ${fresh.worktreePath}`);
              if (fresh.outcome === 'in_progress') {
                // No commits and worktree gone — auto-archive
                console.log(`[lifecycle:reconcile] Auto-archiving ${ws.id} (worktree deleted, no commits)`);
                this.workspaceStore.archive(ws.id);
                this.sendToRenderer('workspace:archived', { workspaceId: ws.id });
              }
              // For higher outcomes (ready_for_pr, etc.) the branch may
              // still exist in git — log but don't touch the outcome
              return;
            }

            await this.transitionOutcome(fresh, 'sync');
          } catch (err) {
            console.warn(`[lifecycle:reconcile] Failed to sync outcome for ${ws.id}:`, err);
          }
        }))
    );

    // Phase 3: Detect and log stale workspaces (>14 days inactive)
    const STALE_THRESHOLD_MS = 14 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const staleWorkspaces = allWorkspaces.filter(ws =>
      !ws.archivedAt &&
      (now - (ws.updatedAt || ws.createdAt)) > STALE_THRESHOLD_MS
    );
    if (staleWorkspaces.length > 0) {
      console.log(
        `[lifecycle:reconcile] ${staleWorkspaces.length} stale workspace(s) detected:`,
        staleWorkspaces.map(ws => `${ws.name} (${Math.round((now - ws.updatedAt) / (24 * 60 * 60 * 1000))}d idle)`).join(', '),
      );
    }

    // Phase 4: Git worktree prune to clean up dead references
    const parentRepos = new Set(allWorkspaces.map(ws => ws.parentRepo));
    for (const repo of parentRepos) {
      try {
        const { execFile: execFileCb } = await import('child_process');
        const { promisify: promisifyFn } = await import('util');
        const execFileAsync = promisifyFn(execFileCb);
        await execFileAsync('git', ['worktree', 'prune'], { cwd: repo, timeout: 10000 });
      } catch {
        // Best-effort cleanup
      }
    }
  }

  // -----------------------------------------------------------------------
  // Task lifecycle
  // -----------------------------------------------------------------------

  /** Register a new task and emit the aggregated workspace status. */
  taskStarted(
    taskId: string,
    workspaceId: string,
    status: WorkspaceStatus,
    sessionId?: string,
  ): void {
    this.taskWorkspaceMap.set(taskId, workspaceId);
    this.taskWorkspaceStatusMap.set(taskId, status);
    this.emitAggregatedStatus(workspaceId, { sessionId });
  }

  /** Update a running task's status (e.g. running↔waiting). */
  taskStatusChanged(
    taskId: string,
    status: WorkspaceStatus,
    extra?: { sessionId?: string },
  ): void {
    const workspaceId = this.taskWorkspaceMap.get(taskId);
    if (!workspaceId) return;
    this.taskWorkspaceStatusMap.set(taskId, status);
    this.emitAggregatedStatus(workspaceId, extra);
  }

  /**
   * Mark a task as completed. Sets the per-task status AND emits the
   * aggregated workspace status in one atomic operation. Does NOT clean
   * up the maps — call `taskReleased` for that (typically in a finally block).
   */
  taskCompleted(taskId: string, finalStatus: WorkspaceStatus, extra?: { sessionId?: string }): void {
    const workspaceId = this.taskWorkspaceMap.get(taskId);
    if (!workspaceId) return;
    this.taskWorkspaceStatusMap.set(taskId, finalStatus);
    this.emitAggregatedStatus(workspaceId, extra);
  }

  /**
   * Clean up task maps. Does NOT re-emit status — the done handler already
   * called taskCompleted() which emitted the correct status. This prevents
   * the double-emission bug where the finally block re-emits after done.
   */
  taskReleased(taskId: string): void {
    this.taskWorkspaceStatusMap.delete(taskId);
    this.taskWorkspaceMap.delete(taskId);
  }

  /**
   * Clean up task maps AND emit the resulting status.
   * Used by cleanup paths (stall monitor, task:stop) that don't go
   * through the normal done→taskCompleted flow.
   */
  taskReleasedWithStatus(taskId: string, fallbackStatus: WorkspaceStatus): string | undefined {
    const workspaceId = this.taskWorkspaceMap.get(taskId);
    this.taskWorkspaceStatusMap.delete(taskId);
    this.taskWorkspaceMap.delete(taskId);
    if (workspaceId) {
      const remaining = this.hasActiveTasks(workspaceId);
      const status = remaining ? this.aggregateStatus(workspaceId) : fallbackStatus;
      this.emitStatus(workspaceId, status);
    }
    return workspaceId;
  }

  // -----------------------------------------------------------------------
  // Direct status control
  // -----------------------------------------------------------------------

  /** Set workspace status directly (used by stop, archive, sync). */
  setStatus(workspaceId: string, status: WorkspaceStatus, extra?: { sessionId?: string }): void {
    this.emitStatus(workspaceId, status, extra);
  }

  // -----------------------------------------------------------------------
  // Outcome control
  // -----------------------------------------------------------------------

  /** Set outcome directly, with optional force to override transition enforcement. */
  setOutcome(workspaceId: string, outcome: WorkspaceOutcome, opts?: { force?: boolean }): void {
    const current = this.workspaceStore.get(workspaceId)?.outcome;
    if (current === outcome && !opts?.force) return;

    if (opts?.force) {
      getLogDiagnostic()('outcome', 'forced outcome override', { workspaceId, from: current, to: outcome });
    } else if (current && !validOutcomeTransitions[current]?.includes(outcome)) {
      console.error(`[outcome] Blocked invalid outcome transition: ${current} → ${outcome} for ${workspaceId}`);
      return;
    }

    console.log(`[outcome] ${workspaceId}: ${current} → ${outcome}`);
    this.workspaceStore.update(workspaceId, { outcome });
    this.sendToRenderer('workspace:outcome', { workspaceId, outcome });
  }

  /**
   * Transition outcome via the system state machine (merge detection, sync, unarchive).
   * Agent-driven outcomes are handled via FLUX_SIGNAL in task-handlers.
   */
  async transitionOutcome(workspace: Workspace, trigger: WorkspaceOutcomeTrigger): Promise<void> {
    const gitState = await resolveGitState(workspace);

    if (gitState.warnings.length > 0) {
      for (const w of gitState.warnings) {
        getLogDiagnostic()('outcome', 'git state warning', { workspaceId: workspace.id, warning: w });
      }
    }

    // Re-read current outcome from DB — it may have changed during git ops
    const fresh = this.workspaceStore.get(workspace.id);
    if (!fresh) return;

    const next = computeNextOutcome(fresh.outcome, trigger, gitState);
    if (next !== null && next !== fresh.outcome) {
      // Skip transitions when git state had errors (stale data protection)
      if (gitState.warnings.length > 0) {
        getLogDiagnostic()('outcome', 'skipping transition due to git warnings', {
          workspaceId: workspace.id, trigger, from: fresh.outcome, to: next,
          warnings: gitState.warnings,
        });
        return;
      }

      getLogDiagnostic()('outcome', 'workspace outcome transition', {
        workspaceId: workspace.id,
        trigger,
        from: fresh.outcome,
        to: next,
      });
      this.setOutcome(workspace.id, next);
    }
  }

  // -----------------------------------------------------------------------
  // Queries
  // -----------------------------------------------------------------------

  /**
   * Returns true if the task is still registered in the lifecycle manager.
   * Used as a cancellation guard by the done handler — if workspace:stop
   * or task:stop already cleaned up this task, returns false.
   */
  isTaskActive(taskId: string): boolean {
    return this.taskWorkspaceMap.has(taskId);
  }

  getTaskStatus(taskId: string): WorkspaceStatus | undefined {
    return this.taskWorkspaceStatusMap.get(taskId);
  }

  getWorkspaceForTask(taskId: string): string | undefined {
    return this.taskWorkspaceMap.get(taskId);
  }

  hasActiveTasks(workspaceId: string): boolean {
    for (const wsId of this.taskWorkspaceMap.values()) {
      if (wsId === workspaceId) return true;
    }
    return false;
  }

  getActiveTaskIds(workspaceId: string): string[] {
    const ids: string[] = [];
    for (const [taskId, wsId] of this.taskWorkspaceMap.entries()) {
      if (wsId === workspaceId) ids.push(taskId);
    }
    return ids;
  }

  /** Remove task entries from maps without any emission. Used for raw cleanup. */
  clearTask(taskId: string): void {
    this.taskWorkspaceStatusMap.delete(taskId);
    this.taskWorkspaceMap.delete(taskId);
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  private aggregateStatus(workspaceId: string): WorkspaceStatus {
    const statuses = [...this.taskWorkspaceMap.entries()]
      .filter(([, wsId]) => wsId === workspaceId)
      .map(([taskId]) => this.taskWorkspaceStatusMap.get(taskId))
      .filter((s): s is WorkspaceStatus => !!s);

    if (statuses.includes('running')) return 'running';
    if (statuses.includes('merging')) return 'merging';
    if (statuses.includes('waiting_approval')) return 'waiting_approval';
    if (statuses.includes('waiting_input')) return 'waiting_input';
    if (statuses.includes('error')) return 'error';
    if (statuses.length > 0 && statuses.every((s) => s === 'done')) return 'done';
    return 'idle';
  }

  private emitAggregatedStatus(workspaceId: string, extra?: { sessionId?: string }): void {
    const status = this.aggregateStatus(workspaceId);
    this.emitStatus(workspaceId, status, extra);
  }

  private emitStatus(workspaceId: string, status: WorkspaceStatus, extra?: { sessionId?: string }): void {
    const ws = this.workspaceStore.get(workspaceId);
    if (ws) {
      const from = ws.status;
      if (from === status && !extra?.sessionId) {
        // No-op: skip redundant status emissions
        return;
      }
      if (from !== status && !validStatusTransitions[from]?.includes(status)) {
        console.error(`[workspace] Blocked invalid status transition: ${from} → ${status} for ${workspaceId}`);
        return; // Don't corrupt the DB
      }
    }
    this.workspaceStore.update(workspaceId, {
      status,
      ...(extra?.sessionId ? { sessionId: extra.sessionId } : {}),
    });
    this.sendToRenderer('workspace:status', { workspaceId, status });
  }
}
