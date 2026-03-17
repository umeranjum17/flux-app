import { beforeEach, describe, expect, it } from 'vitest';
import { createMockApi, type MockApi } from '../../../test/mocks/window-api';
import { useWorkspaceStore } from '../workspace';

let mockApi: MockApi;

beforeEach(() => {
  mockApi = createMockApi();
  (window as any).api = mockApi;

  useWorkspaceStore.setState({
    workspaces: new Map(),
    activeWorkspaceId: null,
    mergingWorkspaceId: null,
    checkpoints: new Map(),
    workspaceActivities: new Map(),
    workspaceSessions: new Map(),
    changesPanelOpen: false,
    changesPanelWorkspaceId: null,
    changesPanelFiles: [],
    changesPanelSelectedFile: null,
    changesPanelFileDiff: null,
  });
});

describe('changes panel state', () => {
  it('opens the changes panel without auto-selecting a file preview', async () => {
    const workspace = {
      id: 'ws-1',
      name: 'Changed Workspace',
      parentRepo: '/repo',
      branch: 'flux/changed',
      status: 'idle' as const,
      outcome: 'in_progress' as const,
      createdAt: 1,
      updatedAt: 1,
      agentId: 'claude-code',
      model: 'claude-sonnet-4.5',
      mode: 'act' as const,
      worktreePath: '/repo/ws-1',
    };

    useWorkspaceStore.getState().addWorkspace(workspace);
    mockApi.invoke.mockImplementation(async (channel: string) => {
      if (channel === 'workspace:diff-files') {
        return [{ path: '/repo/ws-1/src/app.ts', status: 'modified', additions: 3, deletions: 1 }];
      }
      throw new Error(`Unexpected channel: ${channel}`);
    });

    await useWorkspaceStore.getState().openChangesPanel('ws-1');

    const workspaceState = useWorkspaceStore.getState();
    expect(workspaceState.changesPanelOpen).toBe(true);
    expect(workspaceState.changesPanelWorkspaceId).toBe('ws-1');
    expect(workspaceState.changesPanelFiles).toEqual([
      { path: '/repo/ws-1/src/app.ts', status: 'modified', additions: 3, deletions: 1 },
    ]);
    expect(workspaceState.changesPanelSelectedFile).toBeNull();
    expect(workspaceState.changesPanelFileDiff).toBeNull();
    expect(mockApi.invoke).toHaveBeenCalledTimes(1);
    expect(mockApi.invoke).toHaveBeenCalledWith('workspace:diff-files', { workspaceId: 'ws-1' });
  });
});
