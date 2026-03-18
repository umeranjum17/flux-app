import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { FileActivityPanel } from '../FileActivityPanel';
import type { Workspace } from '../../../lib/ipc-api';
import { useChatStore } from '../../../stores/chat';
import { useWorkspaceStore } from '../../../stores/workspace';

describe('FileActivityPanel', () => {
  beforeEach(() => {
    (window as any).api = {
      invoke: vi.fn().mockResolvedValue(undefined),
    };

    useChatStore.setState({ tasks: new Map(), activeTaskId: null, tabOrder: [] });
    useWorkspaceStore.setState({
      workspaces: new Map(),
      activeWorkspaceId: null,
      mergingWorkspaceId: null,
      checkpoints: new Map(),
      workspaceActivities: new Map(),
      workspaceOperations: new Map(),
      workspaceSessions: new Map(),
      changesPanelOpen: false,
      changesPanelWorkspaceId: null,
      changesPanelFiles: [],
      changesPanelSelectedFile: null,
      changesPanelSelectedScope: null,
      changesPanelFileDiff: null,
    });
  });

  it('loads changes from the active workspace without an active task', async () => {
    const workspace: Workspace = {
      id: 'ws-1',
      name: 'Fix status',
      branch: 'flux/fix-status',
      parentRepo: '/repo',
      status: 'idle',
      outcome: 'in_progress',
      createdAt: 1,
      updatedAt: 1,
      agentId: 'codex',
      model: 'gpt-5',
      mode: 'act',
      worktreePath: '/repo/.flux/fix-status',
    };

    useWorkspaceStore.setState({
      workspaces: new Map([
        ['ws-1', workspace],
      ]),
      activeWorkspaceId: 'ws-1',
    });

    (window as any).api.invoke.mockImplementation(async (channel: string, payload?: { workspaceId?: string }) => {
      if (channel === 'workspace:diff-files-separated') {
        expect(payload?.workspaceId).toBe('ws-1');
        return {
          committed: [],
          uncommitted: [
            {
              path: 'src/main.ts',
              status: 'modified',
              additions: 3,
              deletions: 1,
              diff: '@@ -1 +1 @@',
            },
          ],
        };
      }
      if (channel === 'workspace:diff-files') {
        return [];
      }
      return undefined;
    });

    render(<FileActivityPanel embedded />);

    await waitFor(() => {
      expect(screen.getByText('main.ts')).not.toBeNull();
    });

    expect((window as any).api.invoke).toHaveBeenCalledWith('workspace:diff-files-separated', { workspaceId: 'ws-1' });
    expect(screen.queryByText('No committed or uncommitted changes yet')).toBeNull();
  });
});
