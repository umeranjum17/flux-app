import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMockApi, type MockApi } from '../../../../test/mocks/window-api';
import { MergeDialog } from '../MergeDialog';
import { useChatStore } from '../../../stores/chat';
import { useSessionStore } from '../../../stores/session';
import { useUiStore } from '../../../stores/ui';
import { useWorkspaceStore } from '../../../stores/workspace';

let mockApi: MockApi;

const workspace = {
  id: 'ws-1',
  name: 'Hardening pass',
  parentRepo: '/repo',
  branch: 'flux-hardening',
  status: 'done' as const,
  outcome: 'in_progress' as const,
  createdAt: 1,
  updatedAt: 1,
  agentId: 'codex',
  model: 'gpt-5-codex',
  worktreePath: '/repo/.flux-worktrees/ws-1',
};

beforeEach(() => {
  cleanup();
  mockApi = createMockApi();
  (window as any).api = mockApi;

  useUiStore.setState({
    gitBranch: 'master',
  } as any);

  useChatStore.setState({
    tasks: new Map(),
    activeTaskId: null,
    tabOrder: [],
  });

  useSessionStore.setState({
    sessions: [],
    loading: false,
  });

  useWorkspaceStore.setState({
    workspaces: new Map([[workspace.id, workspace]]),
    archivedWorkspaces: new Map(),
    activeWorkspaceId: null,
    showArchived: false,
    reviewingWorkspaceId: null,
    diffFiles: [],
    selectedFile: null,
    fileDiff: null,
    mergingWorkspaceId: null,
    checkpoints: new Map(),
    workspaceSessions: new Map(),
  });
});

describe('MergeDialog', () => {
  it('prefills the target branch from the current repository branch', () => {
    render(
      <MergeDialog
        workspace={workspace}
        onClose={() => {}}
      />,
    );

    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('master');
  });

  it('starts an agent-backed merge task', async () => {
    const onClose = vi.fn();
    mockApi.invoke.mockImplementation(async (channel: string) => {
      if (channel === 'workspace:merge') {
        return {
          taskId: 'task-1',
          session: {
            id: 'session-1',
            title: '[WS] Hardening pass',
            agentId: 'codex',
            model: 'gpt-5-codex',
            mode: 'act',
            cwd: '/repo',
            createdAt: 1,
            updatedAt: 1,
            metadata: { workspaceId: workspace.id },
          },
        };
      }
      return undefined;
    });

    render(<MergeDialog workspace={workspace} onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Start Merge' }));

    await waitFor(() => {
      expect(mockApi.invoke).toHaveBeenCalledWith(
        'workspace:merge',
        expect.objectContaining({
          workspaceId: workspace.id,
          targetBranch: 'master',
          squash: true,
          prompt: expect.stringContaining('Merge workspace branch'),
        }),
      );
    });

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });

    const task = useChatStore.getState().tasks.get('task-1');
    expect(task).toEqual(expect.objectContaining({
      id: 'task-1',
      agentId: 'codex',
      cwd: '/repo',
      workspaceId: workspace.id,
      status: 'running',
    }));

    expect(useSessionStore.getState().sessions[0]?.id).toBe('session-1');
    expect(useWorkspaceStore.getState().workspaces.get(workspace.id)?.sessionId).toBe('session-1');
  });

  it('recovers the workspace session when merge returns a partial payload', async () => {
    const onClose = vi.fn();
    mockApi.invoke.mockImplementation(async (channel: string) => {
      if (channel === 'workspace:merge') {
        return {
          taskId: 'task-2',
        };
      }
      if (channel === 'sessions:list') {
        return [{
          id: 'session-2',
          title: '[WS] Hardening pass',
          agentId: 'codex',
          model: 'gpt-5-codex',
          mode: 'act',
          cwd: '/repo',
          createdAt: 2,
          updatedAt: 2,
          metadata: { workspaceId: workspace.id },
        }];
      }
      return undefined;
    });

    render(<MergeDialog workspace={workspace} onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Start Merge' }));

    await waitFor(() => {
      expect(mockApi.invoke).toHaveBeenCalledWith('sessions:list');
    });

    const task = useChatStore.getState().tasks.get('task-2');
    expect(task).toEqual(expect.objectContaining({
      id: 'task-2',
      agentId: 'codex',
      cwd: '/repo',
      workspaceId: workspace.id,
      status: 'running',
    }));

    expect(useSessionStore.getState().sessions[0]?.id).toBe('session-2');
    expect(onClose).toHaveBeenCalled();
  });
});
