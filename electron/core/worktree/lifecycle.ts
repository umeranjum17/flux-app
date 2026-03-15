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

import type { Workspace, WorkspaceOutcome, WorkspaceStatus } from './types';
import { resolveGitState, computeNextOutcome } from './outcome';
import type { WorkspaceOutcomeTrigger } from './outcome';
import type { WorkspaceStore } from './store';

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

  /** Set outcome directly, with optional force to override terminal outcomes. */
  setOutcome(workspaceId: string, outcome: WorkspaceOutcome, opts?: { force?: boolean }): void {
    const current = this.workspaceStore.get(workspaceId)?.outcome;
    if (current === outcome && !opts?.force) return;
    if (opts?.force) {
      getLogDiagnostic()('outcome', 'forced outcome override', { workspaceId, from: current, to: outcome });
    }
    console.log(`[outcome] ${workspaceId}: ${current} → ${outcome}`);
    this.workspaceStore.update(workspaceId, { outcome });
    this.sendToRenderer('workspace:outcome', { workspaceId, outcome });
  }

  /** Transition outcome via the state machine (resolves git state, computes next). */
  async transitionOutcome(workspace: Workspace, trigger: WorkspaceOutcomeTrigger): Promise<void> {
    const gitState = await resolveGitState(workspace);
    const next = computeNextOutcome(workspace.outcome, trigger, gitState);
    if (next !== null && next !== workspace.outcome) {
      getLogDiagnostic()('outcome', 'workspace outcome transition', {
        workspaceId: workspace.id,
        trigger,
        from: workspace.outcome,
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
        console.warn(`[workspace] Invalid status transition: ${from} → ${status} for workspace ${workspaceId}`);
      }
    }
    this.workspaceStore.update(workspaceId, {
      status,
      ...(extra?.sessionId ? { sessionId: extra.sessionId } : {}),
    });
    this.sendToRenderer('workspace:status', { workspaceId, status });
  }
}
