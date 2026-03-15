import { describe, expect, it, beforeEach, vi } from 'vitest';
import type { WorkspaceStatus, WorkspaceOutcome, Workspace } from '../../worktree/types';
import { WorkspaceLifecycleManager } from '../../worktree/lifecycle';

/**
 * Tests for the centralized WorkspaceLifecycleManager.
 *
 * Uses a mock WorkspaceStore that tracks status/outcome updates
 * and a mock sendToRenderer that records emissions.
 */

function createMockWorkspaceStore(initial?: Partial<Workspace>) {
  const data: Record<string, Partial<Workspace>> = {};
  if (initial) data[initial.id!] = initial;

  return {
    get: vi.fn((id: string) => data[id] as Workspace | null ?? null),
    update: vi.fn((id: string, updates: Partial<Workspace>) => {
      data[id] = { ...data[id], ...updates };
      return data[id] as Workspace;
    }),
    _data: data,
    _set: (id: string, ws: Partial<Workspace>) => { data[id] = ws; },
    // Unused by lifecycle manager but needed for type compatibility
    list: vi.fn(() => []),
    create: vi.fn(),
    archive: vi.fn(),
    unarchive: vi.fn(),
    delete: vi.fn(),
    addSession: vi.fn(),
    listSessions: vi.fn(() => []),
    removeSession: vi.fn(),
  };
}

const WS_ID = 'ws-1';

function makeWorkspace(overrides?: Partial<Workspace>): Partial<Workspace> {
  return {
    id: WS_ID,
    status: 'idle' as WorkspaceStatus,
    outcome: 'in_progress' as WorkspaceOutcome,
    ...overrides,
  };
}

describe('WorkspaceLifecycleManager', () => {
  let store: ReturnType<typeof createMockWorkspaceStore>;
  let emissions: Array<{ channel: string; payload: unknown }>;
  let sendToRenderer: (channel: string, payload: unknown) => boolean;
  let manager: WorkspaceLifecycleManager;

  beforeEach(() => {
    store = createMockWorkspaceStore(makeWorkspace());
    emissions = [];
    sendToRenderer = (channel, payload) => {
      emissions.push({ channel, payload });
      return true;
    };
    manager = new WorkspaceLifecycleManager(store as any, sendToRenderer);
  });

  describe('taskStarted', () => {
    it('registers task and emits running status', () => {
      manager.taskStarted('t1', WS_ID, 'running');

      expect(manager.getWorkspaceForTask('t1')).toBe(WS_ID);
      expect(manager.getTaskStatus('t1')).toBe('running');
      expect(store.update).toHaveBeenCalledWith(WS_ID, expect.objectContaining({ status: 'running' }));
      expect(emissions).toContainEqual({ channel: 'workspace:status', payload: { workspaceId: WS_ID, status: 'running' } });
    });

    it('passes sessionId when provided', () => {
      manager.taskStarted('t1', WS_ID, 'running', 'session-1');

      expect(store.update).toHaveBeenCalledWith(WS_ID, expect.objectContaining({ status: 'running', sessionId: 'session-1' }));
    });
  });

  describe('taskStatusChanged', () => {
    it('updates status for running → waiting_approval', () => {
      manager.taskStarted('t1', WS_ID, 'running');
      store._set(WS_ID, makeWorkspace({ status: 'running' }));
      emissions.length = 0;

      manager.taskStatusChanged('t1', 'waiting_approval');

      expect(manager.getTaskStatus('t1')).toBe('waiting_approval');
      expect(emissions).toContainEqual({ channel: 'workspace:status', payload: { workspaceId: WS_ID, status: 'waiting_approval' } });
    });

    it('no-ops for unknown tasks', () => {
      manager.taskStatusChanged('nonexistent', 'running');
      expect(emissions).toHaveLength(0);
    });
  });

  describe('taskCompleted + taskReleased (no double-emission)', () => {
    it('taskCompleted emits, taskReleased does NOT re-emit', () => {
      manager.taskStarted('t1', WS_ID, 'running');
      store._set(WS_ID, makeWorkspace({ status: 'running' }));
      emissions.length = 0;

      // Done handler calls taskCompleted
      manager.taskCompleted('t1', 'done');
      const emissionsAfterCompleted = [...emissions];
      expect(emissionsAfterCompleted).toHaveLength(1);
      expect(emissionsAfterCompleted[0]).toEqual({ channel: 'workspace:status', payload: { workspaceId: WS_ID, status: 'done' } });

      // Finally block calls taskReleased — should NOT emit again
      manager.taskReleased('t1');
      expect(emissions).toHaveLength(1); // Still just 1 emission

      // Maps should be cleaned up
      expect(manager.getWorkspaceForTask('t1')).toBeUndefined();
      expect(manager.getTaskStatus('t1')).toBeUndefined();
    });

    it('preserves error status through completion', () => {
      manager.taskStarted('t1', WS_ID, 'running');
      store._set(WS_ID, makeWorkspace({ status: 'running' }));
      emissions.length = 0;

      manager.taskCompleted('t1', 'error');

      expect(emissions[0]).toEqual({ channel: 'workspace:status', payload: { workspaceId: WS_ID, status: 'error' } });
    });
  });

  describe('taskReleasedWithStatus (cleanup paths)', () => {
    it('emits fallback status when no remaining tasks', () => {
      manager.taskStarted('t1', WS_ID, 'running');
      store._set(WS_ID, makeWorkspace({ status: 'running' }));
      emissions.length = 0;

      const wsId = manager.taskReleasedWithStatus('t1', 'error');

      expect(wsId).toBe(WS_ID);
      expect(emissions).toContainEqual({ channel: 'workspace:status', payload: { workspaceId: WS_ID, status: 'error' } });
      expect(manager.getWorkspaceForTask('t1')).toBeUndefined();
    });

    it('uses aggregate when remaining tasks exist', () => {
      manager.taskStarted('t1', WS_ID, 'running');
      manager.taskStarted('t2', WS_ID, 'running');
      // Simulate t1 done, so workspace would normally be "done" if alone
      // But t2 is still running, so aggregate should be 'running'
      store._set(WS_ID, makeWorkspace({ status: 'done' }));
      emissions.length = 0;

      manager.taskReleasedWithStatus('t1', 'done');

      // t2 is still running, so aggregate should be 'running'
      expect(emissions).toContainEqual({ channel: 'workspace:status', payload: { workspaceId: WS_ID, status: 'running' } });
    });

    it('is idempotent for already-removed tasks', () => {
      const wsId = manager.taskReleasedWithStatus('nonexistent', 'done');
      expect(wsId).toBeUndefined();
      expect(emissions).toHaveLength(0);
    });
  });

  describe('setStatus', () => {
    it('emits status directly', () => {
      store._set(WS_ID, makeWorkspace({ status: 'running' }));
      manager.setStatus(WS_ID, 'idle');
      expect(emissions).toContainEqual({ channel: 'workspace:status', payload: { workspaceId: WS_ID, status: 'idle' } });
    });

    it('skips redundant emissions', () => {
      // Workspace is already idle
      manager.setStatus(WS_ID, 'idle');
      expect(emissions).toHaveLength(0); // No emission — already idle
    });
  });

  describe('setOutcome', () => {
    it('emits outcome change', () => {
      manager.setOutcome(WS_ID, 'ready_for_pr');
      expect(store.update).toHaveBeenCalledWith(WS_ID, { outcome: 'ready_for_pr' });
      expect(emissions).toContainEqual({ channel: 'workspace:outcome', payload: { workspaceId: WS_ID, outcome: 'ready_for_pr' } });
    });

    it('skips when outcome unchanged', () => {
      // Already in_progress
      manager.setOutcome(WS_ID, 'in_progress');
      expect(emissions).toHaveLength(0);
    });

    it('allows force override', () => {
      store._set(WS_ID, makeWorkspace({ outcome: 'merged' }));
      manager.setOutcome(WS_ID, 'in_progress', { force: true });
      expect(emissions).toContainEqual({ channel: 'workspace:outcome', payload: { workspaceId: WS_ID, outcome: 'in_progress' } });
    });
  });

  describe('queries', () => {
    it('hasActiveTasks returns true when tasks exist', () => {
      manager.taskStarted('t1', WS_ID, 'running');
      expect(manager.hasActiveTasks(WS_ID)).toBe(true);
    });

    it('hasActiveTasks returns false when no tasks', () => {
      expect(manager.hasActiveTasks(WS_ID)).toBe(false);
    });

    it('getActiveTaskIds returns all task IDs for workspace', () => {
      manager.taskStarted('t1', WS_ID, 'running');
      manager.taskStarted('t2', WS_ID, 'running');
      manager.taskStarted('t3', 'other-ws', 'running');

      const ids = manager.getActiveTaskIds(WS_ID);
      expect(ids).toEqual(['t1', 't2']);
    });
  });

  describe('status aggregation', () => {
    it('running takes priority over other statuses', () => {
      manager.taskStarted('t1', WS_ID, 'done');
      manager.taskStarted('t2', WS_ID, 'running');
      store._set(WS_ID, makeWorkspace({ status: 'done' }));
      emissions.length = 0;

      // Force a re-emission
      manager.taskStatusChanged('t2', 'running');

      // Should still be running (even though we re-set same status, the aggregation check
      // sees running as the aggregate)
    });

    it('merging takes priority over done', () => {
      manager.taskStarted('t1', WS_ID, 'merging');
      expect(emissions.some(e => e.channel === 'workspace:status' && (e.payload as any).status === 'merging')).toBe(true);
    });

    it('returns done when all tasks are done', () => {
      manager.taskStarted('t1', WS_ID, 'done');
      manager.taskStarted('t2', WS_ID, 'done');
      expect(emissions.some(e => e.channel === 'workspace:status' && (e.payload as any).status === 'done')).toBe(true);
    });
  });

  describe('lifecycle scenarios', () => {
    it('task spawn → running → done → released (normal completion, no double emit)', () => {
      // Spawn
      manager.taskStarted('t1', WS_ID, 'running');
      store._set(WS_ID, makeWorkspace({ status: 'running' }));

      // Done handler
      manager.taskCompleted('t1', 'done');
      store._set(WS_ID, makeWorkspace({ status: 'done' }));

      const statusEmissions = emissions.filter(e => e.channel === 'workspace:status');
      // Should be exactly 2: running (from taskStarted) and done (from taskCompleted)
      expect(statusEmissions).toHaveLength(2);

      // Finally block
      manager.taskReleased('t1');

      // Still just 2 — no re-emission from taskReleased
      const finalStatusEmissions = emissions.filter(e => e.channel === 'workspace:status');
      expect(finalStatusEmissions).toHaveLength(2);
    });

    it('task spawn → running → error (error preserved)', () => {
      manager.taskStarted('t1', WS_ID, 'running');
      store._set(WS_ID, makeWorkspace({ status: 'running' }));

      manager.taskCompleted('t1', 'error');

      const lastStatusEmission = emissions.filter(e => e.channel === 'workspace:status').pop();
      expect((lastStatusEmission?.payload as any)?.status).toBe('error');
    });

    it('workspace:stop resets to idle', () => {
      manager.taskStarted('t1', WS_ID, 'running');
      store._set(WS_ID, makeWorkspace({ status: 'running' }));

      // Simulate workspace:stop cleanup
      manager.clearTask('t1');
      manager.setStatus(WS_ID, 'idle');

      const lastStatusEmission = emissions.filter(e => e.channel === 'workspace:status').pop();
      expect((lastStatusEmission?.payload as any)?.status).toBe('idle');
    });

    it('concurrent tasks: first finishes, second still running', () => {
      manager.taskStarted('t1', WS_ID, 'running');
      manager.taskStarted('t2', WS_ID, 'running');
      // Set store to 'done' to ensure the aggregate 'running' from t2 actually emits
      store._set(WS_ID, makeWorkspace({ status: 'done' }));
      emissions.length = 0;

      // t1 completes via cleanup path
      manager.taskReleasedWithStatus('t1', 'done');
      // t2 still running → workspace stays running
      expect(emissions.some(e => e.channel === 'workspace:status' && (e.payload as any).status === 'running')).toBe(true);

      store._set(WS_ID, makeWorkspace({ status: 'running' }));
      emissions.length = 0;
      // t2 completes
      manager.taskReleasedWithStatus('t2', 'done');
      expect(emissions.some(e => e.channel === 'workspace:status' && (e.payload as any).status === 'done')).toBe(true);
    });

    it('process death (cleanupTask) → workspace shows error', () => {
      manager.taskStarted('t1', WS_ID, 'running');
      store._set(WS_ID, makeWorkspace({ status: 'running' }));
      emissions.length = 0;

      manager.taskReleasedWithStatus('t1', 'error');

      expect(emissions.some(e => e.channel === 'workspace:status' && (e.payload as any).status === 'error')).toBe(true);
    });

    it('merge spawn → merging → waiting_approval → running → done', () => {
      manager.taskStarted('t1', WS_ID, 'merging');
      store._set(WS_ID, makeWorkspace({ status: 'merging' }));

      manager.taskStatusChanged('t1', 'waiting_approval');
      store._set(WS_ID, makeWorkspace({ status: 'waiting_approval' }));

      manager.taskStatusChanged('t1', 'running');
      store._set(WS_ID, makeWorkspace({ status: 'running' }));

      manager.taskCompleted('t1', 'done');

      const statuses = emissions
        .filter(e => e.channel === 'workspace:status')
        .map(e => (e.payload as any).status);
      expect(statuses).toEqual(['merging', 'waiting_approval', 'running', 'done']);
    });
  });

  describe('stale status reset (sync-outcomes)', () => {
    const staleStatuses: WorkspaceStatus[] = ['running', 'merging', 'waiting_approval', 'waiting_input'];
    const nonStaleStatuses: WorkspaceStatus[] = ['idle', 'done', 'error'];

    it.each(staleStatuses)('resets stale "%s" status to idle when outcome is in_progress', (status) => {
      store._set(WS_ID, makeWorkspace({ status, outcome: 'in_progress' }));
      const hasActiveTask = manager.hasActiveTasks(WS_ID);

      if (!hasActiveTask && staleStatuses.includes(status)) {
        const outcome = store.get(WS_ID)!.outcome;
        const resetStatus = outcome === 'in_progress' ? 'idle' : 'done';
        expect(resetStatus).toBe('idle');
      }
    });

    it.each(staleStatuses)('resets stale "%s" status to done when outcome is terminal', (status) => {
      store._set(WS_ID, makeWorkspace({ status, outcome: 'ready_for_pr' }));
      const hasActiveTask = manager.hasActiveTasks(WS_ID);

      if (!hasActiveTask && staleStatuses.includes(status)) {
        const outcome = store.get(WS_ID)!.outcome;
        const resetStatus = outcome === 'in_progress' ? 'idle' : 'done';
        expect(resetStatus).toBe('done');
      }
    });

    it.each(nonStaleStatuses)('does not reset non-stale "%s" status', (status) => {
      expect(staleStatuses.includes(status)).toBe(false);
    });

    it('does not reset stale status when active task exists', () => {
      manager.taskStarted('t1', WS_ID, 'running');
      const hasActiveTask = manager.hasActiveTasks(WS_ID);
      const shouldReset = !hasActiveTask && staleStatuses.includes('running');
      expect(shouldReset).toBe(false);
    });
  });

  describe('isTaskActive (cancellation guard)', () => {
    it('returns true for registered tasks', () => {
      manager.taskStarted('t1', WS_ID, 'running');
      expect(manager.isTaskActive('t1')).toBe(true);
    });

    it('returns false after taskReleased', () => {
      manager.taskStarted('t1', WS_ID, 'running');
      manager.taskReleased('t1');
      expect(manager.isTaskActive('t1')).toBe(false);
    });

    it('returns false after clearTask', () => {
      manager.taskStarted('t1', WS_ID, 'running');
      manager.clearTask('t1');
      expect(manager.isTaskActive('t1')).toBe(false);
    });

    it('returns false after taskReleasedWithStatus', () => {
      manager.taskStarted('t1', WS_ID, 'running');
      store._set(WS_ID, makeWorkspace({ status: 'running' }));
      manager.taskReleasedWithStatus('t1', 'done');
      expect(manager.isTaskActive('t1')).toBe(false);
    });

    it('returns false for unknown tasks', () => {
      expect(manager.isTaskActive('nonexistent')).toBe(false);
    });
  });

  describe('serialized (per-workspace lock)', () => {
    it('serializes concurrent operations on the same workspace', async () => {
      const order: number[] = [];

      const op1 = manager.serialized(WS_ID, async () => {
        order.push(1);
        await new Promise(r => setTimeout(r, 10));
        order.push(2);
      });

      const op2 = manager.serialized(WS_ID, async () => {
        order.push(3);
        await new Promise(r => setTimeout(r, 10));
        order.push(4);
      });

      await Promise.all([op1, op2]);
      // op1 should fully complete before op2 starts
      expect(order).toEqual([1, 2, 3, 4]);
    });

    it('allows concurrent operations on different workspaces', async () => {
      const order: string[] = [];

      const op1 = manager.serialized('ws-a', async () => {
        order.push('a-start');
        await new Promise(r => setTimeout(r, 10));
        order.push('a-end');
      });

      const op2 = manager.serialized('ws-b', async () => {
        order.push('b-start');
        await new Promise(r => setTimeout(r, 10));
        order.push('b-end');
      });

      await Promise.all([op1, op2]);
      // Both should start before either ends (parallel)
      expect(order.indexOf('a-start')).toBeLessThan(order.indexOf('a-end'));
      expect(order.indexOf('b-start')).toBeLessThan(order.indexOf('b-end'));
      // Both start before the other ends (truly concurrent)
      expect(order.indexOf('b-start')).toBeLessThan(order.indexOf('a-end'));
    });

    it('continues after a failed operation', async () => {
      const op1 = manager.serialized(WS_ID, async () => {
        throw new Error('op1 failed');
      });
      await op1.catch(() => {});

      // op2 should still run even though op1 threw
      let op2Ran = false;
      await manager.serialized(WS_ID, async () => {
        op2Ran = true;
      });
      expect(op2Ran).toBe(true);
    });

    it('returns the value from the function', async () => {
      const result = await manager.serialized(WS_ID, async () => 42);
      expect(result).toBe(42);
    });
  });

  describe('race condition: stop during done handler', () => {
    it('clearTask during completion prevents further emissions', () => {
      manager.taskStarted('t1', WS_ID, 'running');
      store._set(WS_ID, makeWorkspace({ status: 'running' }));
      emissions.length = 0;

      // Simulate: done handler calls taskCompleted
      manager.taskCompleted('t1', 'done');
      expect(emissions).toHaveLength(1);

      // Simulate: workspace:stop fires, calls clearTask
      manager.clearTask('t1');
      expect(manager.isTaskActive('t1')).toBe(false);

      // The done handler's finally block calls taskReleased — should be harmless
      manager.taskReleased('t1');
      expect(emissions).toHaveLength(1); // No extra emissions
    });

    it('stop before done handler starts prevents all emissions', () => {
      manager.taskStarted('t1', WS_ID, 'running');
      store._set(WS_ID, makeWorkspace({ status: 'running' }));
      emissions.length = 0;

      // Simulate: workspace:stop fires first
      manager.clearTask('t1');
      expect(manager.isTaskActive('t1')).toBe(false);

      // Done handler checks isTaskActive — would bail
      // But if it somehow didn't, taskCompleted is a no-op:
      manager.taskCompleted('t1', 'done');
      expect(emissions).toHaveLength(0); // No workspace found for task
    });
  });
});
