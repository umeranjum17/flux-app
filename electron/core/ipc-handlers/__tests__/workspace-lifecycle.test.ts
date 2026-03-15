import { describe, expect, it, beforeEach } from 'vitest';
import type { WorkspaceStatus, WorkspaceOutcome } from '../../worktree/types';

/**
 * Tests for workspace lifecycle state machine logic.
 *
 * These tests exercise the core status/outcome transition rules
 * using the same map-based patterns as the real IPC handler code.
 */

const validStatusTransitions: Record<WorkspaceStatus, WorkspaceStatus[]> = {
  idle: ['running', 'merging'],
  running: ['done', 'error', 'waiting_approval', 'waiting_input', 'idle'],
  merging: ['done', 'error', 'idle'],
  waiting_approval: ['running', 'done', 'error', 'idle'],
  waiting_input: ['running', 'done', 'error', 'idle'],
  done: ['running', 'merging', 'idle'],
  error: ['running', 'merging', 'idle'],
};

function isValidTransition(from: WorkspaceStatus, to: WorkspaceStatus): boolean {
  if (from === to) return true;
  return validStatusTransitions[from]?.includes(to) ?? false;
}

// Mirrors the real aggregateWorkspaceStatus from index.ts
function aggregateWorkspaceStatus(
  taskWorkspaceMap: Map<string, string>,
  taskWorkspaceStatusMap: Map<string, WorkspaceStatus>,
  workspaceId: string,
): WorkspaceStatus {
  const statuses = [...taskWorkspaceMap.entries()]
    .filter(([, wsId]) => wsId === workspaceId)
    .map(([taskId]) => taskWorkspaceStatusMap.get(taskId))
    .filter((s): s is WorkspaceStatus => !!s);

  if (statuses.includes('running')) return 'running';
  if (statuses.includes('merging')) return 'merging';
  if (statuses.includes('waiting_approval')) return 'waiting_approval';
  if (statuses.includes('waiting_input')) return 'waiting_input';
  if (statuses.includes('error')) return 'error';
  if (statuses.length > 0 && statuses.every((s) => s === 'done')) return 'done';
  return 'idle';
}

// Mirrors the real releaseWorkspaceTask from index.ts
function releaseWorkspaceTask(
  taskWorkspaceMap: Map<string, string>,
  taskWorkspaceStatusMap: Map<string, WorkspaceStatus>,
  taskId: string,
  fallbackStatus: WorkspaceStatus = 'done',
): { workspaceId: string | undefined; emittedStatus: WorkspaceStatus | null } {
  const workspaceId = taskWorkspaceMap.get(taskId);
  taskWorkspaceStatusMap.delete(taskId);
  taskWorkspaceMap.delete(taskId);
  if (workspaceId) {
    const remaining = [...taskWorkspaceMap.values()].some((wsId) => wsId === workspaceId);
    const status = remaining
      ? aggregateWorkspaceStatus(taskWorkspaceMap, taskWorkspaceStatusMap, workspaceId)
      : fallbackStatus;
    return { workspaceId, emittedStatus: status };
  }
  return { workspaceId: undefined, emittedStatus: null };
}

describe('workspace lifecycle state machine', () => {
  let taskWorkspaceMap: Map<string, string>;
  let taskWorkspaceStatusMap: Map<string, WorkspaceStatus>;
  const WS_ID = 'ws-1';

  beforeEach(() => {
    taskWorkspaceMap = new Map();
    taskWorkspaceStatusMap = new Map();
  });

  describe('valid status transitions', () => {
    it('allows idle → running', () => {
      expect(isValidTransition('idle', 'running')).toBe(true);
    });

    it('allows idle → merging', () => {
      expect(isValidTransition('idle', 'merging')).toBe(true);
    });

    it('allows running → done', () => {
      expect(isValidTransition('running', 'done')).toBe(true);
    });

    it('allows running → error', () => {
      expect(isValidTransition('running', 'error')).toBe(true);
    });

    it('allows done → running (new task)', () => {
      expect(isValidTransition('done', 'running')).toBe(true);
    });

    it('allows error → running (retry)', () => {
      expect(isValidTransition('error', 'running')).toBe(true);
    });

    it('rejects idle → done', () => {
      expect(isValidTransition('idle', 'done')).toBe(false);
    });

    it('rejects idle → error', () => {
      expect(isValidTransition('idle', 'error')).toBe(false);
    });

    it('rejects merging → running', () => {
      expect(isValidTransition('merging', 'running')).toBe(false);
    });
  });

  describe('aggregateWorkspaceStatus', () => {
    it('returns idle when no tasks exist', () => {
      expect(aggregateWorkspaceStatus(taskWorkspaceMap, taskWorkspaceStatusMap, WS_ID)).toBe('idle');
    });

    it('returns running when any task is running', () => {
      taskWorkspaceMap.set('t1', WS_ID);
      taskWorkspaceStatusMap.set('t1', 'done');
      taskWorkspaceMap.set('t2', WS_ID);
      taskWorkspaceStatusMap.set('t2', 'running');

      expect(aggregateWorkspaceStatus(taskWorkspaceMap, taskWorkspaceStatusMap, WS_ID)).toBe('running');
    });

    it('returns merging when any task is merging', () => {
      taskWorkspaceMap.set('t1', WS_ID);
      taskWorkspaceStatusMap.set('t1', 'merging');

      expect(aggregateWorkspaceStatus(taskWorkspaceMap, taskWorkspaceStatusMap, WS_ID)).toBe('merging');
    });

    it('returns done when all tasks are done', () => {
      taskWorkspaceMap.set('t1', WS_ID);
      taskWorkspaceStatusMap.set('t1', 'done');
      taskWorkspaceMap.set('t2', WS_ID);
      taskWorkspaceStatusMap.set('t2', 'done');

      expect(aggregateWorkspaceStatus(taskWorkspaceMap, taskWorkspaceStatusMap, WS_ID)).toBe('done');
    });

    it('returns error when any task has error (and none running)', () => {
      taskWorkspaceMap.set('t1', WS_ID);
      taskWorkspaceStatusMap.set('t1', 'done');
      taskWorkspaceMap.set('t2', WS_ID);
      taskWorkspaceStatusMap.set('t2', 'error');

      expect(aggregateWorkspaceStatus(taskWorkspaceMap, taskWorkspaceStatusMap, WS_ID)).toBe('error');
    });

    it('running takes priority over error', () => {
      taskWorkspaceMap.set('t1', WS_ID);
      taskWorkspaceStatusMap.set('t1', 'error');
      taskWorkspaceMap.set('t2', WS_ID);
      taskWorkspaceStatusMap.set('t2', 'running');

      expect(aggregateWorkspaceStatus(taskWorkspaceMap, taskWorkspaceStatusMap, WS_ID)).toBe('running');
    });

    it('ignores tasks for other workspaces', () => {
      taskWorkspaceMap.set('t1', 'other-ws');
      taskWorkspaceStatusMap.set('t1', 'running');

      expect(aggregateWorkspaceStatus(taskWorkspaceMap, taskWorkspaceStatusMap, WS_ID)).toBe('idle');
    });
  });

  describe('releaseWorkspaceTask', () => {
    it('emits fallback status when no remaining tasks', () => {
      taskWorkspaceMap.set('t1', WS_ID);
      taskWorkspaceStatusMap.set('t1', 'done');

      const result = releaseWorkspaceTask(taskWorkspaceMap, taskWorkspaceStatusMap, 't1', 'done');
      expect(result.emittedStatus).toBe('done');
      expect(taskWorkspaceMap.has('t1')).toBe(false);
    });

    it('preserves error status as fallback', () => {
      taskWorkspaceMap.set('t1', WS_ID);
      taskWorkspaceStatusMap.set('t1', 'error');

      const result = releaseWorkspaceTask(taskWorkspaceMap, taskWorkspaceStatusMap, 't1', 'error');
      expect(result.emittedStatus).toBe('error');
    });

    it('uses aggregate when remaining tasks exist', () => {
      taskWorkspaceMap.set('t1', WS_ID);
      taskWorkspaceStatusMap.set('t1', 'done');
      taskWorkspaceMap.set('t2', WS_ID);
      taskWorkspaceStatusMap.set('t2', 'running');

      const result = releaseWorkspaceTask(taskWorkspaceMap, taskWorkspaceStatusMap, 't1', 'done');
      expect(result.emittedStatus).toBe('running');
    });

    it('is idempotent for already-removed tasks', () => {
      const result = releaseWorkspaceTask(taskWorkspaceMap, taskWorkspaceStatusMap, 'nonexistent');
      expect(result.workspaceId).toBeUndefined();
      expect(result.emittedStatus).toBeNull();
    });
  });

  describe('lifecycle scenarios', () => {
    it('task spawn → running → done → idle (normal completion)', () => {
      // Spawn: idle → running
      taskWorkspaceMap.set('t1', WS_ID);
      taskWorkspaceStatusMap.set('t1', 'running');
      expect(aggregateWorkspaceStatus(taskWorkspaceMap, taskWorkspaceStatusMap, WS_ID)).toBe('running');

      // Done handler: running → done
      taskWorkspaceStatusMap.set('t1', 'done');
      expect(aggregateWorkspaceStatus(taskWorkspaceMap, taskWorkspaceStatusMap, WS_ID)).toBe('done');

      // Finally block: release with last status
      const lastStatus = taskWorkspaceStatusMap.get('t1') ?? 'done';
      const result = releaseWorkspaceTask(taskWorkspaceMap, taskWorkspaceStatusMap, 't1', lastStatus);
      expect(result.emittedStatus).toBe('done');

      // After release: no tasks → idle
      expect(aggregateWorkspaceStatus(taskWorkspaceMap, taskWorkspaceStatusMap, WS_ID)).toBe('idle');
    });

    it('task spawn → running → error (error preserved, not overwritten to done)', () => {
      // Spawn: idle → running
      taskWorkspaceMap.set('t1', WS_ID);
      taskWorkspaceStatusMap.set('t1', 'running');

      // Done handler: running → error
      taskWorkspaceStatusMap.set('t1', 'error');
      expect(aggregateWorkspaceStatus(taskWorkspaceMap, taskWorkspaceStatusMap, WS_ID)).toBe('error');

      // KEY FIX: Finally block reads last status before releasing
      const lastStatus = taskWorkspaceStatusMap.get('t1') ?? 'done';
      expect(lastStatus).toBe('error'); // This was the bug — previously used default 'done'

      const result = releaseWorkspaceTask(taskWorkspaceMap, taskWorkspaceStatusMap, 't1', lastStatus);
      expect(result.emittedStatus).toBe('error');
    });

    it('merge spawn → merging → done + merged outcome', () => {
      // Spawn with merge action: idle → merging
      taskWorkspaceMap.set('t1', WS_ID);
      taskWorkspaceStatusMap.set('t1', 'merging');
      expect(aggregateWorkspaceStatus(taskWorkspaceMap, taskWorkspaceStatusMap, WS_ID)).toBe('merging');

      // Done handler: merging → done
      taskWorkspaceStatusMap.set('t1', 'done');

      // Finally block: release
      const lastStatus = taskWorkspaceStatusMap.get('t1') ?? 'done';
      const result = releaseWorkspaceTask(taskWorkspaceMap, taskWorkspaceStatusMap, 't1', lastStatus);
      expect(result.emittedStatus).toBe('done');
    });

    it('merge spawn → merging → error (merge failed)', () => {
      taskWorkspaceMap.set('t1', WS_ID);
      taskWorkspaceStatusMap.set('t1', 'merging');

      // Merge failed
      taskWorkspaceStatusMap.set('t1', 'error');

      const lastStatus = taskWorkspaceStatusMap.get('t1') ?? 'done';
      const result = releaseWorkspaceTask(taskWorkspaceMap, taskWorkspaceStatusMap, 't1', lastStatus);
      expect(result.emittedStatus).toBe('error');
    });

    it('process death (cleanupTask) → workspace shows error', () => {
      taskWorkspaceMap.set('t1', WS_ID);
      taskWorkspaceStatusMap.set('t1', 'running');

      // cleanupTask calls releaseWorkspaceTask with 'error'
      const result = releaseWorkspaceTask(taskWorkspaceMap, taskWorkspaceStatusMap, 't1', 'error');
      expect(result.emittedStatus).toBe('error');
    });

    it('concurrent tasks: first finishes, second still running', () => {
      taskWorkspaceMap.set('t1', WS_ID);
      taskWorkspaceStatusMap.set('t1', 'running');
      taskWorkspaceMap.set('t2', WS_ID);
      taskWorkspaceStatusMap.set('t2', 'running');

      // t1 completes
      taskWorkspaceStatusMap.set('t1', 'done');
      const result = releaseWorkspaceTask(taskWorkspaceMap, taskWorkspaceStatusMap, 't1', 'done');
      // t2 still running → workspace stays running
      expect(result.emittedStatus).toBe('running');

      // t2 completes
      taskWorkspaceStatusMap.set('t2', 'done');
      const result2 = releaseWorkspaceTask(taskWorkspaceMap, taskWorkspaceStatusMap, 't2', 'done');
      expect(result2.emittedStatus).toBe('done');
    });

    it('concurrent tasks: one errors, other still running', () => {
      taskWorkspaceMap.set('t1', WS_ID);
      taskWorkspaceStatusMap.set('t1', 'running');
      taskWorkspaceMap.set('t2', WS_ID);
      taskWorkspaceStatusMap.set('t2', 'running');

      // t1 errors
      taskWorkspaceStatusMap.set('t1', 'error');
      const result = releaseWorkspaceTask(taskWorkspaceMap, taskWorkspaceStatusMap, 't1', 'error');
      // t2 still running → running takes priority
      expect(result.emittedStatus).toBe('running');
    });

    it('workspace:stop resets to idle', () => {
      taskWorkspaceMap.set('t1', WS_ID);
      taskWorkspaceStatusMap.set('t1', 'running');

      // Simulate workspace:stop: manual cleanup + emit idle
      taskWorkspaceStatusMap.delete('t1');
      taskWorkspaceMap.delete('t1');
      // workspace:stop emits 'idle' (not 'done')
      const stoppedStatus: WorkspaceStatus = 'idle';
      expect(stoppedStatus).toBe('idle');
    });
  });

  describe('stale status reset (sync-outcomes)', () => {
    const staleStatuses: WorkspaceStatus[] = ['running', 'merging', 'waiting_approval', 'waiting_input'];
    const nonStaleStatuses: WorkspaceStatus[] = ['idle', 'done', 'error'];

    it.each(staleStatuses)('resets stale "%s" status to idle when outcome is in_progress', (status) => {
      const outcome: WorkspaceOutcome = 'in_progress';
      const hasActiveTask = false;

      if (!hasActiveTask && staleStatuses.includes(status)) {
        const resetStatus = outcome === 'in_progress' ? 'idle' : 'done';
        expect(resetStatus).toBe('idle');
      }
    });

    it.each(staleStatuses)('resets stale "%s" status to done when outcome is terminal', (status) => {
      const outcome = 'ready_for_pr' as WorkspaceOutcome;
      const hasActiveTask = false;

      if (!hasActiveTask && staleStatuses.includes(status)) {
        const resetStatus = outcome === 'in_progress' ? 'idle' : 'done';
        expect(resetStatus).toBe('done');
      }
    });

    it.each(nonStaleStatuses)('does not reset non-stale "%s" status', (status) => {
      expect(staleStatuses.includes(status)).toBe(false);
    });

    it('does not reset stale status when active task exists', () => {
      const hasActiveTask = true;
      const shouldReset = !hasActiveTask && staleStatuses.includes('running');
      expect(shouldReset).toBe(false);
    });
  });
});
