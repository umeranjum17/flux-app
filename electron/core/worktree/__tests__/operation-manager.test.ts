import { describe, expect, it } from 'vitest';

import { WorkspaceOperationManager } from '../operation-manager';
import type { Workspace } from '../types';

function createWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: 'ws-1',
    name: 'Workspace',
    parentRepo: '/repo',
    worktreePath: '/repo/.flux/ws-1',
    branch: 'flux/ws-1',
    agentId: 'claude-code' as Workspace['agentId'],
    model: 'claude-sonnet-4.5',
    mode: 'act',
    status: 'idle',
    outcome: 'in_progress',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('WorkspaceOperationManager', () => {
  it('emits queued, progress, and completed archive snapshots', async () => {
    const emissions: Array<{ channel: string; payload: unknown }> = [];
    const manager = new WorkspaceOperationManager((channel, payload) => {
      emissions.push({ channel, payload });
      return true;
    });

    manager.start({
      workspace: createWorkspace(),
      kind: 'archive',
      initialMessage: 'Queueing archive',
      run: async ({ update }) => {
        update({
          stage: 'removing_git_worktree',
          progress: 0.55,
          message: 'Removing git worktree',
        });
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    const snapshots = emissions
      .filter((entry) => entry.channel === 'workspace:operation')
      .map((entry) => entry.payload as { stage: string; status: string; progress: number });

    expect(snapshots.map((snapshot) => snapshot.stage)).toEqual([
      'queued',
      'removing_git_worktree',
      'completed',
    ]);
    expect(snapshots.at(-1)).toMatchObject({
      status: 'completed',
      progress: 1,
    });
  });

  it('cancels a running operation', async () => {
    const emissions: Array<{ channel: string; payload: unknown }> = [];
    const manager = new WorkspaceOperationManager((channel, payload) => {
      emissions.push({ channel, payload });
      return true;
    });

    const operation = manager.start({
      workspace: createWorkspace(),
      kind: 'archive',
      initialMessage: 'Queueing archive',
      run: async ({ signal, update }) => {
        update({
          stage: 'removing_git_worktree',
          progress: 0.55,
          message: 'Removing git worktree',
        });
        await new Promise<void>((resolve, reject) => {
          signal.addEventListener('abort', () => {
            const error = new Error('Workspace cleanup cancelled');
            error.name = 'AbortError';
            reject(error);
          }, { once: true });
        });
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    manager.cancel(operation.id);
    await new Promise((resolve) => setTimeout(resolve, 10));

    const lastSnapshot = emissions.at(-1)?.payload as { status: string; stage: string };
    expect(lastSnapshot).toMatchObject({
      status: 'cancelled',
      stage: 'cancelled',
    });
  });
});
